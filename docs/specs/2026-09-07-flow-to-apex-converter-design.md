# Flow → Apex converter: design

**Status:** approved, not implemented
**Date:** 2026-09-07
**Supersedes:** the string-templating generator in 2.0.x / 2.1.0

## Why

`bulkify` today is a scaffolder that describes itself as a converter. The gap is not
polish — it is architectural. Four defects found in one review, all with the same root
cause:

| Defect | Emitted | Why it happened |
|---|---|---|
| Non-compiling comparison | `record.get('Amount__c') > 1000` | `get()` returns `Object`; no model of Apex types |
| Non-compiling operator | `a contains 'x'` | Flow operator mapped to a word, not a call |
| Wrong table queried | `FROM Account` for every Flow | Object hardcoded, not read from the Flow |
| Silent data loss | update collected without field writes | Field assignments computed then discarded |

Every one is a consequence of **building a typed language out of template strings**. A
generator with no representation of what it is generating cannot be tested into
correctness; the defect classes are unbounded.

The 2.0.2/2.0.3 incident is the same problem one level up: an artifact published with no
source, unverifiable against anything.

## Goals

1. **Convert, best-effort.** Always produce a complete, compiling Apex class. Where the
   Flow is ambiguous, make the best available inference — and record it.

   "Best-effort" governs *coverage*, not *invention*. The tool never refuses a Flow, and
   it never fabricates semantics it did not read. Where a construct cannot be translated,
   the emitter produces a compiling placeholder — a typed local initialised to null, or a
   no-op guarded branch — carrying the original Flow fragment in a comment and an entry in
   the manifest. The class still compiles and still deploys; what it does not do is
   silently pretend the construct was handled. This is the distinction the 2.0.x generator
   failed: `Status == 'Processing'` was invention, not inference.
2. **Make every inference visible.** Each translated construct carries the confidence of
   its translation and the source of its type information. A guess that is labelled is a
   different thing from a guess that is hidden.
3. **Make correctness provable by execution**, not by assertion — compilation first,
   behavioural equivalence second.
4. **Verification is available to the user**, not only to CI.

## Non-goals

- Screen Flows. Screens are UI; there is no Apex equivalent. Out of scope permanently.
- Preserving Flow's visual structure. The output is idiomatic Apex, not a transliteration.
- Converting managed-package Flows whose subflows are not readable.

## Architecture

```
Flow XML
   │
   ├─► Parser ──────────► FlowIR            complete, typed model of the Flow
   │                        │
   │                        ├─► TypeResolver          field types, with provenance
   │                        │
   │                        ├─► FormulaTranslator     Flow formula → Apex expression
   │                        │
   │                        └─► BulkTransformer       hoist queries, collect DML
   │                                 │
   │                                 ▼
   │                            ApexEmitter (AST → source)
   │                                 │
   └──────────────────────────► Verifier ──► compile | differential
```

### FlowIR

A typed intermediate representation of the entire Flow. Today's parser recognises ten
element types and silently ignores the rest; the bundled example Flow alone contains
three `<formulas>` and twelve `<variables>` that never reach the generator.

FlowIR must model, at minimum:

- `variables`, `constants`, `formulas`, `textTemplates` — with declared types and scope
- `start` — object, trigger type, entry criteria, run context
- `recordLookups` / `recordCreates` / `recordUpdates` / `recordDeletes` — object, fields,
  filters, assignment targets
- `decisions` — rules, conditions, logic type, branch targets
- `assignments` — target, operator, value, collection semantics
- `loops` — collection, iteration variable, body membership
- `subflows` — referenced flow, input/output parameter bindings
- `actionCalls` — action type and name, parameter bindings
- fault connectors on every element that can have one

Every IR node retains its source XML fragment, so any construct can be reported back to
the developer verbatim.

### TypeResolver

Field types come from, in order of preference:

1. `sf sobject describe` against `--target-org`, cached on disk per org and object
2. The Flow's own declarations (`<dataType>` on variables and parameters)
3. Naming heuristics — the current behaviour, retained only as a last resort

Each resolved type carries its source. This matters: today `inferFieldType` returns
`Boolean` for any field whose name contains `Is`, and `Decimal` for anything containing
`Amount`, with no signal that it guessed. A cast derived from a describe and a cast
derived from spelling are not the same claim and must not look the same.

### FormulaTranslator

Salesforce formula language → Apex expressions. The largest single sub-project; the
formula language has on the order of a hundred functions plus operator and null-handling
semantics that differ from Apex.

Delivered as a growing subset. Each supported function ships with tests. An unsupported
function produces a compiling placeholder plus a manifest entry — never an invented
expression, and never a hole that breaks the build.

### BulkTransformer

The actual bulkification, and the part of the current tool whose *idea* is sound:

- queries hoisted out of loops, keyed by the Ids collected before the loop
- DML accumulated into collections and issued once after the loop
- per-iteration subflow calls inlined or converted to a method operating on a collection
- fault connectors become `try`/`catch`

### ApexEmitter

**Emits through a small Apex AST/builder — never template strings.** This is the single
change that removes the four defect classes structurally rather than case by case:

- expression nodes know their Apex type, so a comparison either has a valid cast or
  cannot be constructed
- identifiers are allocated through a scope, so `relatedRecords` cannot collide and
  `_Bulkified` cannot be appended twice
- statements are typed, so a DML statement inside a loop body is not representable

Generated code targets the current platform defaults: `WITH USER_MODE` on SOQL,
`Database.*(records, AccessLevel.USER_MODE)` on DML, `with sharing` classes.

### Verifier

Two modes, both available as CLI commands and both run in CI:

```bash
sf-flow-apex-converter convert MyFlow.xml --target-org dev --output ./force-app
sf-flow-apex-converter verify  MyFlow.xml --target-org scratch --mode compile
sf-flow-apex-converter verify  MyFlow.xml --target-org scratch --mode differential
```

- **compile** — `sf project deploy validate` of the generated class. Proves it is valid
  Apex under the org's API version. Would have caught all four defects found in review.
- **differential** — deploy the original Flow and the generated Apex to a scratch org,
  run the same record set through both, diff the resulting records. This is the only
  evidence that justifies the word "converter"; everything else is an assertion.

CI runs both over a fixture corpus, so the converter cannot regress. The commands exist
so a user can run the same proof against their own Flow — CI proves the converter, only
`verify` proves *their* conversion. The README must say exactly that.

## Reporting

Every run emits a machine-readable manifest alongside the Apex.

`status` is one of `translated`, `placeholder` (compiling stub, developer must implement),
or `skipped` (construct has no Apex meaning, e.g. a screen). `confidence` applies only to
`translated` and is one of:

| confidence | means |
|---|---|
| `high` | types from `describe`; semantics have a direct Apex equivalent |
| `medium` | types from Flow declarations; semantics equivalent under stated assumptions |
| `low` | types inferred from naming, or semantics approximated — verify differentially |


```json
{
  "flow": "MyFlow",
  "elements": [
    { "name": "Get_Pricing_Streams", "kind": "recordLookups",
      "status": "translated", "confidence": "high",
      "typeSource": "describe" },
    { "name": "Calc_Exposure", "kind": "formulas",
      "status": "translated", "confidence": "low",
      "note": "ROUND() approximated; verify with --mode differential" }
  ],
  "verification": { "compile": "pass", "differential": "not-run" }
}
```

Best-effort conversion is only defensible if the effort is legible. The manifest is how
the developer knows which parts to check first, and it is what the `verify` command
reports against.

## Sequencing

1. **FlowIR + Parser** — full element coverage, source fragments retained. Tests per
   element type against fixture Flows.
2. **ApexEmitter (AST)** — replace template strings. Existing generator tests must keep
   passing; the four defect tests are the acceptance bar.
3. **TypeResolver** — describe-backed types with provenance, cached.
4. **Verifier `--mode compile`** + CI scratch org. From here on, nothing merges unless
   the generated Apex compiles.
5. **BulkTransformer** on the new IR.
6. **FormulaTranslator** — initial subset.
7. **Verifier `--mode differential`** + fixture corpus.

Steps 1–4 are the foundation and should land before any new translation capability: they
are what makes every later step verifiable.

## Risks

- **Formula coverage is open-ended.** Mitigated by reporting gaps rather than inventing
  expressions, and by growing the subset against real Flows.
- **Differential testing needs representative data.** A diff over an unrepresentative
  record set proves little. Fixture corpus must include bulk (200+) cases, null cases,
  and fault paths.
- **Scratch org availability gates CI.** Requires a DevHub and adds minutes per run.
- **Flow and Apex null semantics differ**, as do date arithmetic and division-by-zero
  behaviour. These are correctness traps that only differential testing will surface.

## Open questions

- Which API version does generated Apex target — the org's, or a pinned floor?
- Record-triggered Flows convert to a trigger + handler; does the tool emit the trigger
  too, or only the handler class?
- Subflows: inline them, or emit one class per subflow and call across?
