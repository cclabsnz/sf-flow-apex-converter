# Lowering FlowIR onto the Apex AST: design (Milestone 2c)

Status: agreed, ready for an implementation plan.
Follows: `docs/specs/2026-09-07-flow-to-apex-converter-design.md` (overall design),
`docs/plans/2026-09-07-apex-ast-emitter.md` (Milestone 2b, merged).

## Why

Milestone 2a produced `FlowIR`, a typed model of a Flow. Milestone 2b produced
`src/apex/`, a typed Apex AST whose constructors refuse to build the defects the
2.0.x string generator shipped. Nothing connects them: the AST is exercised only
by trees built by hand in tests, and `bulkify` still runs the old generator.

2c is the join. It turns a `FlowIR` into an `ApexClass` and emits it.

## Scope

**In:** lowering every element kind the IR models, control-flow reconstruction,
class and method structure, a type source with provenance, a `convert` command.

**Out, and deliberately:**

- **Bulkification.** Output preserves the Flow's semantics exactly, including
  per-record DML inside loops. `BulkTransformer` is its own milestone, and it is
  a tree-to-tree transform over a lowering that is already correct and tested.
  Doing both at once is how the two hard problems hide each other's bugs.
- **Describe-backed type resolution.** Milestone 3. 2c resolves from the Flow's
  own declarations and flags what it guesses.
- **Formula translation.** Milestone 6. 2c translates bare references and stubs
  the rest.
- **Replacing the generator.** `bulkify` keeps `BulkifiedApexGenerator` until
  `BulkTransformer` exists; `convert` is a new, separate command.

## Decisions

Each states the cost of being wrong, so reversing one is cheap to reason about.

**Faithful lowering before bulkification.** The spec already sequences
`BulkTransformer` after the foundation, because the foundation is what makes
later steps verifiable. A faithful lowering is also differentially testable
against the Flow it came from — when output and Flow disagree, the bug is in
lowering rather than tangled with hoisting.
*Cost if wrong:* `convert` output is not yet better than the Flow on the axis
the tool is named for, and two generators coexist for one milestone.

**Structured control flow, with refusal and a shape report.** Decisions become
`if`/`else` joined at the immediate post-dominator; loops come from Flow's own
loop elements. A graph that does not reduce is refused with a diagnostic naming
the nodes and edges that defeated it — never approximated, never half-emitted.
*Cost if wrong:* some real Flow converts to nothing. That is recoverable and
loud. A mis-structured class is neither.

**Types from declarations, then standard fields, then flagged heuristics.**
Declarations type most references exactly. SObject field reads are typed by a
standard-field table where possible and by naming heuristics otherwise, with the
provenance recorded and surfaced in the generated Apex.
*Cost if wrong:* a wrong guess produces a compiling cast that is silently
incorrect — the 2.0.x failure mode. Mitigated by making every guess visible in
the file a developer reads, not only in a manifest they may not open.

**Untranslated formulas throw.** A formula containing a function generates a
private method that compiles and throws `UnsupportedOperationException`, naming
the formula and quoting its Flow expression.
*Cost if wrong:* the generated class cannot run until formulas are finished. The
alternative — returning a typed default — makes a Boolean formula silently
return `false` and take the wrong branch, which is exactly the class of defect
this project exists to remove.

## Architecture

`src/lower/` is the only module that knows both Flow and Apex. The 2b import
boundary holds: `src/apex/` stays Flow-ignorant, `src/ir/` stays Apex-ignorant.

```
src/ir/  ──►  src/lower/  ──►  src/apex/
 (Flow)      (translation)      (Apex)
```

| File | Purpose |
|---|---|
| `lower/cfg.ts` | FlowIR nodes → control-flow graph; joins, loop bodies, reducibility verdict |
| `lower/typeSource.ts` | reference → `ApexType` + provenance |
| `lower/value.ts` | `FlowValue` → `ApexExpr` |
| `lower/condition.ts` | `FlowConditionIR` + operator + condition logic → `ApexExpr` |
| `lower/elements/*.ts` | one lowering per element kind |
| `lower/lowerFlow.ts` | orchestration: `FlowIR` → `ApexClass` + manifest |

Element lowerings get one file each rather than a switch, so each is
independently testable.

### Additions to `src/apex/`

Three, all of which 2b deferred to "when there is a class to build":

- **`apex/class.ts`** — `ApexClass`, `ApexMethod`, ApexDoc, and their emission.
- **`stringLiteral(value)` in `expr.ts`** — escapes `\` and `'` and wraps in
  quotes. This closes the `O'Brien` gap recorded at the end of 2b. It lands
  before the first element lowering, because that is the moment raw Flow data
  first reaches `literal()`.
- **`memberWrite(target, member, value)` in `stmt.ts`** — `obj.Field = value`
  for Apex-defined types. `fieldWrite` emits `record.put(...)`, which is
  SObject-only, and a dotted name passed to `assign` would smuggle an
  unvalidated identifier through — the hole flagged in 2b's final review.

The `literal()` atom validator added in 2b becomes load-bearing here:
`stringLiteral` produces a valid atom by construction, and anything else a
lowering attempts is refused at the constructor rather than emitted.

## Control flow

### Building the graph

Edges come from the element body, not from `connectors[]`. Decision nodes carry
their branch targets in **both** `rules[].target`/`defaultTarget` and
`connectors[]` — the same edges twice — and loops likewise duplicate
`bodyTarget`/`afterTarget`. Reading both emits every branch twice.

| Element | Edge source |
|---|---|
| decision | `rules[].target`, `defaultTarget` |
| loop | `bodyTarget` (body), `afterTarget` (exit) |
| everything else | the single non-fault connector |
| any element | `connectors[]` where `isFault` — kept as a separate edge class |

### Emission

```
emit(node, stopAt):
  while node and node ≠ stopAt:
    decision → join = ipdom(node)
               if / else-if / else, each branch = emit(target, join)
               node = join
    loop     → for (T item : collection) { emit(bodyTarget, node) }
               node = afterTarget
    other    → emit statement; node = successor
```

Two structural facts make this tractable, both confirmed against
`exampleflow.xml`. Flow loops are explicit, so a loop is never *discovered* from
a back-edge — a back-edge to the loop node is simply end-of-body. And decision
branches reconverge, so the join is the decision's immediate post-dominator.

Post-dominators are computed by iterative dataflow on the reversed graph, not
Lengauer–Tarjan. These graphs are tens of nodes; the simple algorithm is O(n²) at
worst and can be verified exhaustively against hand-built cases.

Fault connectors lower to `try { element } catch (Exception e) { <fault path> }`,
the fault path lowered as a branch under the same join rules. Without this a
Flow's error path silently disappears, which is not faithful.

### The refusal contract

Lowering requires all of:

- every back-edge targets a loop node;
- every decision has an immediate post-dominator, or all of its branches
  terminate;
- no branch enters the interior of another branch.

When any fails, the **whole Flow** is refused — no partial class — with a report
naming the offending nodes and edges:

```
Cannot structure Decision_A: rule branch reaches X (terminates),
default branch reaches Y (re-enters Decision_B body).
```

Unreachable nodes are reported too; they usually indicate a parse gap or a
broken Flow.

## Types and provenance

`TypeSource` returns `{ type, provenance }` with provenance in
`declared | standard | heuristic`. Milestone 3 adds `describe` as a higher tier
without touching callers.

Resolution order:

1. **Flow declarations** — `dataType`, `objectType`, `isCollection`. Covers
   variables, constants and formula result types exactly.
2. **Standard-field table** — `Id`, `Name`, `CreatedDate`, `OwnerId` and similar.
3. **Naming heuristics** — the current `inferFieldType` behaviour, last resort.

Every `heuristic` resolution is recorded and surfaced in the generated class's
ApexDoc header, naming the field and the guess. The overall spec requires that a
describe-derived cast and a spelling-derived cast "must not look the same"; a
manifest alone does not satisfy that, because the person reading the Apex is not
holding the manifest.

## Values, operators and condition logic

`FlowValue` maps by `kind`: strings through `stringLiteral()`, numbers and
booleans through `literal()`, `reference` to `variable()` or `fieldRead()`
depending on whether the path is dotted, `none` to `null`.

Flow operators map to AST nodes — `EqualTo`/`NotEqualTo` to `==`/`!=`, ordering
operators to `comparison`, `IsNull` to `nullTest`, `IsBlank` to
`String.isBlank()`, `Contains`/`StartsWith`/`EndsWith` to method calls, `In` to a
SOQL `IN` bind or `List.contains`. An operator with no mapping refuses by name.

`$Permission.X` becomes `FeatureManagement.checkPermission('X')`. Other `$`
setup references refuse by name until each is mapped deliberately.

**Condition logic needs a parser.** `conditionLogic` is `and`, `or`, or a custom
expression over condition indices such as `1 AND (2 OR 3)` — which
`exampleflow.xml` uses, so this is required, not optional. A small
precedence-climbing parser over indices, parentheses, `AND` and `OR` produces a
`logical` tree. An index outside the condition list is a refusal.

## Output shape

- `with sharing` / `without sharing` from `runInMode`.
- Class name from `flowName` through `Scope`, so a Flow named `Update` cannot
  produce an uncompilable class name.
- `isInput` declarations become method parameters.
- Constants become `private static final` fields.
- Remaining declarations become locals allocated through `Scope` at the top of
  the method.
- `isOutput` declarations become public fields on a returned inner `Result`
  class; the method is `void` when there are none.
- Formulas become private methods — exact translation for bare references,
  throwing stubs otherwise.
- Subflows emit `<SubflowName>.execute(...)` plus a manifest dependency. Only
  one Flow file is ever available, so inlining a once-referenced subflow (which
  the overall spec prefers) is not possible in 2c.
- **Action calls generate a throwing stub, on the same policy as formulas.** An
  `actionCalls` element names an action (`actionType: 'apex'`,
  `actionName: 'GetIdsFromRecords'` in the fixture) whose invocable method name
  and request wrapper live in a class the converter cannot see. Emitting a call
  would mean inventing a signature. Instead each distinct action gets a private
  method that compiles and throws, quoting the action name, type and parameter
  bindings, with `dataTypeMappings` recorded — it carries the concrete type
  argument for a generic invocable, which is the only place that type exists.
  Well-known standard action types can be mapped individually later; none are
  mapped in 2c.
- **Collection processors lower by type.** `FilterCollectionProcessor` becomes a
  loop building a filtered list, reusing the same condition lowering as
  decisions — its conditions are ordinary `FlowConditionIR` over an iteration
  variable. Other processor types (`Sort`, `Map`) refuse by `processorType`:
  sorting needs a generated `Comparator` implementation, which is real work and
  belongs in its own change rather than smuggled in here.
- A record-triggered Flow emits the handler class only, never a trigger file,
  plus the one-line delegation to add to the org's existing trigger. This is a
  decision inherited from the overall spec.
- `-meta.xml` pins API 58.0, the floor the emitted `WITH USER_MODE` and
  `AccessLevel.USER_MODE` require.

The class carries an ApexDoc header naming the source Flow, every guessed cast,
every formula stub and every subflow dependency. A JSON manifest carries the same
data machine-readably.

## Failure handling

A refusal writes no `.cls` and exits non-zero with the report. Half a class whose
control flow was guessed is worse than none.

An `ApexTypeError` escaping a lowering is a **lowering bug**, not user error. It
is caught at the element boundary and re-thrown with the element's name attached,
so the failure points at the Flow element that produced the invalid tree.

Unsupported constructs already modelled by `FlowIR.unsupported` flow through to
the manifest unchanged. Nothing is dropped silently.

## Testing and acceptance

TDD throughout, as in 2b: a failing test before every behaviour.

`cfg.ts` is tested against hand-built graphs, including deliberately irreducible
ones — it is the module where a bug is least visible and most damaging. Element
lowerings assert on emitted source. `condition.ts` gets the custom-logic parser
cases directly.

**A stub is not a refusal.** The two failure modes are deliberately different and
must not be conflated:

| | Emits a class? | Compiles? | Runs? |
|---|---|---|---|
| **Refusal** (irreducible graph, unmapped operator, unmapped processor) | no | — | — |
| **Stub** (formula with a function, action call) | yes | yes | throws when reached |

A refusal means we could not determine the *structure*, and any output would be
a guess. A stub means the structure is known and one leaf is not yet
translatable — the class is a correct skeleton with a loud, named hole.

Done when:

1. Full suite green; `tsc --noEmit` and `eslint` clean.
2. `convert exampleflow.xml` completes with zero refusals. It will contain
   stubs — two formulas and one action call — and that is the expected result,
   not a partial success.
3. **The generated class compiles in a real org** — `sf project deploy validate`
   against `devedition`, run opt-in rather than in CI, which has no org
   credentials.

Point 3 is the one that matters. Every Critical found during 2b was confirmed by
the compiler, and two of them contradicted confident reasoning about Apex
semantics. Compiling the output is the cheapest available source of truth.

Full `Verifier --mode compile` against a CI scratch org remains a later
milestone; this is the same signal without the infrastructure.

## Risks

- **Heuristic types are the weakest link.** A wrong guess compiles and is
  silently wrong. Mitigated by provenance in the file itself, and removed
  entirely when Milestone 3 lands describe.
- **Refusal rate is unknown.** `exampleflow.xml` reduces cleanly, but one fixture
  is not a corpus. If real Flows refuse often, the fallback is a state-machine
  lowering for irreducible subgraphs — considered and rejected for now on
  readability grounds, and cheap to revisit because the refusal path already
  reports exactly which shapes failed.
- **Apex-defined types are opaque.** `ValidationMessage.Message` is a member of
  an Apex class the converter cannot see, so member types fall to heuristics and
  member writes are emitted unchecked.
- **Faithful output is not bulkified.** Anyone reading `convert` output before
  `BulkTransformer` lands will see per-record DML in loops. The ApexDoc header
  must say so explicitly, or the tool looks broken.
- **2c output compiles but does not run.** Between formula stubs and action
  stubs, the generated class throws on any path reaching one — and
  `exampleflow.xml` produces three. This is intended, but it means 2c cannot be
  differentially tested against the original Flow; that becomes possible only
  once Milestone 6 lands formulas. The acceptance bar is deliberately "compiles",
  not "behaves the same", and no later milestone should read point 3 as more
  than it says.
