# FlowIR Lowering Implementation Plan (Milestone 2c)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a `FlowIR` into a compiling Apex class through the typed AST, so
`convert exampleflow.xml` produces a `.cls` that deploys to a real org.

**Architecture:** A new `src/lower/` module is the only place that knows both
Flow and Apex. It rebuilds structured control flow from the Flow graph
(post-dominator joins for decisions, Flow's own loop elements for loops),
resolves types from declarations with provenance, and assembles an `ApexClass`.
Anything whose structure cannot be determined refuses the whole Flow; anything
whose structure is known but whose leaf cannot be translated yet becomes a
loud throwing stub.

**Tech Stack:** TypeScript (`strict: true`), Jest via ts-jest, pnpm. No new
runtime dependencies.

**Spec:** `docs/specs/2026-09-09-flowir-lowering-design.md`

## Global Constraints

- TypeScript `strict: true`. No `any` in exported signatures; `unknown` plus a
  narrowing guard instead.
- **Generated Apex targets API 58.0 or later.** SOQL carries `WITH USER_MODE`,
  DML goes through `Database.*(records, AccessLevel.USER_MODE)`, classes are
  `with sharing` unless `runInMode` says otherwise.
- `src/apex/` must not import from `src/ir/`, `src/lower/` or `src/utils/`. The
  AST knows Apex; it does not know Flow.
- `src/lower/` may import from `src/ir/` and `src/apex/`. Nothing else may
  import from `src/lower/` except `src/index.ts`.
- Constructors validate. An invalid tree throws `ApexTypeError` at construction
  rather than emitting bad source.
- Existing behaviour untouched: `analyze`, `bulkify` and `ir` keep working.
  `bulkify` keeps using `BulkifiedApexGenerator`.
- Existing tests must keep passing: `npx jest` is 232 tests / 22 suites before
  this plan starts.
- `pnpm lint` reports 27 pre-existing errors in `src/utils/`. Those are on
  `main` and are not this plan's problem. Do not "fix" them; do not add new ones.
- Every task ends with a commit. Never include AI attribution in commit
  messages.

## Refusal vs stub

These are different and must not be conflated.

| | Emits a class? | Compiles? | Runs? |
|---|---|---|---|
| **Refusal** — irreducible graph, unmapped operator, unmapped processor | no | — | — |
| **Stub** — formula with a function, action call | yes | yes | throws when reached |

## File Structure

| File | Responsibility |
|---|---|
| `src/apex/class.ts` | **new** — `ApexClass`, `ApexMethod`, `ApexField`, ApexDoc, `emitClass` |
| `src/apex/expr.ts` | **modify** — add `stringLiteral(value)` |
| `src/apex/stmt.ts` | **modify** — add `memberWrite(target, member, value)` |
| `src/lower/context.ts` | **new** — `LowerContext`, `LoweringNote`, `LoweringRefusal` |
| `src/lower/typeSource.ts` | **new** — reference → `ApexType` + provenance |
| `src/lower/cfg.ts` | **new** — graph, post-dominators, reducibility verdict |
| `src/lower/value.ts` | **new** — `FlowValue` → `ApexExpr` |
| `src/lower/condition.ts` | **new** — conditions, operators, condition-logic parser |
| `src/lower/elements/assignment.ts` | **new** — `assignments` |
| `src/lower/elements/record.ts` | **new** — `recordLookups`/`Creates`/`Updates`/`Deletes` |
| `src/lower/elements/collectionProcessor.ts` | **new** — `FilterCollectionProcessor` |
| `src/lower/elements/stubs.ts` | **new** — subflow and action calls |
| `src/lower/walk.ts` | **new** — the control-flow walker: graph → statements |
| `src/lower/lowerFlow.ts` | **new** — orchestration, class assembly, manifest |
| `src/index.ts` | **modify** — `convert` command |

---

### Task 1: Close 2b's deferred AST debt

Two additions Milestone 2b deliberately deferred. They land first because every
later task depends on them: the moment lowering turns a Flow value into a
literal, unescaped quotes become live.

**Files:**
- Modify: `src/apex/expr.ts`
- Modify: `src/apex/stmt.ts`
- Test: `tests/apex/expr.test.ts`, `tests/apex/stmt.test.ts`

**Interfaces:**
- Consumes: `literal`, `ApexExpr`, `ApexTypeError`, `ApexStmt` (all existing)
- Produces:
  - `stringLiteral(value: string): ApexExpr` in `src/apex/expr.ts`
  - `construct(type: ApexType, args: ApexExpr[]): ApexExpr` in `src/apex/expr.ts`; `ApexExpr` gains `| { node: 'construct'; type: ApexType; args: ApexExpr[] }`
  - `memberWrite(target: string, member: string, value: ApexExpr): ApexStmt` in `src/apex/stmt.ts`
  - `ApexStmt` gains `| { stmt: 'memberWrite'; target: string; member: string; value: ApexExpr }`

- [ ] **Step 1: Write the failing tests for `stringLiteral`**

Add to `tests/apex/expr.test.ts`:

```typescript
describe('stringLiteral', () => {
  it('quotes a plain value', () => {
    expect(stringLiteral('Funded').text).toBe("'Funded'");
  });

  it('escapes an embedded apostrophe', () => {
    // The O'Brien case. Emitting 'O'Brien' unescaped ends the literal early
    // and leaves `Brien'` as a syntax error.
    expect(stringLiteral("O'Brien").text).toBe("'O\\'Brien'");
  });

  it('escapes a backslash before escaping quotes', () => {
    // Order matters: escaping quotes first would then double the backslash
    // this step adds, producing 'a\\\'b'.
    expect(stringLiteral("a\\b").text).toBe("'a\\\\b'");
  });

  it('produces a value literal() accepts as an atom', () => {
    // literal()'s atom guard is what stops compound text defeating the
    // emitter's parenthesisation. stringLiteral must satisfy it by construction.
    expect(() => literal(STRING, stringLiteral("it's a || b").text)).not.toThrow();
  });

  it('handles newlines and tabs', () => {
    expect(stringLiteral('a\nb').text).toBe("'a\\nb'");
    expect(stringLiteral('a\tb').text).toBe("'a\\tb'");
  });
});
```

Add `stringLiteral` to the existing `../../src/apex/expr.js` import in that file.

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/apex/expr.test.ts -t stringLiteral`
Expected: FAIL — `stringLiteral is not a function`.

- [ ] **Step 3: Implement `stringLiteral`**

Add to `src/apex/expr.ts`, directly after `literal`:

```typescript
/**
 * A String literal built from a raw value, with Apex escaping applied.
 *
 * `literal()` takes text that is already Apex source; this is the constructor
 * for text that is not. Every Flow-derived string must come through here — a
 * value containing an apostrophe passed to `literal()` directly would end its
 * own literal and emit a syntax error.
 *
 * Backslash is escaped first. Doing quotes first would then double the
 * backslashes this step adds.
 */
export function stringLiteral(value: string): ApexExpr {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return literal(STRING, `'${escaped}'`);
}
```

Add `STRING` to the existing `./types.js` import in `src/apex/expr.ts`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx jest tests/apex/expr.test.ts -t stringLiteral`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing test for `construct`**

Lowering a record create emits `new Account()`, and a collection needs
`new List<Account>()`. `literal()` refuses both — its atom guard rejects
compound text, which is the guard working as designed. Add the node.

Add to `tests/apex/expr.test.ts`:

```typescript
describe('construct', () => {
  it('constructs an SObject', () => {
    expect(emitExpr(construct(sobjectType('Account'), []))).toBe('new Account()');
  });

  it('constructs a typed list', () => {
    expect(emitExpr(construct(listOf(sobjectType('Account')), [])))
      .toBe('new List<Account>()');
  });

  it('is assignable to its own declared type', () => {
    // declare() validates assignability, so this must satisfy isAssignable.
    expect(() => declare(sobjectType('Account'), 'a', construct(sobjectType('Account'), [])))
      .not.toThrow();
  });
});
```

Add `construct` to the expr import, `emitExpr` from `../../src/apex/emit.js`,
`declare` from `../../src/apex/stmt.js`, and `listOf`/`sobjectType` from
`../../src/apex/types.js`.

Run it, watch it fail, then in `src/apex/expr.ts` add to the union:

```typescript
  | { node: 'construct'; type: ApexType; args: ApexExpr[] }
```

and the constructor:

```typescript
/** `new Account()` / `new List<String>()`. */
export function construct(type: ApexType, args: ApexExpr[]): ApexExpr {
  return { node: 'construct', type, args };
}
```

In `src/apex/emit.ts` add to `emitExpr` — the switch is exhaustive, so
TypeScript will require it:

```typescript
    case 'construct':
      return `new ${renderType(e.type)}(${e.args.map(emitExpr).join(', ')})`;
```

Run: `npx jest tests/apex` — expect PASS.

- [ ] **Step 6: Write the failing tests for `memberWrite`**

Add to `tests/apex/stmt.test.ts`:

```typescript
describe('memberWrite', () => {
  it('writes a member on an Apex-defined type', () => {
    // ValidationMessage.Message = errorText;  — not an SObject, so put() is wrong.
    expect(emitStmt(memberWrite('msg', 'Message', variable(STRING, 'errorText'))))
      .toBe('msg.Message = errorText;');
  });

  it('refuses an invalid target identifier', () => {
    // A dotted name smuggled in as the target would emit a.b.c = x with no check.
    expect(() => memberWrite('msg.inner', 'Message', variable(STRING, 'x')))
      .toThrow(ApexTypeError);
  });

  it('refuses an invalid member name', () => {
    expect(() => memberWrite('msg', '2Message', variable(STRING, 'x')))
      .toThrow(ApexTypeError);
  });

  it('refuses an untyped value', () => {
    expect(() => memberWrite('msg', 'Message', variable(OBJECT, 'raw')))
      .toThrow(ApexTypeError);
  });
});
```

Add `memberWrite` to the `../../src/apex/stmt.js` import and `emitStmt` from
`../../src/apex/emit.js` in that file.

- [ ] **Step 7: Run to verify they fail**

Run: `npx jest tests/apex/stmt.test.ts -t memberWrite`
Expected: FAIL — `memberWrite is not a function`.

- [ ] **Step 8: Implement `memberWrite`**

In `src/apex/stmt.ts`, add to the `ApexStmt` union after `fieldWrite`:

```typescript
  | { stmt: 'memberWrite'; target: string; member: string; value: ApexExpr }
```

Add the identifier guard and constructor:

```typescript
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;

function requireIdentifier(value: string, what: string): void {
  if (!IDENTIFIER.test(value)) {
    throw new ApexTypeError(`${what} '${value}' is not a valid Apex identifier.`);
  }
}

/**
 * `obj.Member = value;` for an Apex-defined type.
 *
 * Distinct from fieldWrite, which emits `record.put('F', v)` and is SObject-only.
 * Both names are validated rather than interpolated: passing a dotted string as
 * the target would otherwise emit `a.b.Member = v` with nothing checking it.
 */
export function memberWrite(target: string, member: string, value: ApexExpr): ApexStmt {
  requireIdentifier(target, 'A member-write target');
  requireIdentifier(member, 'A member name');
  if (isUntyped(value.type)) {
    throw new ApexTypeError(
      `Cannot write an untyped (Object) expression to '${target}.${member}'.`
    );
  }
  return { stmt: 'memberWrite', target, member, value };
}
```

In `src/apex/emit.ts`, add the case to `emitStmt`'s switch, after `fieldWrite`:

```typescript
    case 'memberWrite':
      return `${pad}${s.target}.${s.member} = ${emitExpr(s.value)};`;
```

- [ ] **Step 9: Run the whole apex suite**

Run: `npx jest tests/apex`
Expected: PASS. The `emitStmt` switch is exhaustive with no `default`, so
TypeScript would have failed the build if the new case were missing.

- [ ] **Step 10: Commit**

```bash
git add src/apex/expr.ts src/apex/stmt.ts src/apex/emit.ts tests/apex/expr.test.ts tests/apex/stmt.test.ts
git commit -m "feat(apex): add stringLiteral escaping, construct and memberWrite

Both were deferred at the end of Milestone 2b as having no caller. Lowering
is that caller: the moment a Flow value becomes a literal, an unescaped
apostrophe ends its own literal and emits a syntax error.

construct() covers `new Account()`, which literal() refuses because its
atom guard rejects compound text — the guard working as designed.

memberWrite exists because fieldWrite emits record.put(), which is
SObject-only, and passing a dotted name to assign() would smuggle an
unvalidated identifier into the output."
```

---

### Task 2: Class and method structure

**Files:**
- Create: `src/apex/class.ts`
- Test: `tests/apex/class.test.ts`

**Interfaces:**
- Consumes: `ApexType`, `renderType`, `ApexStmt`, `ApexExpr`, `emitStmt`, `emitExpr`
- Produces, all from `src/apex/class.ts`:
  - `interface ApexParam { type: ApexType; name: string }`
  - `interface ApexField { visibility: Visibility; isStatic: boolean; isFinal: boolean; type: ApexType; name: string; init: ApexExpr | null }`
  - `interface ApexMethod { visibility: Visibility; isStatic: boolean; returnType: ApexType | null; name: string; params: ApexParam[]; body: ApexStmt[]; doc: string[] }`
  - `interface ApexClass { name: string; sharing: Sharing; doc: string[]; fields: ApexField[]; methods: ApexMethod[]; inner: ApexClass[] }`
  - `type Visibility = 'public' | 'private' | 'global'`
  - `type Sharing = 'with sharing' | 'without sharing' | 'inherited sharing'`
  - `emitClass(c: ApexClass, depth?: number): string`

- [ ] **Step 1: Write the failing tests**

Create `tests/apex/class.test.ts`:

```typescript
import { emitClass, ApexClass } from '../../src/apex/class.js';
import { literal, variable } from '../../src/apex/expr.js';
import { assign, declare } from '../../src/apex/stmt.js';
import { BOOLEAN, DECIMAL, STRING, listOf, sobjectType } from '../../src/apex/types.js';

function emptyClass(over: Partial<ApexClass> = {}): ApexClass {
  return {
    name: 'MyHandler', sharing: 'with sharing', doc: [],
    fields: [], methods: [], inner: [], ...over,
  };
}

describe('emitClass', () => {
  it('emits an empty class with its sharing mode', () => {
    expect(emitClass(emptyClass())).toBe('public with sharing class MyHandler {\n}');
  });

  it('emits without sharing when the Flow says so', () => {
    expect(emitClass(emptyClass({ sharing: 'without sharing' })))
      .toContain('public without sharing class MyHandler {');
  });

  it('emits an ApexDoc header', () => {
    const out = emitClass(emptyClass({ doc: ['Generated from Flow: MyFlow.', 'Do not edit.'] }));
    expect(out).toContain('/**\n * Generated from Flow: MyFlow.\n * Do not edit.\n */');
    expect(out.indexOf('/**')).toBeLessThan(out.indexOf('class MyHandler'));
  });

  it('emits a static final constant', () => {
    const out = emitClass(emptyClass({
      fields: [{
        visibility: 'private', isStatic: true, isFinal: true,
        type: STRING, name: 'FIELD_NAME', init: literal(STRING, "'Amount__c'"),
      }],
    }));
    expect(out).toContain("    private static final String FIELD_NAME = 'Amount__c';");
  });

  it('emits a field with no initialiser', () => {
    const out = emitClass(emptyClass({
      fields: [{
        visibility: 'public', isStatic: false, isFinal: false,
        type: STRING, name: 'Message', init: null,
      }],
    }));
    expect(out).toContain('    public String Message;');
  });

  it('emits a void method with parameters and an indented body', () => {
    const out = emitClass(emptyClass({
      methods: [{
        visibility: 'public', isStatic: true, returnType: null, name: 'execute',
        params: [{ type: listOf(sobjectType('Account')), name: 'records' }],
        body: [declare(DECIMAL, 'total', literal(DECIMAL, '0'))],
        doc: [],
      }],
    }));
    expect(out).toContain('    public static void execute(List<Account> records) {');
    expect(out).toContain('        Decimal total = 0;');
    expect(out).toContain('    }');
  });

  it('emits a method with a return type and several parameters', () => {
    const out = emitClass(emptyClass({
      methods: [{
        visibility: 'private', isStatic: true, returnType: BOOLEAN, name: 'isReady',
        params: [{ type: STRING, name: 'stage' }, { type: DECIMAL, name: 'amount' }],
        body: [assign('flag', literal(BOOLEAN, 'true'))],
        doc: [],
      }],
    }));
    expect(out).toContain('    private static Boolean isReady(String stage, Decimal amount) {');
  });

  it('emits a method with an empty body without a stray blank line', () => {
    const out = emitClass(emptyClass({
      methods: [{
        visibility: 'public', isStatic: true, returnType: null, name: 'noop',
        params: [], body: [], doc: [],
      }],
    }));
    expect(out).toContain('    public static void noop() {\n    }');
  });

  it('emits an ApexDoc block above a method', () => {
    const out = emitClass(emptyClass({
      methods: [{
        visibility: 'private', isStatic: true, returnType: BOOLEAN, name: 'stubbed',
        params: [], body: [], doc: ['TODO: formula not translated.'],
      }],
    }));
    expect(out).toContain('    /**\n     * TODO: formula not translated.\n     */');
  });

  it('emits an inner class indented inside its parent', () => {
    const out = emitClass(emptyClass({
      inner: [{
        name: 'Result', sharing: 'with sharing', doc: [], inner: [], methods: [],
        fields: [{
          visibility: 'public', isStatic: false, isFinal: false,
          type: STRING, name: 'message', init: null,
        }],
      }],
    }));
    expect(out).toContain('    public with sharing class Result {');
    expect(out).toContain('        public String message;');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/apex/class.test.ts`
Expected: FAIL — cannot find module `src/apex/class.js`.

- [ ] **Step 3: Implement `src/apex/class.ts`**

```typescript
import { emitExpr, emitStmt } from './emit.js';
import { ApexExpr } from './expr.js';
import { ApexStmt } from './stmt.js';
import { ApexType, renderType } from './types.js';

const INDENT = '    ';

export type Visibility = 'public' | 'private' | 'global';
export type Sharing = 'with sharing' | 'without sharing' | 'inherited sharing';

export interface ApexParam {
  type: ApexType;
  name: string;
}

export interface ApexField {
  visibility: Visibility;
  isStatic: boolean;
  isFinal: boolean;
  type: ApexType;
  name: string;
  init: ApexExpr | null;
}

export interface ApexMethod {
  visibility: Visibility;
  isStatic: boolean;
  /** null is void. */
  returnType: ApexType | null;
  name: string;
  params: ApexParam[];
  body: ApexStmt[];
  /** ApexDoc lines, without the comment markers. */
  doc: string[];
}

export interface ApexClass {
  name: string;
  sharing: Sharing;
  doc: string[];
  fields: ApexField[];
  methods: ApexMethod[];
  inner: ApexClass[];
}

/** An ApexDoc block at `pad`, or nothing when there is no documentation. */
function doc(lines: string[], pad: string): string {
  if (lines.length === 0) return '';
  const body = lines.map((l) => `${pad} * ${l}`).join('\n');
  return `${pad}/**\n${body}\n${pad} */\n`;
}

function emitField(f: ApexField, pad: string): string {
  const parts = [f.visibility];
  if (f.isStatic) parts.push('static');
  if (f.isFinal) parts.push('final');
  parts.push(renderType(f.type), f.name);
  const head = `${pad}${parts.join(' ')}`;
  return f.init === null ? `${head};` : `${head} = ${emitExpr(f.init)};`;
}

function emitMethod(m: ApexMethod, depth: number): string {
  const pad = INDENT.repeat(depth);
  const parts = [m.visibility];
  if (m.isStatic) parts.push('static');
  parts.push(m.returnType === null ? 'void' : renderType(m.returnType));
  const params = m.params.map((p) => `${renderType(p.type)} ${p.name}`).join(', ');
  const signature = `${pad}${parts.join(' ')} ${m.name}(${params}) {`;
  const body = m.body.map((s) => emitStmt(s, depth + 1)).join('\n');
  const closed = body === '' ? `${signature}\n${pad}}` : `${signature}\n${body}\n${pad}}`;
  return doc(m.doc, pad) + closed;
}

export function emitClass(c: ApexClass, depth = 0): string {
  const pad = INDENT.repeat(depth);
  const members = [
    ...c.fields.map((f) => emitField(f, pad + INDENT)),
    ...c.methods.map((m) => emitMethod(m, depth + 1)),
    ...c.inner.map((i) => emitClass(i, depth + 1)),
  ];
  const header = `${pad}public ${c.sharing} class ${c.name} {`;
  const body = members.join('\n\n');
  const closed = body === '' ? `${header}\n${pad}}` : `${header}\n${body}\n${pad}}`;
  return doc(c.doc, pad) + closed;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx jest tests/apex/class.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/apex/class.ts tests/apex/class.test.ts
git commit -m "feat(apex): add class and method structure

Milestone 2b parked ApexClass until there was a class to build. Lowering
builds one, so it lands now: fields, methods, ApexDoc and inner classes,
with sharing driven by the Flow's runInMode."
```

---

### Task 3: Control-flow graph, post-dominators and the reducibility verdict

The module where a bug is least visible and most damaging, so it is tested
against hand-built graphs before any Flow is lowered.

**Files:**
- Create: `src/lower/cfg.ts`
- Test: `tests/lower/cfg.test.ts`

**Interfaces:**
- Consumes: `FlowIR`, `FlowNode` from `src/ir/types.js`
- Produces, all from `src/lower/cfg.ts`:
  - `type EdgeKind = 'next' | 'rule' | 'default' | 'body' | 'after' | 'fault'`
  - `interface CfgEdge { from: string; to: string; kind: EdgeKind }`
  - `interface Cfg { entry?: string; order: string[]; node(name: string): FlowNode | undefined; successors(name: string): CfgEdge[]; predecessors(name: string): CfgEdge[] }`
  - `buildCfg(ir: FlowIR): Cfg`
  - `interface StructureReport { ok: boolean; problems: string[] }`
  - `checkStructure(cfg: Cfg): StructureReport`
  - `postDominators(cfg: Cfg): Map<string, Set<string>>`
  - `immediatePostDominator(cfg: Cfg, node: string): string | undefined`

- [ ] **Step 1: Write the failing tests**

Create `tests/lower/cfg.test.ts`:

```typescript
import { FlowIR, FlowNode } from '../../src/ir/types.js';
import { buildCfg, checkStructure, immediatePostDominator } from '../../src/lower/cfg.js';

function node(name: string, over: Partial<FlowNode> = {}): FlowNode {
  return { name, kind: 'assignments', connectors: [], sourceJson: '{}', raw: {}, ...over };
}

function plain(name: string, next?: string): FlowNode {
  return node(name, { connectors: next ? [{ target: next, isFault: false }] : [] });
}

function decision(name: string, ruleTarget: string, defaultTarget: string): FlowNode {
  return node(name, {
    kind: 'decisions',
    // Flow writes branch targets into BOTH rules and connectors. Reading both
    // emits every branch twice, so the CFG must take one and ignore the other.
    connectors: [
      { target: ruleTarget, isFault: false },
      { target: defaultTarget, isFault: false },
    ],
    body: {
      kind: 'decision',
      rules: [{ name: 'r1', conditionLogic: 'and', conditions: [], target: ruleTarget }],
      defaultTarget,
    },
  });
}

function loop(name: string, bodyTarget: string, afterTarget?: string): FlowNode {
  return node(name, {
    kind: 'loops',
    connectors: [{ target: bodyTarget, isFault: false }],
    body: { kind: 'loop', collection: 'items', bodyTarget, afterTarget },
  });
}

function ir(nodes: FlowNode[], entry: string): FlowIR {
  return {
    flowName: 'T', processType: 'AutoLaunchedFlow', declarations: [], nodes,
    unsupported: [],
    start: { triggerKind: 'autolaunched', connector: { target: entry, isFault: false }, sourceJson: '{}' },
  };
}

describe('buildCfg', () => {
  it('takes decision edges from rules, not from duplicated connectors', () => {
    const cfg = buildCfg(ir([decision('D', 'A', 'B'), plain('A'), plain('B')], 'D'));
    const kinds = cfg.successors('D').map((e) => `${e.kind}:${e.to}`).sort();
    expect(kinds).toEqual(['default:B', 'rule:A']);
  });

  it('takes loop edges from bodyTarget and afterTarget', () => {
    const cfg = buildCfg(ir([loop('L', 'A', 'B'), plain('A', 'L'), plain('B')], 'L'));
    const kinds = cfg.successors('L').map((e) => `${e.kind}:${e.to}`).sort();
    expect(kinds).toEqual(['after:B', 'body:A']);
  });

  it('keeps fault edges as a separate kind', () => {
    const n = node('A', {
      connectors: [
        { target: 'B', isFault: false },
        { target: 'F', isFault: true },
      ],
    });
    const cfg = buildCfg(ir([n, plain('B'), plain('F')], 'A'));
    expect(cfg.successors('A').map((e) => e.kind).sort()).toEqual(['fault', 'next']);
  });

  it('records the entry from the start element', () => {
    expect(buildCfg(ir([plain('A')], 'A')).entry).toBe('A');
  });

  it('computes predecessors', () => {
    const cfg = buildCfg(ir([decision('D', 'A', 'B'), plain('A', 'B'), plain('B')], 'D'));
    expect(cfg.predecessors('B').map((e) => e.from).sort()).toEqual(['A', 'D']);
  });
});

describe('immediatePostDominator', () => {
  it('finds the join where two branches reconverge', () => {
    // D -> A -> J, D -> J. The join is J.
    const cfg = buildCfg(ir([decision('D', 'A', 'J'), plain('A', 'J'), plain('J')], 'D'));
    expect(immediatePostDominator(cfg, 'D')).toBe('J');
  });

  it('finds the join when both branches have bodies', () => {
    const cfg = buildCfg(ir(
      [decision('D', 'A', 'B'), plain('A', 'J'), plain('B', 'J'), plain('J')], 'D'));
    expect(immediatePostDominator(cfg, 'D')).toBe('J');
  });

  it('returns undefined when branches never reconverge', () => {
    const cfg = buildCfg(ir([decision('D', 'A', 'B'), plain('A'), plain('B')], 'D'));
    expect(immediatePostDominator(cfg, 'D')).toBeUndefined();
  });

  it('skips a node that only one branch passes through', () => {
    // D -> A -> J, D -> J. A post-dominates nothing, so it is not the join.
    const cfg = buildCfg(ir([decision('D', 'A', 'J'), plain('A', 'J'), plain('J')], 'D'));
    expect(immediatePostDominator(cfg, 'D')).not.toBe('A');
  });
});

describe('checkStructure', () => {
  it('accepts a decision whose branches join', () => {
    const cfg = buildCfg(ir(
      [decision('D', 'A', 'B'), plain('A', 'J'), plain('B', 'J'), plain('J')], 'D'));
    expect(checkStructure(cfg).ok).toBe(true);
  });

  it('accepts a decision whose branches both terminate', () => {
    const cfg = buildCfg(ir([decision('D', 'A', 'B'), plain('A'), plain('B')], 'D'));
    expect(checkStructure(cfg).ok).toBe(true);
  });

  it('accepts a loop whose body returns to the loop node', () => {
    const cfg = buildCfg(ir([loop('L', 'A', 'B'), plain('A', 'L'), plain('B')], 'L'));
    expect(checkStructure(cfg).ok).toBe(true);
  });

  it('refuses a back-edge that does not target a loop node', () => {
    // A -> B -> A is a cycle with no loop element to structure it.
    const cfg = buildCfg(ir([plain('A', 'B'), plain('B', 'A')], 'A'));
    const report = checkStructure(cfg);
    expect(report.ok).toBe(false);
    expect(report.problems.join(' ')).toMatch(/back-edge/i);
  });

  it('names the offending nodes in the report', () => {
    const cfg = buildCfg(ir([plain('A', 'B'), plain('B', 'A')], 'A'));
    expect(checkStructure(cfg).problems.join(' ')).toContain('B');
  });

  it('reports unreachable nodes', () => {
    const cfg = buildCfg(ir([plain('A'), plain('Orphan')], 'A'));
    const report = checkStructure(cfg);
    expect(report.ok).toBe(false);
    expect(report.problems.join(' ')).toMatch(/unreachable.*Orphan/i);
  });

  it('reports an edge to a node that does not exist', () => {
    const cfg = buildCfg(ir([plain('A', 'Missing')], 'A'));
    const report = checkStructure(cfg);
    expect(report.ok).toBe(false);
    expect(report.problems.join(' ')).toContain('Missing');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/lower/cfg.test.ts`
Expected: FAIL — cannot find module `src/lower/cfg.js`.

- [ ] **Step 3: Implement `src/lower/cfg.ts`**

```typescript
import { FlowIR, FlowNode } from '../ir/types.js';

export type EdgeKind = 'next' | 'rule' | 'default' | 'body' | 'after' | 'fault';

export interface CfgEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}

export interface Cfg {
  entry?: string;
  /** Node names in declaration order, for stable diagnostics. */
  order: string[];
  node(name: string): FlowNode | undefined;
  successors(name: string): CfgEdge[];
  predecessors(name: string): CfgEdge[];
}

/**
 * Successor edges for one element.
 *
 * Decision and loop elements write their targets into BOTH the typed body and
 * `connectors[]` — the same edges twice. The body is authoritative; reading
 * `connectors` as well would emit every branch and every loop body twice.
 * Fault connectors are the exception: they appear only in `connectors[]`.
 */
function edgesFor(n: FlowNode): CfgEdge[] {
  const edges: CfgEdge[] = [];
  const faults = n.connectors.filter((c) => c.isFault);
  const normal = n.connectors.filter((c) => !c.isFault);

  if (n.body?.kind === 'decision') {
    for (const rule of n.body.rules) {
      if (rule.target) edges.push({ from: n.name, to: rule.target, kind: 'rule' });
    }
    if (n.body.defaultTarget) {
      edges.push({ from: n.name, to: n.body.defaultTarget, kind: 'default' });
    }
  } else if (n.body?.kind === 'loop') {
    if (n.body.bodyTarget) edges.push({ from: n.name, to: n.body.bodyTarget, kind: 'body' });
    if (n.body.afterTarget) edges.push({ from: n.name, to: n.body.afterTarget, kind: 'after' });
  } else {
    for (const c of normal) edges.push({ from: n.name, to: c.target, kind: 'next' });
  }

  for (const f of faults) edges.push({ from: n.name, to: f.target, kind: 'fault' });
  return edges;
}

export function buildCfg(ir: FlowIR): Cfg {
  const nodes = new Map<string, FlowNode>();
  for (const n of ir.nodes) nodes.set(n.name, n);

  const succ = new Map<string, CfgEdge[]>();
  const pred = new Map<string, CfgEdge[]>();
  for (const n of ir.nodes) {
    const edges = edgesFor(n);
    succ.set(n.name, edges);
    for (const e of edges) {
      const list = pred.get(e.to) ?? [];
      list.push(e);
      pred.set(e.to, list);
    }
  }

  return {
    entry: ir.start?.connector?.target,
    order: ir.nodes.map((n) => n.name),
    node: (name) => nodes.get(name),
    successors: (name) => succ.get(name) ?? [],
    predecessors: (name) => pred.get(name) ?? [],
  };
}

/** Nodes reachable from the entry, following every edge kind. */
export function reachable(cfg: Cfg): Set<string> {
  const seen = new Set<string>();
  const stack = cfg.entry ? [cfg.entry] : [];
  while (stack.length > 0) {
    const name = stack.pop() as string;
    if (seen.has(name)) continue;
    seen.add(name);
    for (const e of cfg.successors(name)) stack.push(e.to);
  }
  return seen;
}

/**
 * Post-dominator sets by iterative dataflow on the reversed graph.
 *
 * Deliberately the simple O(n^2) formulation rather than Lengauer-Tarjan. These
 * graphs are tens of nodes, and this version can be checked by hand against the
 * test cases — which matters more here than speed.
 */
export function postDominators(cfg: Cfg): Map<string, Set<string>> {
  const names = cfg.order.filter((n) => reachable(cfg).has(n));
  const all = new Set(names);
  const exits = names.filter((n) => cfg.successors(n).length === 0);

  const pdom = new Map<string, Set<string>>();
  for (const n of names) pdom.set(n, exits.includes(n) ? new Set([n]) : new Set(all));
  for (const e of exits) pdom.set(e, new Set([e]));

  let changed = true;
  while (changed) {
    changed = false;
    for (const n of names) {
      if (exits.includes(n)) continue;
      const succs = cfg.successors(n).map((e) => e.to).filter((t) => all.has(t));
      let next: Set<string>;
      if (succs.length === 0) {
        next = new Set([n]);
      } else {
        next = new Set(pdom.get(succs[0]) ?? []);
        for (const s of succs.slice(1)) {
          const other = pdom.get(s) ?? new Set<string>();
          next = new Set([...next].filter((x) => other.has(x)));
        }
        next.add(n);
      }
      const before = pdom.get(n) as Set<string>;
      if (before.size !== next.size || [...next].some((x) => !before.has(x))) {
        pdom.set(n, next);
        changed = true;
      }
    }
  }
  return pdom;
}

/**
 * The nearest node every path out of `node` must pass through — the join where
 * a decision's branches reconverge. Undefined when they never do.
 */
export function immediatePostDominator(cfg: Cfg, node: string): string | undefined {
  const pdom = postDominators(cfg);
  const candidates = [...(pdom.get(node) ?? [])].filter((n) => n !== node);
  if (candidates.length === 0) return undefined;
  // The immediate one is post-dominated by every other candidate.
  for (const c of candidates) {
    const cSet = pdom.get(c) ?? new Set<string>();
    if (candidates.every((other) => other === c || cSet.has(other))) return c;
  }
  return undefined;
}

export interface StructureReport {
  ok: boolean;
  problems: string[];
}

/**
 * Whether this graph can be rebuilt as structured Apex.
 *
 * A refusal is a whole-Flow failure. Half a class whose control flow was
 * guessed is worse than no class, so every problem is collected and reported
 * together rather than throwing on the first.
 */
export function checkStructure(cfg: Cfg): StructureReport {
  const problems: string[] = [];
  const live = reachable(cfg);

  for (const name of cfg.order) {
    for (const e of cfg.successors(name)) {
      if (!cfg.node(e.to)) {
        problems.push(`${name} connects to '${e.to}', which is not an element in this Flow.`);
      }
    }
  }

  for (const name of cfg.order) {
    // Wording matters: the test asserts /unreachable.*Orphan/i, so the word
    // comes before the name.
    if (!live.has(name)) problems.push(`Unreachable from the Flow's start element: ${name}.`);
  }

  // Every cycle must be closed by a loop element. A back-edge to anything else
  // is a goto, and Apex has no goto.
  const state = new Map<string, 'open' | 'done'>();
  const walk = (name: string): void => {
    state.set(name, 'open');
    for (const e of cfg.successors(name)) {
      if (!cfg.node(e.to)) continue;
      const seen = state.get(e.to);
      if (seen === 'open') {
        const target = cfg.node(e.to);
        if (target?.body?.kind !== 'loop') {
          problems.push(
            `${name} has a back-edge to ${e.to}, which is not a loop element. ` +
              `Apex has no goto, so this cycle cannot be structured.`
          );
        }
      } else if (seen === undefined) {
        walk(e.to);
      }
    }
    state.set(name, 'done');
  };
  if (cfg.entry && cfg.node(cfg.entry)) walk(cfg.entry);

  // A decision whose branches never reconverge is NOT a refusal. Each branch
  // simply runs to the end of the Flow, which lowerFrom handles with an
  // undefined stop node. The refusals above — a back-edge to something that is
  // not a loop, an unreachable node, an edge to a node that does not exist —
  // are the shapes that genuinely cannot be rebuilt as structured Apex.

  return { ok: problems.length === 0, problems };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx jest tests/lower/cfg.test.ts`
Expected: PASS (16 tests). If `postDominators` loops forever, the fixed-point
comparison is wrong — check that `next` is compared by content, not identity.

- [ ] **Step 5: Verify against the real fixture**

Run:

```bash
pnpm build && node -e "
const {parseFlowXml}=require('./dist/ir/parseFlow.js');
const {buildCfg,checkStructure}=require('./dist/lower/cfg.js');
const fs=require('fs');
(async()=>{
  const ir=await parseFlowXml(fs.readFileSync('exampleflow.xml','utf8'));
  const r=checkStructure(buildCfg(ir));
  console.log('ok=',r.ok); r.problems.forEach(p=>console.log(' -',p));
})();"
```

Expected: `ok= true`. The fixture's graph is known to reduce; if it does not,
the bug is in this task, not in the Flow.

- [ ] **Step 6: Commit**

```bash
git add src/lower/cfg.ts tests/lower/cfg.test.ts
git commit -m "feat(lower): build a control-flow graph with a reducibility verdict

Decision and loop elements write their targets into both the typed body
and connectors[] — the same edges twice. The body is authoritative; reading
both would emit every branch twice.

Post-dominators use plain iterative dataflow rather than Lengauer-Tarjan.
These graphs are tens of nodes, and an algorithm that can be checked by
hand against its tests is worth more here than an asymptotically faster
one that has to be trusted.

A graph that cannot be structured is refused whole, with every problem
collected and named rather than throwing on the first."
```

---

### Task 4: Lowering context and the type source

**Files:**
- Create: `src/lower/context.ts`
- Create: `src/lower/typeSource.ts`
- Test: `tests/lower/typeSource.test.ts`

**Interfaces:**
- Consumes: `FlowIR`, `FlowDeclaration`, `FlowNode`; `ApexType`, `Scope`
- Produces, from `src/lower/context.ts`:
  - `type Provenance = 'declared' | 'standard' | 'heuristic'`
  - `interface ResolvedType { type: ApexType; provenance: Provenance; note: string }`
  - `interface TypeSource { resolve(reference: string): ResolvedType }`
  - `interface LoweringNote { kind: 'guess' | 'stub' | 'dependency'; detail: string }`
  - `class LoweringRefusal extends Error { readonly problems: string[] }`
  - `interface LowerContext { ir: FlowIR; types: TypeSource; scope: Scope; names: Map<string, string>; notes: LoweringNote[]; stubs: Map<string, ApexMethod> }`
  - `apexName(ctx: LowerContext, flowName: string): string`
- Produces, from `src/lower/typeSource.ts`:
  - `declarationTypeSource(ir: FlowIR): TypeSource`
  - `flowTypeToApex(dataType: string, objectType: string | undefined, isCollection: boolean): ApexType`

- [ ] **Step 1: Write the failing tests**

Create `tests/lower/typeSource.test.ts`:

```typescript
import { FlowDeclaration, FlowIR, FlowNode } from '../../src/ir/types.js';
import { declarationTypeSource, flowTypeToApex } from '../../src/lower/typeSource.js';
import { BOOLEAN, DECIMAL, ID, STRING, listOf, sobjectType } from '../../src/apex/types.js';

function decl(over: Partial<FlowDeclaration> & { name: string }): FlowDeclaration {
  return {
    kind: 'variable', dataType: 'String', isCollection: false,
    isInput: false, isOutput: false, sourceJson: '{}', ...over,
  };
}

function ir(declarations: FlowDeclaration[], nodes: FlowNode[] = []): FlowIR {
  return { flowName: 'T', processType: 'AutoLaunchedFlow', declarations, nodes, unsupported: [] };
}

describe('flowTypeToApex', () => {
  it('maps Flow scalar types to Apex', () => {
    expect(flowTypeToApex('String', undefined, false)).toEqual(STRING);
    expect(flowTypeToApex('Boolean', undefined, false)).toEqual(BOOLEAN);
    expect(flowTypeToApex('Number', undefined, false)).toEqual(DECIMAL);
    expect(flowTypeToApex('Currency', undefined, false)).toEqual(DECIMAL);
  });

  it('maps an SObject to its concrete type', () => {
    expect(flowTypeToApex('SObject', 'Account', false)).toEqual(sobjectType('Account'));
  });

  it('wraps a collection in a List', () => {
    expect(flowTypeToApex('SObject', 'Account', true)).toEqual(listOf(sobjectType('Account')));
  });
});

describe('declarationTypeSource', () => {
  it('types a declared variable exactly', () => {
    const ts = declarationTypeSource(ir([decl({ name: 'IsBrokerDeal', dataType: 'Boolean' })]));
    const r = ts.resolve('IsBrokerDeal');
    expect(r.type).toEqual(BOOLEAN);
    expect(r.provenance).toBe('declared');
  });

  it('types a declared SObject collection exactly', () => {
    const ts = declarationTypeSource(ir([
      decl({ name: 'LoansInPP', dataType: 'SObject', objectType: 'LLC_BI__Loan__c', isCollection: true }),
    ]));
    expect(ts.resolve('LoansInPP').type).toEqual(listOf(sobjectType('LLC_BI__Loan__c')));
  });

  it('types a standard field from the standard-field table', () => {
    const ts = declarationTypeSource(ir([
      decl({ name: 'Acct', dataType: 'SObject', objectType: 'Account' }),
    ]));
    const r = ts.resolve('Acct.Id');
    expect(r.type).toEqual(ID);
    expect(r.provenance).toBe('standard');
  });

  it('falls back to a heuristic for a custom field, and says so', () => {
    const ts = declarationTypeSource(ir([
      decl({ name: 'Acct', dataType: 'SObject', objectType: 'Account' }),
    ]));
    const r = ts.resolve('Acct.NC_Amount_for_Commission_Calculation__c');
    expect(r.provenance).toBe('heuristic');
    expect(r.note).toMatch(/name/i);
  });

  it('resolves a field through a loop element to its collection element type', () => {
    // `Loop_over_Loans.Id` names the loop, not a variable. Its element type is
    // the element type of the collection it iterates.
    const loopNode: FlowNode = {
      name: 'Loop_over_Loans', kind: 'loops', connectors: [], sourceJson: '{}', raw: {},
      body: { kind: 'loop', collection: 'LoansInPP', bodyTarget: 'X' },
    };
    const ts = declarationTypeSource(ir(
      [decl({ name: 'LoansInPP', dataType: 'SObject', objectType: 'LLC_BI__Loan__c', isCollection: true })],
      [loopNode]
    ));
    expect(ts.resolve('Loop_over_Loans.Id').type).toEqual(ID);
    expect(ts.resolve('Loop_over_Loans.Name').type).toEqual(STRING);
  });

  it('types a custom permission reference as Boolean', () => {
    const r = declarationTypeSource(ir([])).resolve('$Permission.NC_RBNZ_TDTI');
    expect(r.type).toEqual(BOOLEAN);
  });

  it('falls back to a heuristic for an unknown reference rather than throwing', () => {
    // Refusing here would refuse the Flow; a flagged guess is the agreed policy.
    expect(declarationTypeSource(ir([])).resolve('Mystery').provenance).toBe('heuristic');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/lower/typeSource.test.ts`
Expected: FAIL — cannot find module `src/lower/typeSource.js`.

- [ ] **Step 3: Implement `src/lower/context.ts`**

```typescript
import { ApexMethod } from '../apex/class.js';
import { ApexExpr } from '../apex/expr.js';
import { Scope } from '../apex/scope.js';
import { ApexType } from '../apex/types.js';
import { FlowIR } from '../ir/types.js';

/** Where a type came from. Milestone 3 adds 'describe' above 'declared'. */
export type Provenance = 'declared' | 'standard' | 'heuristic';

export interface ResolvedType {
  type: ApexType;
  provenance: Provenance;
  /** Human-readable reason, shown in the generated class for guesses. */
  note: string;
}

export interface TypeSource {
  resolve(reference: string): ResolvedType;
}

export interface LoweringNote {
  kind: 'guess' | 'stub' | 'dependency';
  detail: string;
}

/**
 * A Flow whose structure could not be determined. Carries every problem, not
 * just the first: a developer fixing one shape wants to see the rest.
 */
export class LoweringRefusal extends Error {
  constructor(public readonly problems: string[]) {
    super(`Cannot lower this Flow:\n  - ${problems.join('\n  - ')}`);
    this.name = 'LoweringRefusal';
  }
}

export interface LowerContext {
  ir: FlowIR;
  types: TypeSource;
  scope: Scope;
  /** Flow declaration or element name -> the Apex identifier allocated for it. */
  names: Map<string, string>;
  notes: LoweringNote[];
  /** Private methods generated for untranslatable formulas and actions. */
  stubs: Map<string, ApexMethod>;
  /**
   * Formula name -> the expression it lowers to, populated before the walk.
   *
   * A formula is not a variable and is never declared, so a reference to one
   * must resolve to its stub call or its exact translation. Holding the map
   * here rather than calling into the stub module from value.ts keeps those two
   * modules from importing each other.
   */
  formulas: Map<string, ApexExpr>;
}

/**
 * The Apex identifier for a Flow name, allocated once and reused.
 *
 * Every Flow name goes through Scope, so a Flow element called `Update` or a
 * variable called `List` cannot produce a class that will not compile.
 */
export function apexName(ctx: LowerContext, flowName: string): string {
  const existing = ctx.names.get(flowName);
  if (existing !== undefined) return existing;
  const allocated = ctx.scope.allocate(flowName);
  ctx.names.set(flowName, allocated);
  return allocated;
}
```

- [ ] **Step 4: Implement `src/lower/typeSource.ts`**

```typescript
import {
  ApexType, BOOLEAN, DATE, DATETIME, DECIMAL, ID, STRING, listOf, sobjectType,
} from '../apex/types.js';
import { FlowIR } from '../ir/types.js';
import { ResolvedType, TypeSource } from './context.js';

/** Standard fields present on every SObject, typed from the platform, not guessed. */
const STANDARD_FIELDS: Record<string, ApexType> = {
  id: ID,
  ownerid: ID,
  createdbyid: ID,
  lastmodifiedbyid: ID,
  name: STRING,
  createddate: DATETIME,
  lastmodifieddate: DATETIME,
  isdeleted: BOOLEAN,
};

/** Flow's dataType vocabulary mapped onto the Apex type model. */
export function flowTypeToApex(
  dataType: string,
  objectType: string | undefined,
  isCollection: boolean
): ApexType {
  const scalar = ((): ApexType => {
    switch (dataType.toLowerCase()) {
      case 'string':
      case 'picklist':
      case 'multipicklist':
      case 'phone':
      case 'email':
      case 'url':
      case 'textarea':
        return STRING;
      case 'boolean':
        return BOOLEAN;
      case 'number':
      case 'currency':
      case 'double':
      case 'percent':
        return DECIMAL;
      case 'int':
      case 'integer':
        return DECIMAL;
      case 'date':
        return DATE;
      case 'datetime':
        return DATETIME;
      case 'sobject':
        return sobjectType(objectType);
      default:
        // Apex-defined types and anything unrecognised. An Apex-defined type is
        // a class the converter cannot see, so it is modelled as an SObject-free
        // opaque name when one is given, and as String otherwise.
        return objectType ? sobjectType(objectType) : STRING;
    }
  })();
  return isCollection ? listOf(scalar) : scalar;
}

/**
 * Naming heuristics — the 2.0.x behaviour, kept only as a last resort and
 * always reported as a guess. Milestone 3 replaces this with a describe.
 */
function heuristicFieldType(field: string): ApexType {
  const f = field.toLowerCase();
  if (f.endsWith('id') || f.endsWith('__r')) return ID;
  if (f.startsWith('is') || f.startsWith('has') || f.includes('flag')) return BOOLEAN;
  if (f.includes('amount') || f.includes('rate') || f.includes('total') || f.includes('count')) {
    return DECIMAL;
  }
  if (f.includes('date')) return DATETIME;
  return STRING;
}

/**
 * Types resolved from the Flow's own declarations, then the standard-field
 * table, then naming heuristics.
 *
 * Never throws. A reference this cannot place resolves to a flagged String
 * guess, because refusing here would refuse the whole Flow over one unknown
 * name — and the agreed policy is that unknown TYPES are flagged while unknown
 * STRUCTURE is refused.
 */
export function declarationTypeSource(ir: FlowIR): TypeSource {
  const declarations = new Map(ir.declarations.map((d) => [d.name.toLowerCase(), d]));
  const loops = new Map(
    ir.nodes
      .filter((n) => n.body?.kind === 'loop')
      .map((n) => [n.name.toLowerCase(), n])
  );

  /** The SObject a dotted reference's first segment refers to, if any. */
  const objectOf = (head: string): string | undefined => {
    const declared = declarations.get(head.toLowerCase());
    if (declared?.objectType) return declared.objectType;
    const loop = loops.get(head.toLowerCase());
    if (loop && loop.body?.kind === 'loop') {
      const source = declarations.get(loop.body.collection.toLowerCase());
      if (source?.objectType) return source.objectType;
    }
    return undefined;
  };

  const resolveField = (object: string | undefined, field: string): ResolvedType => {
    const standard = STANDARD_FIELDS[field.toLowerCase()];
    if (standard) {
      return { type: standard, provenance: 'standard', note: `${field} is a standard field` };
    }
    return {
      type: heuristicFieldType(field),
      provenance: 'heuristic',
      note: `type of ${object ?? '?'}.${field} guessed from its name`,
    };
  };

  return {
    resolve(reference: string): ResolvedType {
      if (reference.startsWith('$Permission.')) {
        return { type: BOOLEAN, provenance: 'standard', note: 'custom permission check' };
      }

      const dot = reference.indexOf('.');
      if (dot === -1) {
        const declared = declarations.get(reference.toLowerCase());
        if (declared) {
          return {
            type: flowTypeToApex(declared.dataType, declared.objectType, declared.isCollection),
            provenance: 'declared',
            note: `${reference} declared as ${declared.dataType}`,
          };
        }
        return {
          type: STRING,
          provenance: 'heuristic',
          note: `${reference} is not declared in this Flow; assumed String`,
        };
      }

      const head = reference.slice(0, dot);
      const field = reference.slice(dot + 1);
      return resolveField(objectOf(head), field);
    },
  };
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx jest tests/lower/typeSource.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lower/context.ts src/lower/typeSource.ts tests/lower/typeSource.test.ts
git commit -m "feat(lower): resolve types from declarations with provenance

Declarations type most references exactly. SObject field reads fall to a
standard-field table and then to naming heuristics, and every heuristic
result is marked so the generated class can say which casts were guessed.

A reference through a loop element resolves to its collection's element
type: Loop_over_Loans.Id names the loop, not a variable.

Resolution never throws. Unknown TYPES are flagged; only unknown
STRUCTURE refuses the Flow."
```

---

### Task 5: Values

**Files:**
- Create: `src/lower/value.ts`
- Test: `tests/lower/value.test.ts`

**Interfaces:**
- Consumes: `FlowValue`; `LowerContext`, `apexName`; `stringLiteral`, `literal`, `variable`, `fieldRead`, `methodCall`
- Produces, from `src/lower/value.ts`:
  - `lowerValue(value: FlowValue, ctx: LowerContext): ApexExpr`
  - `lowerReference(reference: string, ctx: LowerContext): ApexExpr`
  - `class UnsupportedConstructError extends Error`

- [ ] **Step 1: Write the failing tests**

Create `tests/lower/value.test.ts`:

```typescript
import { emitExpr } from '../../src/apex/emit.js';
import { Scope } from '../../src/apex/scope.js';
import { BOOLEAN, DECIMAL, STRING } from '../../src/apex/types.js';
import { FlowIR } from '../../src/ir/types.js';
import { LowerContext } from '../../src/lower/context.js';
import { declarationTypeSource } from '../../src/lower/typeSource.js';
import { literal } from '../../src/apex/expr.js';
import { UnsupportedConstructError, lowerValue } from '../../src/lower/value.js';

const literalTrue = () => literal(BOOLEAN, 'true');

function ctx(ir?: Partial<FlowIR>): LowerContext {
  const full: FlowIR = {
    flowName: 'T', processType: 'AutoLaunchedFlow', declarations: [], nodes: [],
    unsupported: [], ...ir,
  };
  return {
    ir: full, types: declarationTypeSource(full), scope: new Scope(),
    names: new Map(), notes: [], stubs: new Map(), formulas: new Map(),
  };
}

describe('lowerValue', () => {
  it('escapes a string value rather than interpolating it', () => {
    // The O'Brien case, arriving from real Flow data for the first time.
    expect(emitExpr(lowerValue({ kind: 'string', raw: "O'Brien" }, ctx())))
      .toBe("'O\\'Brien'");
  });

  it('lowers a number', () => {
    expect(emitExpr(lowerValue({ kind: 'number', raw: '1000' }, ctx()))).toBe('1000');
  });

  it('lowers a negative number', () => {
    expect(emitExpr(lowerValue({ kind: 'number', raw: '-2.5' }, ctx()))).toBe('-2.5');
  });

  it('lowers booleans', () => {
    expect(emitExpr(lowerValue({ kind: 'boolean', raw: 'true' }, ctx()))).toBe('true');
    expect(emitExpr(lowerValue({ kind: 'boolean', raw: 'false' }, ctx()))).toBe('false');
  });

  it('lowers none to null', () => {
    expect(emitExpr(lowerValue({ kind: 'none' }, ctx()))).toBe('null');
  });

  it('lowers a plain reference to the allocated identifier', () => {
    const c = ctx({
      declarations: [{
        name: 'IsBrokerDeal', kind: 'variable', dataType: 'Boolean', isCollection: false,
        isInput: false, isOutput: false, sourceJson: '{}',
      }],
    });
    expect(emitExpr(lowerValue({ kind: 'reference', raw: 'IsBrokerDeal' }, c)))
      .toBe('IsBrokerDeal');
  });

  it('renames a reference that collides with an Apex keyword', () => {
    const c = ctx({
      declarations: [{
        name: 'List', kind: 'variable', dataType: 'String', isCollection: false,
        isInput: false, isOutput: false, sourceJson: '{}',
      }],
    });
    expect(emitExpr(lowerValue({ kind: 'reference', raw: 'List' }, c))).toBe('vList');
  });

  it('lowers a dotted reference to a cast field read', () => {
    const c = ctx({
      declarations: [{
        name: 'Acct', kind: 'variable', dataType: 'SObject', objectType: 'Account',
        isCollection: false, isInput: false, isOutput: false, sourceJson: '{}',
      }],
    });
    expect(emitExpr(lowerValue({ kind: 'reference', raw: 'Acct.Id' }, c)))
      .toBe("((Id)Acct.get('Id'))");
  });

  it('records a note when a field type was guessed', () => {
    const c = ctx({
      declarations: [{
        name: 'Acct', kind: 'variable', dataType: 'SObject', objectType: 'Account',
        isCollection: false, isInput: false, isOutput: false, sourceJson: '{}',
      }],
    });
    lowerValue({ kind: 'reference', raw: 'Acct.NC_Amount__c' }, c);
    expect(c.notes.filter((n) => n.kind === 'guess')).toHaveLength(1);
    expect(c.notes[0].detail).toContain('NC_Amount__c');
  });

  it('lowers a custom permission reference to a platform call', () => {
    expect(emitExpr(lowerValue({ kind: 'reference', raw: '$Permission.NC_RBNZ_TDTI' }, ctx())))
      .toBe("FeatureManagement.checkPermission('NC_RBNZ_TDTI')");
  });

  it('refuses an unmapped global reference by name rather than guessing', () => {
    expect(() => lowerValue({ kind: 'reference', raw: '$Setup.MyThing__c.Field__c' }, ctx()))
      .toThrow(UnsupportedConstructError);
  });

  it('resolves a formula reference to its registered expression', () => {
    // Formulas are not declared as variables. Without this a reference emits a
    // bare identifier for a local that is never declared, and the class will
    // not compile.
    const c = ctx();
    c.formulas.set('IsCreditAction', literalTrue());
    expect(emitExpr(lowerValue({ kind: 'reference', raw: 'IsCreditAction' }, c))).toBe('true');
  });

  it('refuses a value kind with no mapping', () => {
    expect(() => lowerValue({ kind: 'setupReference', raw: 'x' }, ctx()))
      .toThrow(UnsupportedConstructError);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/lower/value.test.ts`
Expected: FAIL — cannot find module `src/lower/value.js`.

- [ ] **Step 3: Implement `src/lower/value.ts`**

```typescript
import { ApexExpr, fieldRead, literal, methodCall, stringLiteral, variable } from '../apex/expr.js';
import { BOOLEAN, DECIMAL, STRING, sobjectType } from '../apex/types.js';
import { FlowValue } from '../ir/types.js';
import { LowerContext, apexName } from './context.js';

/**
 * A construct this milestone does not translate.
 *
 * Distinct from LoweringRefusal, which is a whole-Flow structural failure.
 * This is raised at one element and reported by name — never guessed around.
 */
export class UnsupportedConstructError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedConstructError';
  }
}

/** `$Permission.X` and friends. Each is mapped deliberately or refused. */
function lowerGlobal(reference: string): ApexExpr {
  const [head, ...rest] = reference.split('.');
  if (head === '$Permission' && rest.length === 1) {
    return methodCall(
      variable(sobjectType('FeatureManagement'), 'FeatureManagement'),
      'checkPermission',
      [stringLiteral(rest[0])],
      BOOLEAN
    );
  }
  throw new UnsupportedConstructError(
    `Global reference '${reference}' has no Apex mapping in this milestone.`
  );
}

/** A Flow reference: a variable, or a dotted path into an SObject. */
export function lowerReference(reference: string, ctx: LowerContext): ApexExpr {
  if (reference.startsWith('$')) return lowerGlobal(reference);

  // A formula is not a variable and is never declared, so a reference to one
  // resolves to the expression lowerFlow registered for it.
  const formula = ctx.formulas.get(reference);
  if (formula) return formula;

  const resolved = ctx.types.resolve(reference);
  if (resolved.provenance === 'heuristic') {
    ctx.notes.push({ kind: 'guess', detail: resolved.note });
  }

  const dot = reference.indexOf('.');
  if (dot === -1) return variable(resolved.type, apexName(ctx, reference));

  const head = reference.slice(0, dot);
  const field = reference.slice(dot + 1);
  return fieldRead(apexName(ctx, head), field, resolved.type);
}

export function lowerValue(value: FlowValue, ctx: LowerContext): ApexExpr {
  switch (value.kind) {
    case 'string':
      return stringLiteral(value.raw ?? '');
    case 'number':
      return literal(DECIMAL, value.raw ?? '0');
    case 'boolean':
      return literal(BOOLEAN, value.raw === 'true' ? 'true' : 'false');
    case 'none':
      return literal(STRING, 'null');
    case 'reference':
      return lowerReference(value.raw ?? '', ctx);
    default:
      // date, datetime, apex, sobject, formula, setupReference. Each needs a
      // deliberate mapping; none is guessed.
      throw new UnsupportedConstructError(
        `Flow value of kind '${value.kind}' has no Apex mapping in this milestone.`
      );
  }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx jest tests/lower/value.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lower/value.ts tests/lower/value.test.ts
git commit -m "feat(lower): translate Flow values to Apex expressions

Strings go through stringLiteral, so a Flow value containing an
apostrophe escapes instead of ending its own literal — the first point
where raw Flow data reaches the AST.

References resolve through the type source and are renamed through Scope,
so a variable called List cannot emit a declaration that will not compile.
A field read whose type was guessed records a note for the generated
class's header.

Value kinds and global references with no deliberate mapping are refused
by name rather than approximated."
```

---

### Task 6: Conditions and the condition-logic parser

`conditionLogic` is `and`, `or`, or a custom expression over condition indices
such as `1 AND (2 OR 3)`. `exampleflow.xml` uses the custom form, so the parser
is required scope, not a nice-to-have.

**Files:**
- Create: `src/lower/condition.ts`
- Test: `tests/lower/condition.test.ts`

**Interfaces:**
- Consumes: `FlowConditionIR`; `LowerContext`; `lowerValue`, `lowerReference`, `UnsupportedConstructError`
- Produces, from `src/lower/condition.ts`:
  - `type LogicNode = { kind: 'index'; index: number } | { kind: 'and' | 'or'; children: LogicNode[] }`
  - `parseConditionLogic(logic: string, count: number): LogicNode`
  - `lowerCondition(condition: FlowConditionIR, ctx: LowerContext): ApexExpr`
  - `lowerConditions(logic: string, conditions: FlowConditionIR[], ctx: LowerContext): ApexExpr`

- [ ] **Step 1: Write the failing tests**

Create `tests/lower/condition.test.ts`:

```typescript
import { emitExpr } from '../../src/apex/emit.js';
import { Scope } from '../../src/apex/scope.js';
import { FlowConditionIR, FlowDeclaration, FlowIR } from '../../src/ir/types.js';
import { LowerContext } from '../../src/lower/context.js';
import { declarationTypeSource } from '../../src/lower/typeSource.js';
import { UnsupportedConstructError } from '../../src/lower/value.js';
import { lowerCondition, lowerConditions, parseConditionLogic } from '../../src/lower/condition.js';

function decl(name: string, dataType: string, objectType?: string): FlowDeclaration {
  return {
    name, kind: 'variable', dataType, objectType, isCollection: false,
    isInput: false, isOutput: false, sourceJson: '{}',
  };
}

function ctx(declarations: FlowDeclaration[] = []): LowerContext {
  const ir: FlowIR = {
    flowName: 'T', processType: 'AutoLaunchedFlow', declarations, nodes: [], unsupported: [],
  };
  return {
    ir, types: declarationTypeSource(ir), scope: new Scope(),
    names: new Map(), notes: [], stubs: new Map(), formulas: new Map(),
  };
}

const cond = (left: string, operator: string, right: FlowConditionIR['right']): FlowConditionIR =>
  ({ left, operator, right });

describe('parseConditionLogic', () => {
  it('treats and as a conjunction of every condition', () => {
    expect(parseConditionLogic('and', 3)).toEqual({
      kind: 'and',
      children: [{ kind: 'index', index: 0 }, { kind: 'index', index: 1 }, { kind: 'index', index: 2 }],
    });
  });

  it('treats or as a disjunction of every condition', () => {
    expect(parseConditionLogic('or', 2).kind).toBe('or');
  });

  it('parses a custom expression with precedence and parentheses', () => {
    // AND binds tighter than OR, so 1 AND (2 OR 3) must keep the grouping.
    expect(parseConditionLogic('1 AND (2 OR 3)', 3)).toEqual({
      kind: 'and',
      children: [
        { kind: 'index', index: 0 },
        { kind: 'or', children: [{ kind: 'index', index: 1 }, { kind: 'index', index: 2 }] },
      ],
    });
  });

  it('gives AND higher precedence than OR without parentheses', () => {
    expect(parseConditionLogic('1 OR 2 AND 3', 3)).toEqual({
      kind: 'or',
      children: [
        { kind: 'index', index: 0 },
        { kind: 'and', children: [{ kind: 'index', index: 1 }, { kind: 'index', index: 2 }] },
      ],
    });
  });

  it('refuses an index outside the condition list', () => {
    expect(() => parseConditionLogic('1 AND 5', 2)).toThrow(UnsupportedConstructError);
  });

  it('refuses malformed logic rather than guessing', () => {
    expect(() => parseConditionLogic('1 AND', 2)).toThrow(UnsupportedConstructError);
    expect(() => parseConditionLogic('1 AND (2', 2)).toThrow(UnsupportedConstructError);
  });
});

describe('lowerCondition', () => {
  it('lowers EqualTo to ==', () => {
    const c = ctx([decl('IsBrokerDeal', 'Boolean')]);
    expect(emitExpr(lowerCondition(cond('IsBrokerDeal', 'EqualTo', { kind: 'boolean', raw: 'true' }), c)))
      .toBe('IsBrokerDeal == true');
  });

  it('lowers NotEqualTo to !=', () => {
    const c = ctx([decl('IsBrokerDeal', 'Boolean')]);
    expect(emitExpr(lowerCondition(cond('IsBrokerDeal', 'NotEqualTo', { kind: 'boolean', raw: 'true' }), c)))
      .toBe('IsBrokerDeal != true');
  });

  it('lowers IsNull true to a null test', () => {
    const c = ctx([decl('Amount', 'Number')]);
    expect(emitExpr(lowerCondition(cond('Amount', 'IsNull', { kind: 'boolean', raw: 'true' }), c)))
      .toBe('Amount == null');
  });

  it('lowers IsNull false to a not-null test', () => {
    const c = ctx([decl('Amount', 'Number')]);
    expect(emitExpr(lowerCondition(cond('Amount', 'IsNull', { kind: 'boolean', raw: 'false' }), c)))
      .toBe('Amount != null');
  });

  it('lowers IsBlank through String.isBlank and isNotBlank', () => {
    // The AST has no unary NOT, and Apex supplies isNotBlank, so the negation
    // is expressed by picking the other method rather than wrapping.
    const c = ctx([decl('Name', 'String')]);
    expect(emitExpr(lowerCondition(cond('Name', 'IsBlank', { kind: 'boolean', raw: 'true' }), c)))
      .toBe('String.isBlank(Name)');
    expect(emitExpr(lowerCondition(cond('Name', 'IsBlank', { kind: 'boolean', raw: 'false' }), c)))
      .toBe('String.isNotBlank(Name)');
  });

  it('lowers ordering operators', () => {
    const c = ctx([decl('Amount', 'Number')]);
    expect(emitExpr(lowerCondition(cond('Amount', 'GreaterThan', { kind: 'number', raw: '1000' }), c)))
      .toBe('Amount > 1000');
  });

  it('lowers Contains to a method call', () => {
    const c = ctx([decl('Name', 'String')]);
    expect(emitExpr(lowerCondition(cond('Name', 'Contains', { kind: 'string', raw: 'Ltd' }), c)))
      .toBe("Name.contains('Ltd')");
  });

  it('refuses an operator with no mapping, by name', () => {
    const c = ctx([decl('Name', 'String')]);
    expect(() => lowerCondition(cond('Name', 'WasSet', { kind: 'boolean', raw: 'true' }), c))
      .toThrow(/WasSet/);
  });
});

describe('lowerConditions', () => {
  it('joins conditions with &&', () => {
    const c = ctx([decl('A', 'Boolean'), decl('B', 'Boolean')]);
    const out = emitExpr(lowerConditions('and', [
      cond('A', 'EqualTo', { kind: 'boolean', raw: 'true' }),
      cond('B', 'EqualTo', { kind: 'boolean', raw: 'true' }),
    ], c));
    expect(out).toBe('(A == true) && (B == true)');
  });

  it('honours custom logic grouping in the emitted expression', () => {
    const c = ctx([decl('A', 'Boolean'), decl('B', 'Boolean'), decl('C', 'Boolean')]);
    const out = emitExpr(lowerConditions('1 AND (2 OR 3)', [
      cond('A', 'EqualTo', { kind: 'boolean', raw: 'true' }),
      cond('B', 'EqualTo', { kind: 'boolean', raw: 'true' }),
      cond('C', 'EqualTo', { kind: 'boolean', raw: 'true' }),
    ], c));
    // The parenthesisation is what makes this correct rather than 1 AND 2 OR 3.
    expect(out).toBe('(A == true) && ((B == true) || (C == true))');
  });

  it('returns the single condition unwrapped', () => {
    const c = ctx([decl('A', 'Boolean')]);
    expect(emitExpr(lowerConditions('and', [cond('A', 'EqualTo', { kind: 'boolean', raw: 'true' })], c)))
      .toBe('A == true');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/lower/condition.test.ts`
Expected: FAIL — cannot find module `src/lower/condition.js`.

- [ ] **Step 3: Implement `src/lower/condition.ts`**

```typescript
import {
  ApexExpr, comparison, equality, logical, methodCall, nullTest,
} from '../apex/expr.js';
import { BOOLEAN, STRING, sobjectType } from '../apex/types.js';
import { FlowConditionIR } from '../ir/types.js';
import { LowerContext } from './context.js';
import { UnsupportedConstructError, lowerReference, lowerValue } from './value.js';

export type LogicNode =
  | { kind: 'index'; index: number }
  | { kind: 'and' | 'or'; children: LogicNode[] };

/**
 * Parse `conditionLogic`.
 *
 * `and` and `or` are the simple forms. The third form is an expression over
 * 1-based condition indices — `1 AND (2 OR 3)` — which exampleflow.xml uses,
 * so this parser is required rather than optional. AND binds tighter than OR,
 * matching both Flow and Apex.
 */
export function parseConditionLogic(logic: string, count: number): LogicNode {
  const simple = logic.trim().toLowerCase();
  if (simple === 'and' || simple === 'or') {
    const children: LogicNode[] = [];
    for (let i = 0; i < count; i += 1) children.push({ kind: 'index', index: i });
    return { kind: simple, children };
  }

  const tokens = logic.match(/\d+|AND|OR|\(|\)/gi) ?? [];
  let at = 0;
  const peek = (): string | undefined => tokens[at];
  const take = (): string | undefined => tokens[at++];

  const parsePrimary = (): LogicNode => {
    const token = take();
    if (token === undefined) {
      throw new UnsupportedConstructError(`Condition logic '${logic}' ends unexpectedly.`);
    }
    if (token === '(') {
      const inner = parseOr();
      if (take() !== ')') {
        throw new UnsupportedConstructError(`Condition logic '${logic}' has an unclosed bracket.`);
      }
      return inner;
    }
    if (!/^\d+$/.test(token)) {
      throw new UnsupportedConstructError(`Condition logic '${logic}' has an unexpected '${token}'.`);
    }
    const index = Number(token) - 1;
    if (index < 0 || index >= count) {
      throw new UnsupportedConstructError(
        `Condition logic '${logic}' refers to condition ${token}, but there are ${count}.`
      );
    }
    return { kind: 'index', index };
  };

  const parseAnd = (): LogicNode => {
    const children = [parsePrimary()];
    while (peek()?.toUpperCase() === 'AND') {
      take();
      children.push(parsePrimary());
    }
    return children.length === 1 ? children[0] : { kind: 'and', children };
  };

  const parseOr = (): LogicNode => {
    const children = [parseAnd()];
    while (peek()?.toUpperCase() === 'OR') {
      take();
      children.push(parseAnd());
    }
    return children.length === 1 ? children[0] : { kind: 'or', children };
  };

  const tree = parseOr();
  if (at !== tokens.length) {
    throw new UnsupportedConstructError(`Condition logic '${logic}' has trailing input.`);
  }
  return tree;
}

/** True when a Flow boolean-valued right-hand side says `true`. */
function saysTrue(condition: FlowConditionIR): boolean {
  return condition.right.raw !== 'false';
}

export function lowerCondition(condition: FlowConditionIR, ctx: LowerContext): ApexExpr {
  const left = lowerReference(condition.left, ctx);

  switch (condition.operator) {
    case 'EqualTo':
      return equality(left, '==', lowerValue(condition.right, ctx));
    case 'NotEqualTo':
      return equality(left, '!=', lowerValue(condition.right, ctx));
    case 'GreaterThan':
      return comparison(left, '>', lowerValue(condition.right, ctx));
    case 'GreaterThanOrEqualTo':
      return comparison(left, '>=', lowerValue(condition.right, ctx));
    case 'LessThan':
      return comparison(left, '<', lowerValue(condition.right, ctx));
    case 'LessThanOrEqualTo':
      return comparison(left, '<=', lowerValue(condition.right, ctx));
    case 'IsNull':
      // `IsNull true` means "is null"; `IsNull false` means "is not null".
      return nullTest(left, !saysTrue(condition));
    case 'IsBlank':
      // The AST has no unary NOT. Apex supplies isNotBlank, so the negation is
      // a different method rather than a wrapper.
      return methodCall(
        variableOfString(),
        saysTrue(condition) ? 'isBlank' : 'isNotBlank',
        [left],
        BOOLEAN
      );
    case 'Contains':
      return methodCall(left, 'contains', [lowerValue(condition.right, ctx)], BOOLEAN);
    case 'StartsWith':
      return methodCall(left, 'startsWith', [lowerValue(condition.right, ctx)], BOOLEAN);
    case 'EndsWith':
      return methodCall(left, 'endsWith', [lowerValue(condition.right, ctx)], BOOLEAN);
    default:
      throw new UnsupportedConstructError(
        `Flow condition operator '${condition.operator}' has no Apex mapping in this milestone.`
      );
  }
}

/** The `String` class as a call target, for `String.isBlank(x)`. */
function variableOfString(): ApexExpr {
  return { node: 'variable', type: sobjectType('String'), name: 'String' };
}

export function lowerConditions(
  logic: string,
  conditions: FlowConditionIR[],
  ctx: LowerContext
): ApexExpr {
  if (conditions.length === 0) {
    throw new UnsupportedConstructError('A condition list cannot be empty.');
  }
  const lowered = conditions.map((c) => lowerCondition(c, ctx));
  const build = (node: LogicNode): ApexExpr => {
    if (node.kind === 'index') return lowered[node.index];
    return logical(node.kind === 'and' ? '&&' : '||', node.children.map(build));
  };
  const tree = parseConditionLogic(logic, conditions.length);
  return build(tree);
}
```

Note on `variableOfString`: `String` is a call target, not a value, so it is
built directly rather than through `variable()` with a real type. Keep it
private to this module.

- [ ] **Step 4: Run to verify they pass**

Run: `npx jest tests/lower/condition.test.ts`
Expected: PASS (18 tests). `STRING` may be reported as unused — remove it from
the import if so.

- [ ] **Step 5: Commit**

```bash
git add src/lower/condition.ts tests/lower/condition.test.ts
git commit -m "feat(lower): translate Flow conditions and condition logic

conditionLogic is and, or, or an expression over condition indices such as
1 AND (2 OR 3). exampleflow.xml uses the third form, so the parser is
required scope. AND binds tighter than OR, matching Flow and Apex.

IsNull maps to a null test in either direction, and IsBlank picks between
String.isBlank and String.isNotBlank because the AST has no unary NOT and
Apex supplies both. An operator with no mapping is refused by name."
```

---

### Task 7: Record elements, and a field-qualified SOQL IN

`soql()` currently renders `WHERE Id IN :bind` with the field hardcoded.
`exampleflow.xml` filters on `LLC_BI__Loan__c IN`, so the builder must take the
field. `whereIdIn` stays and is normalised into the general form, so existing
tests and callers keep working.

**Files:**
- Modify: `src/apex/soql.ts`
- Create: `src/lower/elements/record.ts`
- Test: `tests/apex/soql.test.ts`, `tests/lower/elements/record.test.ts`

**Interfaces:**
- Consumes: `RecordBody`, `FlowNode`; `LowerContext`, `apexName`; `lowerValue`, `lowerConditions`
- Produces:
  - `SoqlSpec` gains `whereIn?: { field: string; bind: string }` in `src/apex/soql.ts`
  - `lowerRecord(node: FlowNode, ctx: LowerContext): ApexStmt[]` in `src/lower/elements/record.ts`

- [ ] **Step 1: Write the failing SOQL test**

Add to `tests/apex/soql.test.ts`:

```typescript
describe('whereIn', () => {
  it('binds a named field, not only Id', () => {
    const q = soql({
      object: 'LLC_BI__Pricing_Stream__c', fields: ['Id'],
      whereIn: { field: 'LLC_BI__Loan__c', bind: 'loanIds' },
    });
    expect(renderSoql(q)).toContain('WHERE LLC_BI__Loan__c IN :loanIds');
  });

  it('still renders the Id shorthand', () => {
    expect(renderSoql(soql({ object: 'Account', fields: ['Id'], whereIdIn: 'ids' })))
      .toContain('WHERE Id IN :ids');
  });

  it('validates the bound field name', () => {
    expect(() => soql({
      object: 'Account', fields: ['Id'], whereIn: { field: '1bad', bind: 'ids' },
    })).toThrow(ApexTypeError);
  });

  it('validates the bind variable name', () => {
    expect(() => soql({
      object: 'Account', fields: ['Id'], whereIn: { field: 'Name', bind: 'not valid' },
    })).toThrow(ApexTypeError);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/apex/soql.test.ts -t whereIn`
Expected: FAIL — `WHERE LLC_BI__Loan__c IN :loanIds` not present.

- [ ] **Step 3: Generalise the IN clause**

In `src/apex/soql.ts`, add to `SoqlSpec` after `whereIdIn`:

```typescript
  /** A field-qualified IN bind. `whereIdIn` is the Id shorthand for this. */
  whereIn?: { field: string; bind: string };
```

In `soql()`, after the existing `whereIdIn` validation:

```typescript
  if (spec.whereIn) {
    requireIdentifier(spec.whereIn.field, 'IN field');
    requireIdentifier(spec.whereIn.bind, 'bind variable');
  }
```

and normalise before returning — replace `return { ...spec, fields };` with:

```typescript
  // One representation downstream: the Id form is the general form with a
  // field of 'Id', so renderSoql never has to know about both.
  const whereIn = spec.whereIn ?? (spec.whereIdIn ? { field: 'Id', bind: spec.whereIdIn } : undefined);
  return { ...spec, fields, whereIn };
```

In `renderSoql`, replace the `whereIdIn` line with:

```typescript
  if (query.whereIn) parts.push(`WHERE ${query.whereIn.field} IN :${query.whereIn.bind}`);
```

- [ ] **Step 4: Run the apex suite**

Run: `npx jest tests/apex`
Expected: PASS. The existing `WHERE Id IN :ids` assertions still hold because
`whereIdIn` normalises into `whereIn`.

- [ ] **Step 5: Write the failing record-lowering tests**

Create `tests/lower/elements/record.test.ts`:

```typescript
import { emitStmt } from '../../../src/apex/emit.js';
import { Scope } from '../../../src/apex/scope.js';
import { FlowDeclaration, FlowIR, FlowNode } from '../../../src/ir/types.js';
import { LowerContext } from '../../../src/lower/context.js';
import { declarationTypeSource } from '../../../src/lower/typeSource.js';
import { lowerRecord } from '../../../src/lower/elements/record.js';

function ctx(declarations: FlowDeclaration[] = [], nodes: FlowNode[] = []): LowerContext {
  const ir: FlowIR = {
    flowName: 'T', processType: 'AutoLaunchedFlow', declarations, nodes, unsupported: [],
  };
  return {
    ir, types: declarationTypeSource(ir), scope: new Scope(),
    names: new Map(), notes: [], stubs: new Map(), formulas: new Map(),
  };
}

function lookup(over: Partial<FlowNode> = {}): FlowNode {
  return {
    name: 'Get_Streams', kind: 'recordlookups', connectors: [], sourceJson: '{}', raw: {},
    object: 'LLC_BI__Pricing_Stream__c',
    body: {
      kind: 'record', object: 'LLC_BI__Pricing_Stream__c', filters: [],
      inputAssignments: [], queriedFields: ['Id', 'Name'], getFirstRecordOnly: false,
      storeOutputAutomatically: true, outputAssignments: [],
      assignNullValuesIfNoRecordsFound: false,
    },
    ...over,
  };
}

describe('lowerRecord', () => {
  it('lowers a lookup to a typed query assignment', () => {
    const out = lowerRecord(lookup(), ctx()).map((s) => emitStmt(s)).join('\n');
    expect(out).toContain('List<LLC_BI__Pricing_Stream__c> Get_Streams = [');
    expect(out).toContain('FROM LLC_BI__Pricing_Stream__c');
    expect(out).toContain('WITH USER_MODE');
  });

  it('emits a field-qualified IN filter from the Flow filter', () => {
    const node = lookup();
    if (node.body?.kind === 'record') {
      node.body.filters = [{
        left: 'LLC_BI__Loan__c', operator: 'In',
        right: { kind: 'reference', raw: 'Loan_Ids' },
      }];
    }
    const c = ctx([{
      name: 'Loan_Ids', kind: 'variable', dataType: 'String', isCollection: true,
      isInput: false, isOutput: false, sourceJson: '{}',
    }]);
    const out = lowerRecord(node, c).map((s) => emitStmt(s)).join('\n');
    expect(out).toContain('WHERE LLC_BI__Loan__c IN :Loan_Ids');
  });

  it('carries the Flow row limit and sort onto the query', () => {
    const node = lookup();
    if (node.body?.kind === 'record') {
      node.body.limit = 10;
      node.body.sortField = 'Name';
      node.body.sortOrder = 'Desc';
    }
    const out = lowerRecord(node, ctx()).map((s) => emitStmt(s)).join('\n');
    expect(out).toContain('ORDER BY Name DESC');
    expect(out).toContain('LIMIT 10');
  });

  it('collects a create into a list and issues bulk DML', () => {
    const node: FlowNode = {
      name: 'Create_Thing', kind: 'recordcreates', connectors: [], sourceJson: '{}', raw: {},
      object: 'Account',
      body: {
        kind: 'record', object: 'Account', filters: [],
        inputAssignments: [{ field: 'Name', value: { kind: 'string', raw: "O'Brien" } }],
        queriedFields: [], getFirstRecordOnly: false, storeOutputAutomatically: false,
        outputAssignments: [], assignNullValuesIfNoRecordsFound: false,
      },
    };
    const out = lowerRecord(node, ctx()).map((s) => emitStmt(s)).join('\n');
    expect(out).toContain('Account Create_Thing = new Account();');
    // The apostrophe must be escaped, not interpolated.
    expect(out).toContain("Create_Thing.put('Name', 'O\\'Brien');");
    expect(out).toContain('Database.insert(');
    expect(out).toContain('AccessLevel.USER_MODE');
  });

  it('renames an element whose name collides with an Apex keyword', () => {
    const node = lookup({ name: 'Update' });
    const out = lowerRecord(node, ctx()).map((s) => emitStmt(s)).join('\n');
    expect(out).toContain('vUpdate');
    expect(out).not.toMatch(/\bUpdate =/);
  });
});
```

- [ ] **Step 6: Run to verify they fail**

Run: `npx jest tests/lower/elements/record.test.ts`
Expected: FAIL — cannot find module `src/lower/elements/record.js`.

- [ ] **Step 7: Implement `src/lower/elements/record.ts`**

```typescript
import { ApexStmt, collectInto, declare, dmlBulk, fieldWrite, queryInto } from '../../apex/stmt.js';
import { SoqlSpec, soql } from '../../apex/soql.js';
import { construct } from '../../apex/expr.js';
import { listOf, sobjectType } from '../../apex/types.js';
import { FlowNode, RecordBody } from '../../ir/types.js';
import { LowerContext, apexName } from '../context.js';
import { UnsupportedConstructError, lowerValue } from '../value.js';

/** The DML operation a record element performs, from its Flow element kind. */
function operationOf(kind: string): 'insert' | 'update' | 'delete' | 'query' {
  switch (kind) {
    case 'recordlookups':
      return 'query';
    case 'recordcreates':
      return 'insert';
    case 'recordupdates':
      return 'update';
    case 'recorddeletes':
      return 'delete';
    default:
      throw new UnsupportedConstructError(`'${kind}' is not a record element.`);
  }
}

function lowerLookup(node: FlowNode, body: RecordBody, ctx: LowerContext): ApexStmt[] {
  const object = body.object ?? node.object;
  if (!object) {
    throw new UnsupportedConstructError(`${node.name} is a lookup with no object.`);
  }

  const spec: SoqlSpec = {
    object,
    fields: body.queriedFields.length > 0 ? body.queriedFields : ['Id'],
  };
  if (body.sortField) {
    spec.orderBy = {
      field: body.sortField,
      direction: body.sortOrder?.toLowerCase() === 'desc' ? 'DESC' : 'ASC',
    };
  }
  if (body.limit !== undefined) spec.limit = body.limit;

  // Only an IN filter maps to a bind. Anything else needs a WHERE the builder
  // does not model yet, and is refused rather than dropped.
  for (const filter of body.filters) {
    if (filter.operator !== 'In') {
      throw new UnsupportedConstructError(
        `${node.name} filters with '${filter.operator}', which this milestone does not lower.`
      );
    }
    if (filter.right.kind !== 'reference' || !filter.right.raw) {
      throw new UnsupportedConstructError(`${node.name} has an IN filter with no bind variable.`);
    }
    spec.whereIn = { field: filter.left, bind: apexName(ctx, filter.right.raw) };
  }

  const target = apexName(ctx, body.outputReference ?? node.name);
  return [queryInto(listOf(sobjectType(object)), target, soql(spec))];
}

function lowerDml(node: FlowNode, body: RecordBody, ctx: LowerContext): ApexStmt[] {
  const object = body.object ?? node.object;
  if (!object) {
    throw new UnsupportedConstructError(`${node.name} is a DML element with no object.`);
  }
  const operation = operationOf(node.kind) as 'insert' | 'update' | 'delete';

  const record = apexName(ctx, node.name);
  const collection = apexName(ctx, `${node.name}_records`);
  const statements: ApexStmt[] = [
    declare(sobjectType(object), record, construct(sobjectType(object), [])),
    declare(listOf(sobjectType(object)), collection, construct(listOf(sobjectType(object)), [])),
  ];

  for (const write of body.inputAssignments) {
    statements.push(fieldWrite(record, write.field, lowerValue(write.value, ctx)));
  }
  statements.push(collectInto(collection, record));
  statements.push(dmlBulk(operation, collection));
  return statements;
}

/**
 * A record element.
 *
 * DML is collected into a list and issued once even though this milestone does
 * not bulkify: the AST has no per-record DML statement at all, so this is the
 * only representable shape. Hoisting the collection out of an enclosing loop is
 * BulkTransformer's job, not this one.
 */
export function lowerRecord(node: FlowNode, ctx: LowerContext): ApexStmt[] {
  const body = node.body;
  if (body?.kind !== 'record') {
    throw new UnsupportedConstructError(`${node.name} has no record body.`);
  }
  return operationOf(node.kind) === 'query'
    ? lowerLookup(node, body, ctx)
    : lowerDml(node, body, ctx);
}
```

- [ ] **Step 8: Run to verify they pass**

Run: `npx jest tests/lower`
Expected: PASS. Both the record and its collection are constructed rather
than declared null — `record.put(...)` on a null record is a runtime NPE, and
so is adding to a null list.

- [ ] **Step 9: Commit**

```bash
git add src/apex/soql.ts src/lower/elements/record.ts tests/apex/soql.test.ts tests/lower/elements/record.test.ts
git commit -m "feat(lower): lower record elements, and bind IN on any field

renderSoql hardcoded WHERE Id IN, but exampleflow.xml filters on
LLC_BI__Loan__c IN. The builder now takes the field; whereIdIn stays and
normalises into the general form so existing callers and tests are
untouched and renderSoql only knows one representation.

DML is collected into a list and issued once. That is not bulkification —
it is the only shape the AST can represent, because there is no
per-record DML statement. Hoisting is BulkTransformer's job.

A filter operator other than IN is refused rather than silently dropped:
a lost WHERE clause is a query that returns the whole object."
```

---

### Task 8: Assignments, collection processors, and a call statement

Flow's `RemoveFirst` and `RemoveAll` are method calls used as statements, and
`ApexStmt` has no way to express one — `collectInto` covers `.add()` and nothing
else. This task adds the missing statement, restricted so it cannot become a
hole for arbitrary expressions.

**Files:**
- Modify: `src/apex/stmt.ts`, `src/apex/emit.ts`
- Create: `src/lower/elements/assignment.ts`
- Create: `src/lower/elements/collectionProcessor.ts`
- Test: `tests/apex/stmt.test.ts`, `tests/lower/elements/assignment.test.ts`

**Interfaces:**
- Produces:
  - `invoke(call: ApexExpr): ApexStmt` in `src/apex/stmt.ts`; `ApexStmt` gains `| { stmt: 'invoke'; call: ApexExpr }`
  - `lowerAssignment(node: FlowNode, ctx: LowerContext): ApexStmt[]` in `src/lower/elements/assignment.ts`
  - `lowerCollectionProcessor(node: FlowNode, ctx: LowerContext): ApexStmt[]` in `src/lower/elements/collectionProcessor.ts`

- [ ] **Step 1: Write the failing `invoke` tests**

Add to `tests/apex/stmt.test.ts`:

```typescript
describe('invoke', () => {
  it('emits a method call as a statement', () => {
    expect(emitStmt(invoke(methodCall(variable(listOf(STRING), 'msgs'), 'clear', [], BOOLEAN))))
      .toBe('msgs.clear();');
  });

  it('refuses an expression Apex cannot use as a statement', () => {
    // `amount > 1000;` is not a statement. Only a call is.
    expect(() => invoke(comparison(variable(DECIMAL, 'amount'), '>', literal(DECIMAL, '1000'))))
      .toThrow(ApexTypeError);
    expect(() => invoke(variable(STRING, 'name'))).toThrow(ApexTypeError);
  });
});
```

- [ ] **Step 2: Run to verify it fails, then implement `invoke`**

Run: `npx jest tests/apex/stmt.test.ts -t invoke` — expect FAIL.

In `src/apex/stmt.ts`, add to the union and add the constructor:

```typescript
  | { stmt: 'invoke'; call: ApexExpr }
```

```typescript
/**
 * A method call used as a statement: `msgs.clear();`
 *
 * Restricted to method calls on purpose. Apex accepts only a call as an
 * expression-statement, and a general "any expression" statement would be a
 * hole through which `amount > 1000;` could be emitted.
 */
export function invoke(call: ApexExpr): ApexStmt {
  if (call.node !== 'methodCall') {
    throw new ApexTypeError('Only a method call can be used as a statement.');
  }
  return { stmt: 'invoke', call };
}
```

In `src/apex/emit.ts`, add to `emitStmt`:

```typescript
    case 'invoke':
      return `${pad}${emitExpr(s.call)};`;
```

Run: `npx jest tests/apex` — expect PASS.

- [ ] **Step 3: Write the failing assignment tests**

Create `tests/lower/elements/assignment.test.ts`:

```typescript
import { emitStmt } from '../../../src/apex/emit.js';
import { Scope } from '../../../src/apex/scope.js';
import { FlowDeclaration, FlowIR, FlowNode } from '../../../src/ir/types.js';
import { LowerContext } from '../../../src/lower/context.js';
import { declarationTypeSource } from '../../../src/lower/typeSource.js';
import { UnsupportedConstructError } from '../../../src/lower/value.js';
import { lowerAssignment } from '../../../src/lower/elements/assignment.js';

function decl(name: string, dataType: string, isCollection = false, objectType?: string): FlowDeclaration {
  return {
    name, kind: 'variable', dataType, objectType, isCollection,
    isInput: false, isOutput: false, sourceJson: '{}',
  };
}

function ctx(declarations: FlowDeclaration[]): LowerContext {
  const ir: FlowIR = {
    flowName: 'T', processType: 'AutoLaunchedFlow', declarations, nodes: [], unsupported: [],
  };
  return {
    ir, types: declarationTypeSource(ir), scope: new Scope(),
    names: new Map(), notes: [], stubs: new Map(), formulas: new Map(),
  };
}

function assignmentNode(items: { target: string; operator: string; value: { kind: string; raw?: string } }[]): FlowNode {
  return {
    name: 'Set_Message', kind: 'assignments', connectors: [], sourceJson: '{}', raw: {},
    body: { kind: 'assignment', items: items as never },
  };
}

describe('lowerAssignment', () => {
  it('assigns a plain variable', () => {
    const c = ctx([decl('Msg', 'String'), decl('Src', 'String')]);
    const node = assignmentNode([{ target: 'Msg', operator: 'Assign', value: { kind: 'reference', raw: 'Src' } }]);
    expect(lowerAssignment(node, c).map((s) => emitStmt(s))).toEqual(['Msg = Src;']);
  });

  it('writes a member on an Apex-defined type', () => {
    const c = ctx([decl('ValidationMessage', 'Apex'), decl('Err', 'String')]);
    const node = assignmentNode([
      { target: 'ValidationMessage.Message', operator: 'Assign', value: { kind: 'reference', raw: 'Err' } },
    ]);
    expect(lowerAssignment(node, c).map((s) => emitStmt(s)))
      .toEqual(['ValidationMessage.Message = Err;']);
  });

  it('adds an item to a collection', () => {
    const c = ctx([decl('Msgs', 'Apex', true), decl('Msg', 'Apex')]);
    const node = assignmentNode([{ target: 'Msgs', operator: 'Add', value: { kind: 'reference', raw: 'Msg' } }]);
    expect(lowerAssignment(node, c).map((s) => emitStmt(s))).toEqual(['Msgs.add(Msg);']);
  });

  it('clears a collection for RemoveAll', () => {
    const c = ctx([decl('Msgs', 'Apex', true)]);
    const node = assignmentNode([{ target: 'Msgs', operator: 'RemoveAll', value: { kind: 'none' } }]);
    expect(lowerAssignment(node, c).map((s) => emitStmt(s))).toEqual(['Msgs.clear();']);
  });

  it('removes the first element for RemoveFirst', () => {
    const c = ctx([decl('Msgs', 'Apex', true)]);
    const node = assignmentNode([{ target: 'Msgs', operator: 'RemoveFirst', value: { kind: 'none' } }]);
    expect(lowerAssignment(node, c).map((s) => emitStmt(s))).toEqual(['Msgs.remove(0);']);
  });

  it('refuses Add on a non-collection, because the AST has no arithmetic', () => {
    // Flow's Add concatenates strings and sums numbers. Emitting a wrong
    // interpretation is worse than refusing.
    const c = ctx([decl('Total', 'Number')]);
    const node = assignmentNode([{ target: 'Total', operator: 'Add', value: { kind: 'number', raw: '1' } }]);
    expect(() => lowerAssignment(node, c)).toThrow(UnsupportedConstructError);
  });

  it('refuses an operator with no mapping, by name', () => {
    const c = ctx([decl('Msgs', 'Apex', true)]);
    const node = assignmentNode([{ target: 'Msgs', operator: 'RemoveAfterFirst', value: { kind: 'none' } }]);
    expect(() => lowerAssignment(node, c)).toThrow(/RemoveAfterFirst/);
  });

  it('emits one statement per item, in order', () => {
    const c = ctx([decl('A', 'String'), decl('B', 'String'), decl('S', 'String')]);
    const node = assignmentNode([
      { target: 'A', operator: 'Assign', value: { kind: 'reference', raw: 'S' } },
      { target: 'B', operator: 'Assign', value: { kind: 'reference', raw: 'S' } },
    ]);
    expect(lowerAssignment(node, c).map((s) => emitStmt(s))).toEqual(['A = S;', 'B = S;']);
  });
});
```

- [ ] **Step 4: Run to verify they fail**

Run: `npx jest tests/lower/elements/assignment.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 5: Implement `src/lower/elements/assignment.ts`**

```typescript
import { methodCall, literal, variable } from '../../apex/expr.js';
import { ApexStmt, assign, collectInto, invoke, memberWrite } from '../../apex/stmt.js';
import { BOOLEAN, INTEGER } from '../../apex/types.js';
import { FlowAssignmentItem, FlowNode } from '../../ir/types.js';
import { LowerContext, apexName } from '../context.js';
import { UnsupportedConstructError, lowerValue } from '../value.js';

function isCollection(reference: string, ctx: LowerContext): boolean {
  return ctx.types.resolve(reference).type.kind === 'List';
}

function lowerItem(item: FlowAssignmentItem, ctx: LowerContext): ApexStmt {
  const dot = item.target.indexOf('.');

  switch (item.operator) {
    case 'Assign': {
      const value = lowerValue(item.value, ctx);
      if (dot === -1) return assign(apexName(ctx, item.target), value);
      return memberWrite(
        apexName(ctx, item.target.slice(0, dot)),
        item.target.slice(dot + 1),
        value
      );
    }

    case 'Add':
    case 'AddItem': {
      if (!isCollection(item.target, ctx)) {
        // Flow's Add concatenates strings and sums numbers. The AST has no
        // arithmetic or concatenation node, so guessing which one is meant is
        // exactly the invention this project refuses.
        throw new UnsupportedConstructError(
          `'${item.operator}' on non-collection '${item.target}' needs arithmetic, ` +
            `which this milestone does not lower.`
        );
      }
      if (item.value.kind !== 'reference' || !item.value.raw) {
        throw new UnsupportedConstructError(
          `'${item.operator}' on '${item.target}' needs a variable to add.`
        );
      }
      return collectInto(apexName(ctx, item.target), apexName(ctx, item.value.raw));
    }

    case 'RemoveAll':
      return invoke(methodCall(
        variable(ctx.types.resolve(item.target).type, apexName(ctx, item.target)),
        'clear', [], BOOLEAN
      ));

    case 'RemoveFirst':
      return invoke(methodCall(
        variable(ctx.types.resolve(item.target).type, apexName(ctx, item.target)),
        'remove', [literal(INTEGER, '0')], BOOLEAN
      ));

    default:
      throw new UnsupportedConstructError(
        `Flow assignment operator '${item.operator}' has no Apex mapping in this milestone.`
      );
  }
}

export function lowerAssignment(node: FlowNode, ctx: LowerContext): ApexStmt[] {
  if (node.body?.kind !== 'assignment') {
    throw new UnsupportedConstructError(`${node.name} has no assignment body.`);
  }
  return node.body.items.map((item) => lowerItem(item, ctx));
}
```

- [ ] **Step 6: Implement `src/lower/elements/collectionProcessor.ts`**

```typescript
import { ApexStmt, collectInto, declare, forEach, ifThen } from '../../apex/stmt.js';
import { listOf, sobjectType } from '../../apex/types.js';
import { FlowNode } from '../../ir/types.js';
import { LowerContext, apexName } from '../context.js';
import { lowerConditions } from '../condition.js';
import { UnsupportedConstructError } from '../value.js';

/**
 * A collection processor.
 *
 * Only FilterCollectionProcessor lowers. Sort needs a generated Comparator
 * implementation and Map needs an expression language for the projection —
 * both are real work that belongs in its own change rather than smuggled in
 * here, so they are refused by processorType.
 */
export function lowerCollectionProcessor(node: FlowNode, ctx: LowerContext): ApexStmt[] {
  const body = node.body;
  if (body?.kind !== 'collectionProcessor') {
    throw new UnsupportedConstructError(`${node.name} has no collection-processor body.`);
  }
  if (body.processorType !== 'FilterCollectionProcessor') {
    throw new UnsupportedConstructError(
      `Collection processor '${body.processorType ?? 'unknown'}' on ${node.name} ` +
        `is not lowered in this milestone.`
    );
  }

  const sourceType = ctx.types.resolve(body.collection).type;
  const elementType = sourceType.kind === 'List' ? sourceType.of : sobjectType();
  const target = apexName(ctx, node.name);
  const item = apexName(ctx, body.assignNextValueToReference ?? `${node.name}_item`);

  return [
    declare(listOf(elementType), target, null),
    forEach(elementType, item, apexName(ctx, body.collection), [
      ifThen(lowerConditions(body.conditionLogic ?? 'and', body.conditions, ctx), [
        collectInto(target, item),
      ]),
    ]),
  ];
}
```

- [ ] **Step 7: Run the suite and commit**

Run: `npx jest tests/lower tests/apex`
Expected: PASS.

```bash
git add src/apex/stmt.ts src/apex/emit.ts src/lower/elements/assignment.ts src/lower/elements/collectionProcessor.ts tests/apex/stmt.test.ts tests/lower/elements/assignment.test.ts
git commit -m "feat(lower): lower assignments and filter collection processors

Flow's RemoveFirst and RemoveAll are method calls used as statements, and
ApexStmt could not express one — collectInto covered .add() and nothing
else. invoke() fills that gap and is restricted to method calls, so it
cannot become a hole through which 'amount > 1000;' is emitted.

Add on a non-collection is refused. Flow's Add concatenates strings and
sums numbers, the AST has neither operation, and picking one would be a
guess about semantics.

Only FilterCollectionProcessor lowers; Sort needs a generated Comparator
and is refused by name rather than dropped."
```

---

### Task 9: Stubs for formulas, subflows and action calls

Three constructs whose structure is known but whose leaf cannot be translated
yet. Each becomes a private method that compiles and throws, so the class is a
correct skeleton with a loud, named hole rather than a silent wrong answer.

**Files:**
- Create: `src/lower/elements/stubs.ts`
- Test: `tests/lower/elements/stubs.test.ts`

**Interfaces:**
- Produces, from `src/lower/elements/stubs.ts`:
  - `formulaStub(declaration: FlowDeclaration, ctx: LowerContext): string` — returns the method name, registering it in `ctx.stubs`
  - `lowerFormula(declaration: FlowDeclaration, ctx: LowerContext): ApexExpr`
  - `lowerSubflow(node: FlowNode, ctx: LowerContext): ApexStmt[]`
  - `lowerAction(node: FlowNode, ctx: LowerContext): ApexStmt[]`

- [ ] **Step 1: Write the failing tests**

Create `tests/lower/elements/stubs.test.ts`:

```typescript
import { emitClass } from '../../../src/apex/class.js';
import { emitStmt } from '../../../src/apex/emit.js';
import { Scope } from '../../../src/apex/scope.js';
import { FlowDeclaration, FlowIR, FlowNode } from '../../../src/ir/types.js';
import { LowerContext } from '../../../src/lower/context.js';
import { declarationTypeSource } from '../../../src/lower/typeSource.js';
import { lowerAction, lowerFormula, lowerSubflow } from '../../../src/lower/elements/stubs.js';

function ctx(declarations: FlowDeclaration[] = []): LowerContext {
  const ir: FlowIR = {
    flowName: 'T', processType: 'AutoLaunchedFlow', declarations, nodes: [], unsupported: [],
  };
  return {
    ir, types: declarationTypeSource(ir), scope: new Scope(),
    names: new Map(), notes: [], stubs: new Map(), formulas: new Map(),
  };
}

const formula = (name: string, expression: string): FlowDeclaration => ({
  name, kind: 'formula', dataType: 'Boolean', isCollection: false,
  isInput: false, isOutput: false, expression, sourceJson: '{}',
});

describe('lowerFormula', () => {
  it('translates a bare field reference exactly, with no stub', () => {
    // {!Loop.NC_Skip_Pricing__c} has no function in it, so it needs no engine.
    const c = ctx([formula('skip', '{!Acct.NC_Skip_Pricing__c}'),
      { name: 'Acct', kind: 'variable', dataType: 'SObject', objectType: 'Account',
        isCollection: false, isInput: false, isOutput: false, sourceJson: '{}' }]);
    const expr = lowerFormula(c.ir.declarations[0], c);
    expect(c.stubs.size).toBe(0);
    expect(expr.node).toBe('fieldRead');
  });

  it('stubs a formula containing a function', () => {
    const c = ctx([formula('isCA', 'OR({!A.X__c}, {!A.Y__c})')]);
    lowerFormula(c.ir.declarations[0], c);
    expect(c.stubs.size).toBe(1);
    const method = [...c.stubs.values()][0];
    expect(method.visibility).toBe('private');
    expect(method.doc.join(' ')).toContain('OR(');
  });

  it('emits a stub that throws rather than returning a default', () => {
    // A Boolean formula silently returning false takes the wrong branch.
    const c = ctx([formula('isCA', 'ISPICKVAL({!A.T__c}, \\'X\\')')]);
    lowerFormula(c.ir.declarations[0], c);
    const method = [...c.stubs.values()][0];
    const cls = emitClass({
      name: 'T', sharing: 'with sharing', doc: [], fields: [], inner: [], methods: [method],
    });
    expect(cls).toContain('throw new UnsupportedOperationException');
  });

  it('records a stub note for the manifest', () => {
    const c = ctx([formula('isCA', 'OR({!A.X__c})')]);
    lowerFormula(c.ir.declarations[0], c);
    expect(c.notes.filter((n) => n.kind === 'stub')).toHaveLength(1);
  });

  it('reuses one stub for repeated references to the same formula', () => {
    const c = ctx([formula('isCA', 'OR({!A.X__c})')]);
    lowerFormula(c.ir.declarations[0], c);
    lowerFormula(c.ir.declarations[0], c);
    expect(c.stubs.size).toBe(1);
  });
});

describe('lowerSubflow', () => {
  it('calls the subflow class and records a dependency', () => {
    const node: FlowNode = {
      name: 'Validate', kind: 'subflows', connectors: [], sourceJson: '{}', raw: {},
      body: { kind: 'subflow', flowName: 'NC_Validate_Dates', inputs: [], outputs: [],
        storeOutputAutomatically: true },
    };
    const c = ctx();
    const out = lowerSubflow(node, c).map((s) => emitStmt(s)).join('\n');
    expect(out).toContain('NC_Validate_Dates');
    expect(c.notes.filter((n) => n.kind === 'dependency')).toHaveLength(1);
  });
});

describe('lowerAction', () => {
  it('stubs an apex action rather than inventing its signature', () => {
    // The invocable's method name and request wrapper live in a class the
    // converter cannot see. Emitting a call would mean making one up.
    const node: FlowNode = {
      name: 'Get_Ids', kind: 'actioncalls', connectors: [], sourceJson: '{}', raw: {},
      body: { kind: 'action', actionName: 'GetIdsFromRecords', actionType: 'apex',
        inputs: [], outputs: [], storeOutputAutomatically: true,
        dataTypeMappings: [{ typeName: 'T__inputList', typeValue: 'LLC_BI__Loan__c' }] },
    };
    const c = ctx();
    lowerAction(node, c);
    expect(c.stubs.size).toBe(1);
    const doc = [...c.stubs.values()][0].doc.join(' ');
    expect(doc).toContain('GetIdsFromRecords');
    // dataTypeMappings carry the concrete type argument; it exists nowhere else.
    expect(doc).toContain('LLC_BI__Loan__c');
  });
});
```

- [ ] **Step 2: Add a throw statement to the AST**

The stub body is `throw new UnsupportedOperationException('...');`. `ApexStmt`
cannot express a throw, and faking one by passing raw text through `variable()`
would smuggle unvalidated source into the emitter — the exact hole this AST
exists to close. Add the node properly.

Add to `tests/apex/stmt.test.ts`:

```typescript
describe('throwStmt', () => {
  it('emits a throw with an escaped message', () => {
    expect(emitStmt(throwStmt("Formula isn't translated")))
      .toBe("throw new UnsupportedOperationException('Formula isn\\'t translated');");
  });
});
```

Run it, watch it fail, then in `src/apex/stmt.ts` add to the union:

```typescript
  | { stmt: 'throwStmt'; message: ApexExpr }
```

and the constructor:

```typescript
/**
 * `throw new UnsupportedOperationException('...');`
 *
 * The one exception type generated code throws, so the constructor takes only
 * the message. The message goes through stringLiteral, so a quote in a Flow
 * formula cannot end the literal early.
 */
export function throwStmt(message: string): ApexStmt {
  return { stmt: 'throwStmt', message: stringLiteral(message) };
}
```

Import `stringLiteral` from `./expr.js` in `src/apex/stmt.ts`. In
`src/apex/emit.ts` add:

```typescript
    case 'throwStmt':
      return `${pad}throw new UnsupportedOperationException(${emitExpr(s.message)});`;
```

Run: `npx jest tests/apex` — expect PASS.

- [ ] **Step 3: Add a static call to the expression AST**

A stub is a static method on the class being generated, so calling it has no
target expression. `methodCall` always renders `target.name(...)`, and giving it
an empty target emits a leading dot. Add the node instead.

Add to `tests/apex/expr.test.ts`:

```typescript
describe('staticCall', () => {
  it('emits a call with no target', () => {
    expect(emitExpr(staticCall('formula_isReady', [], BOOLEAN))).toBe('formula_isReady()');
  });

  it('emits arguments', () => {
    expect(emitExpr(staticCall('f', [literal(DECIMAL, '1'), literal(DECIMAL, '2')], BOOLEAN)))
      .toBe('f(1, 2)');
  });

  it('refuses an invalid method name', () => {
    expect(() => staticCall('2bad', [], BOOLEAN)).toThrow(ApexTypeError);
  });
});
```

In `src/apex/expr.ts` add to the `ApexExpr` union:

```typescript
  | { node: 'staticCall'; type: ApexType; name: string; args: ApexExpr[] }
```

and the constructor:

```typescript
/**
 * `name(args)` — a call with no target, for a static method on the class being
 * generated. methodCall always renders `target.name(...)`, which a same-class
 * static call has no target for.
 */
export function staticCall(name: string, args: ApexExpr[], type: ApexType): ApexExpr {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
    throw new ApexTypeError(`'${name}' is not a valid Apex method name.`);
  }
  return { node: 'staticCall', type, name, args };
}
```

In `src/apex/emit.ts` add to `emitExpr` (the switch is exhaustive, so TypeScript
will require this):

```typescript
    case 'staticCall':
      return `${e.name}(${e.args.map(emitExpr).join(', ')})`;
```

In `src/apex/stmt.ts`, widen `invoke` so a static call is also a valid statement:

```typescript
export function invoke(call: ApexExpr): ApexStmt {
  if (call.node !== 'methodCall' && call.node !== 'staticCall') {
    throw new ApexTypeError('Only a method call can be used as a statement.');
  }
  return { stmt: 'invoke', call };
}
```

Run: `npx jest tests/apex` — expect PASS.

- [ ] **Step 4: Run the stub tests to verify they fail, then implement**

Run: `npx jest tests/lower/elements/stubs.test.ts` — expect FAIL.

Create `src/lower/elements/stubs.ts`:

```typescript
import { ApexMethod } from '../../apex/class.js';
import { ApexExpr, methodCall, staticCall, variable } from '../../apex/expr.js';
import { ApexStmt, invoke, throwStmt } from '../../apex/stmt.js';
import { ApexType, BOOLEAN, sobjectType } from '../../apex/types.js';
import { FlowDeclaration, FlowNode } from '../../ir/types.js';
import { LowerContext, apexName } from '../context.js';
import { UnsupportedConstructError, lowerReference } from '../value.js';
import { flowTypeToApex } from '../typeSource.js';

/** `{!Some.Reference}` and nothing else — no functions, no operators. */
const BARE_REFERENCE = /^\{!([A-Za-z_][A-Za-z0-9_.$]*)\}$/;

/**
 * A private method that compiles and throws.
 *
 * Deliberately not a typed default. A Boolean formula returning false silently
 * takes the wrong branch, which is the defect class this project exists to
 * remove; throwing fails loudly the first time the path is exercised.
 */
function throwingStub(
  name: string,
  returnType: ApexType | null,
  doc: string[],
  message: string
): ApexMethod {
  return {
    visibility: 'private',
    isStatic: true,
    returnType,
    name,
    params: [],
    doc,
    body: [throwStmt(message)],
  };
}

export function formulaStub(declaration: FlowDeclaration, ctx: LowerContext): string {
  const name = apexName(ctx, `formula_${declaration.name}`);
  if (ctx.stubs.has(name)) return name;

  const expression = declaration.expression ?? '';
  const method = throwingStub(
    name,
    flowTypeToApex(declaration.dataType, declaration.objectType, declaration.isCollection),
    [
      `TODO: Flow formula '${declaration.name}' is not translated.`,
      `Flow expression: ${expression}`,
      'Formula translation arrives in a later milestone. Implement this method',
      'before running the converted class.',
    ],
    `Formula ${declaration.name} is not translated: ${expression}`
  );
  ctx.stubs.set(name, method);
  ctx.notes.push({ kind: 'stub', detail: `formula ${declaration.name}: ${expression}` });
  return name;
}

/**
 * A formula reference.
 *
 * A formula that is only a reference — `{!Loop.Field__c}` — needs no engine and
 * is translated exactly. Anything with a function becomes a stub call.
 */
export function lowerFormula(declaration: FlowDeclaration, ctx: LowerContext): ApexExpr {
  const bare = BARE_REFERENCE.exec((declaration.expression ?? '').trim());
  if (bare) return lowerReference(bare[1], ctx);

  const name = formulaStub(declaration, ctx);
  return staticCall(
    name,
    [],
    flowTypeToApex(declaration.dataType, declaration.objectType, declaration.isCollection)
  );
}

export function lowerSubflow(node: FlowNode, ctx: LowerContext): ApexStmt[] {
  const body = node.body;
  if (body?.kind !== 'subflow') {
    throw new UnsupportedConstructError(`${node.name} has no subflow body.`);
  }
  ctx.notes.push({
    kind: 'dependency',
    detail: `subflow ${body.flowName} must be converted separately`,
  });
  const target = ctx.scope.allocate(body.flowName);
  return [invoke(methodCall(
    variable(sobjectType(target), target), 'execute', [], BOOLEAN
  ))];
}

export function lowerAction(node: FlowNode, ctx: LowerContext): ApexStmt[] {
  const body = node.body;
  if (body?.kind !== 'action') {
    throw new UnsupportedConstructError(`${node.name} has no action body.`);
  }

  const name = apexName(ctx, `action_${node.name}`);
  const bindings = body.inputs
    .map((i) => `${i.name} = ${i.value.raw ?? i.value.kind}`)
    .join(', ');
  const mappings = body.dataTypeMappings
    .map((m) => `${m.typeName} = ${m.typeValue}`)
    .join(', ');

  const method = throwingStub(name, null, [
    `TODO: Flow action '${body.actionName}' (type ${body.actionType}) is not translated.`,
    `Inputs: ${bindings || 'none'}`,
    `Type bindings: ${mappings || 'none'}`,
    "The invocable's method name and request wrapper are not visible to the",
    'converter, so no call is generated rather than inventing a signature.',
  ], `Action ${body.actionName} is not translated`);
  ctx.stubs.set(name, method);
  ctx.notes.push({ kind: 'stub', detail: `action ${body.actionName} (${body.actionType})` });

  return [invoke(staticCall(name, [], BOOLEAN))];
}
```

- [ ] **Step 5: Run, verify emitted text, commit**

Run: `npx jest tests/lower`
Expected: PASS, and the emitted stub body reads
`throw new UnsupportedOperationException('...');`

```bash
git add src/apex/stmt.ts src/apex/expr.ts src/apex/emit.ts src/lower/elements/stubs.ts tests/apex/stmt.test.ts tests/apex/expr.test.ts tests/lower/elements/stubs.test.ts
git commit -m "feat(lower): stub formulas, subflows and action calls

Each has known structure and an untranslatable leaf, so each becomes a
private method that compiles and throws. A typed default was rejected
deliberately: a Boolean formula silently returning false takes the wrong
branch, which is the defect class this project exists to remove.

A formula that is only a reference needs no engine and is translated
exactly — one of exampleflow.xml's three is exactly that.

An action's invocable method name and request wrapper live in a class the
converter cannot see, so no call is generated. dataTypeMappings are
recorded in the stub's ApexDoc because they carry the concrete type
argument for a generic invocable, which exists nowhere else."
```

---

### Task 10: The control-flow walker

Where the CFG from Task 3 becomes statements. This is the task that turns a
graph into `if`/`else` and `for`.

**Files:**
- Create: `src/lower/walk.ts`
- Test: `tests/lower/walk.test.ts`

**Interfaces:**
- Consumes: `Cfg`, `immediatePostDominator`; every `lower*` from Tasks 7-9
- Produces, from `src/lower/walk.ts`:
  - `lowerFrom(cfg: Cfg, start: string | undefined, stopAt: string | undefined, ctx: LowerContext): ApexStmt[]`
  - `lowerElement(node: FlowNode, ctx: LowerContext): ApexStmt[]`

- [ ] **Step 1: Write the failing tests**

Create `tests/lower/walk.test.ts`. Reuse the `node`/`plain`/`decision`/`loop`/`ir`
helpers from `tests/lower/cfg.test.ts` — copy them into this file rather than
importing, so the two suites stay independent.

```typescript
import { emitStmt } from '../../src/apex/emit.js';
import { Scope } from '../../src/apex/scope.js';
import { FlowDeclaration, FlowIR, FlowNode } from '../../src/ir/types.js';
import { buildCfg } from '../../src/lower/cfg.js';
import { LowerContext } from '../../src/lower/context.js';
import { declarationTypeSource } from '../../src/lower/typeSource.js';
import { lowerFrom } from '../../src/lower/walk.js';

// (copy node/plain/decision/loop/ir helpers from tests/lower/cfg.test.ts here)

function makeCtx(ir: FlowIR): LowerContext {
  return {
    ir, types: declarationTypeSource(ir), scope: new Scope(),
    names: new Map(), notes: [], stubs: new Map(), formulas: new Map(),
  };
}

function assignNode(name: string, next: string | undefined, target: string): FlowNode {
  return {
    name, kind: 'assignments', sourceJson: '{}', raw: {},
    connectors: next ? [{ target: next, isFault: false }] : [],
    body: {
      kind: 'assignment',
      items: [{ target, operator: 'Assign', value: { kind: 'string', raw: 'x' } }],
    },
  };
}

const decl = (name: string): FlowDeclaration => ({
  name, kind: 'variable', dataType: 'String', isCollection: false,
  isInput: false, isOutput: false, sourceJson: '{}',
});

describe('lowerFrom', () => {
  it('emits a straight-line sequence in order', () => {
    const flow = ir([assignNode('A', 'B', 'x'), assignNode('B', undefined, 'y')], 'A');
    flow.declarations = [decl('x'), decl('y')];
    const out = lowerFrom(buildCfg(flow), 'A', undefined, makeCtx(flow)).map((s) => emitStmt(s));
    expect(out).toEqual(["x = 'x';", "y = 'x';"]);
  });

  it('stops at the stop node', () => {
    const flow = ir([assignNode('A', 'B', 'x'), assignNode('B', undefined, 'y')], 'A');
    flow.declarations = [decl('x'), decl('y')];
    const out = lowerFrom(buildCfg(flow), 'A', 'B', makeCtx(flow)).map((s) => emitStmt(s));
    expect(out).toEqual(["x = 'x';"]);
  });

  it('emits a decision as if/else and continues once after the join', () => {
    const flow = ir([
      decision('D', 'T', 'F'),
      assignNode('T', 'J', 'x'),
      assignNode('F', 'J', 'y'),
      assignNode('J', undefined, 'z'),
    ], 'D');
    flow.declarations = [decl('x'), decl('y'), decl('z')];
    const out = lowerFrom(buildCfg(flow), 'D', undefined, makeCtx(flow))
      .map((s) => emitStmt(s)).join('\n');
    expect(out).toContain('if (');
    expect(out).toContain('} else {');
    // The join is emitted once, after the if/else — not duplicated into both.
    expect(out.match(/z = 'x';/g)).toHaveLength(1);
    expect(out.trimEnd().endsWith("z = 'x';")).toBe(true);
  });

  it('emits a loop with its body, then continues after it', () => {
    const flow = ir([
      loop('L', 'B', 'A'),
      assignNode('B', 'L', 'x'),
      assignNode('A', undefined, 'y'),
    ], 'L');
    flow.declarations = [
      decl('x'), decl('y'),
      { name: 'items', kind: 'variable', dataType: 'SObject', objectType: 'Account',
        isCollection: true, isInput: false, isOutput: false, sourceJson: '{}' },
    ];
    const out = lowerFrom(buildCfg(flow), 'L', undefined, makeCtx(flow))
      .map((s) => emitStmt(s)).join('\n');
    expect(out).toContain('for (Account ');
    expect(out).toContain("x = 'x';");
    // The after-target belongs outside the loop.
    expect(out.indexOf("y = 'x';")).toBeGreaterThan(out.indexOf('}'));
  });

  it('wraps an element with a fault connector in try/catch', () => {
    const faulty: FlowNode = {
      ...assignNode('A', 'B', 'x'),
      connectors: [{ target: 'B', isFault: false }, { target: 'F', isFault: true }],
    };
    const flow = ir([faulty, assignNode('B', undefined, 'y'), assignNode('F', undefined, 'z')], 'A');
    flow.declarations = [decl('x'), decl('y'), decl('z')];
    const out = lowerFrom(buildCfg(flow), 'A', undefined, makeCtx(flow))
      .map((s) => emitStmt(s)).join('\n');
    expect(out).toContain('try {');
    expect(out).toContain('} catch (Exception e) {');
    expect(out).toContain("z = 'x';");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/lower/walk.test.ts` — expect FAIL, module not found.

- [ ] **Step 3: Add `else` and try/catch to the statement AST**

Two gaps. `ifThen` has no `else`, and a decision needs one; `ApexStmt` has no
try/catch, and a fault connector needs one. Add both properly rather than
faking either at the call site.

Add to `tests/apex/stmt.test.ts`:

```typescript
describe('ifThen with an else branch', () => {
  it('emits both branches', () => {
    expect(emitStmt(ifThen(
      variable(BOOLEAN, 'b'),
      [assign('a', literal(DECIMAL, '1'))],
      [assign('a', literal(DECIMAL, '2'))]
    ))).toBe('if (b) {\n    a = 1;\n} else {\n    a = 2;\n}');
  });

  it('omits the else when the branch is empty, keeping 2b behaviour', () => {
    expect(emitStmt(ifThen(variable(BOOLEAN, 'b'), [assign('a', literal(DECIMAL, '1'))])))
      .toBe('if (b) {\n    a = 1;\n}');
  });
});
```

In `src/apex/stmt.ts` change the union member and the constructor, keeping the
two-argument calls working so 2b's tests are untouched:

```typescript
  | { stmt: 'ifThen'; condition: ApexExpr; body: ApexStmt[]; elseBody: ApexStmt[] }
```

```typescript
export function ifThen(
  condition: ApexExpr,
  body: ApexStmt[],
  elseBody: ApexStmt[] = []
): ApexStmt {
  requireBoolean(condition, 'An if condition');
  return { stmt: 'ifThen', condition, body, elseBody };
}
```

In `src/apex/emit.ts`, append the else to the existing `ifThen` case:

```typescript
    case 'ifThen':
      return (
        `${pad}if (${emitExpr(s.condition)}) ${braces(s.body, depth, pad)}` +
        (s.elseBody.length > 0 ? ` else ${braces(s.elseBody, depth, pad)}` : '')
      );
```

Run: `npx jest tests/apex` — expect PASS.

- [ ] **Step 4: Add try/catch to the statement AST**

Add to `tests/apex/stmt.test.ts`:

```typescript
describe('tryCatch', () => {
  it('emits a try/catch with both bodies indented', () => {
    const out = emitStmt(tryCatch(
      [assign('a', literal(DECIMAL, '1'))],
      'e',
      [assign('b', literal(DECIMAL, '2'))]
    ));
    expect(out).toBe('try {\n    a = 1;\n} catch (Exception e) {\n    b = 2;\n}');
  });
});
```

In `src/apex/stmt.ts`:

```typescript
  | { stmt: 'tryCatch'; body: ApexStmt[]; exceptionName: string; handler: ApexStmt[] }
```

```typescript
/**
 * `try { ... } catch (Exception e) { ... }` — the shape a Flow fault connector
 * lowers to. The exception name goes through the identifier guard so a fault
 * path cannot inject one.
 */
export function tryCatch(body: ApexStmt[], exceptionName: string, handler: ApexStmt[]): ApexStmt {
  requireIdentifier(exceptionName, 'An exception variable');
  return { stmt: 'tryCatch', body, exceptionName, handler };
}
```

In `src/apex/emit.ts`, using the existing `braces` helper:

```typescript
    case 'tryCatch':
      return (
        `${pad}try ${braces(s.body, depth, pad)} ` +
        `catch (Exception ${s.exceptionName}) ${braces(s.handler, depth, pad)}`
      );
```

Run: `npx jest tests/apex` — expect PASS.

- [ ] **Step 5: Implement `src/lower/walk.ts`**

```typescript
import { ApexTypeError } from '../apex/errors.js';
import { ApexStmt, forEach, ifThen, tryCatch } from '../apex/stmt.js';
import { sobjectType } from '../apex/types.js';
import { FlowNode } from '../ir/types.js';
import { Cfg, immediatePostDominator } from './cfg.js';
import { LowerContext, LoweringRefusal, apexName } from './context.js';
import { lowerConditions } from './condition.js';
import { lowerAssignment } from './elements/assignment.js';
import { lowerCollectionProcessor } from './elements/collectionProcessor.js';
import { lowerRecord } from './elements/record.js';
import { lowerAction, lowerSubflow } from './elements/stubs.js';

/**
 * One element's own statements, ignoring control flow.
 *
 * An ApexTypeError escaping a lowering is a bug in this module, not user error.
 * It is re-thrown with the element's name so the failure points at the Flow
 * element that produced the invalid tree rather than at a constructor.
 */
export function lowerElement(node: FlowNode, ctx: LowerContext): ApexStmt[] {
  try {
    return lowerElementBody(node, ctx);
  } catch (error) {
    if (error instanceof ApexTypeError) {
      throw new ApexTypeError(`While lowering '${node.name}' (${node.kind}): ${error.message}`);
    }
    throw error;
  }
}

function lowerElementBody(node: FlowNode, ctx: LowerContext): ApexStmt[] {
  switch (node.kind) {
    case 'assignments':
      return lowerAssignment(node, ctx);
    case 'recordlookups':
    case 'recordcreates':
    case 'recordupdates':
    case 'recorddeletes':
      return lowerRecord(node, ctx);
    case 'collectionprocessors':
      return lowerCollectionProcessor(node, ctx);
    case 'subflows':
      return lowerSubflow(node, ctx);
    case 'actioncalls':
      return lowerAction(node, ctx);
    default:
      throw new LoweringRefusal([
        `Element '${node.name}' is of kind '${node.kind}', which this milestone does not lower.`,
      ]);
  }
}

/** The fault target of an element, if it declares one. */
function faultTarget(node: FlowNode): string | undefined {
  return node.connectors.find((c) => c.isFault)?.target;
}

/**
 * Walk the graph from `start`, stopping when `stopAt` is reached.
 *
 * `stopAt` is what makes a decision's branches finite: each branch is walked up
 * to the join, and the join's statements are emitted once afterwards rather
 * than duplicated into every branch.
 */
export function lowerFrom(
  cfg: Cfg,
  start: string | undefined,
  stopAt: string | undefined,
  ctx: LowerContext
): ApexStmt[] {
  const out: ApexStmt[] = [];
  const guard = new Set<string>();
  let current = start;

  while (current !== undefined && current !== stopAt) {
    if (guard.has(current)) {
      // checkStructure should have caught this. If it did not, refusing here
      // is still better than emitting a partial class or looping forever.
      throw new LoweringRefusal([`Cycle through '${current}' could not be structured.`]);
    }
    guard.add(current);

    const node = cfg.node(current);
    if (!node) break;

    if (node.body?.kind === 'decision') {
      const join = immediatePostDominator(cfg, current);
      const branches = cfg
        .successors(current)
        .filter((e) => e.kind === 'rule' || e.kind === 'default');

      // Rules become if / else-if in declaration order; the default is the else.
      const rules = node.body.rules;
      // Built back to front, so rule 1 ends up outermost and the default is
      // the innermost else — an if / else-if / else chain in Flow's own order.
      let built: ApexStmt[] = node.body.defaultTarget
        ? lowerFrom(cfg, node.body.defaultTarget, join, ctx)
        : [];
      for (let i = rules.length - 1; i >= 0; i -= 1) {
        const rule = rules[i];
        const condition = lowerConditions(rule.conditionLogic, rule.conditions, ctx);
        const body = lowerFrom(cfg, rule.target, join, ctx);
        built = [ifThen(condition, body, built)];
      }
      out.push(...built);
      current = join;
      continue;
    }

    if (node.body?.kind === 'loop') {
      const collection = node.body.collection;
      const collectionType = ctx.types.resolve(collection).type;
      const elementType = collectionType.kind === 'List' ? collectionType.of : sobjectType();
      const item = apexName(ctx, node.body.iterationVariable ?? node.name);
      out.push(forEach(
        elementType,
        item,
        apexName(ctx, collection),
        lowerFrom(cfg, node.body.bodyTarget, current, ctx)
      ));
      current = node.body.afterTarget;
      continue;
    }

    const own = lowerElement(node, ctx);
    const fault = faultTarget(node);
    if (fault) {
      out.push(tryCatch(own, 'e', lowerFrom(cfg, fault, stopAt, ctx)));
    } else {
      out.push(...own);
    }
    current = cfg.successors(current).find((e) => e.kind === 'next')?.to;
  }

  return out;
}
```

- [ ] **Step 6: Run to verify they pass**

Run: `npx jest tests/lower tests/apex`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/apex/stmt.ts src/apex/emit.ts src/lower/walk.ts tests/apex/stmt.test.ts tests/lower/walk.test.ts
git commit -m "feat(lower): rebuild structured control flow from the Flow graph

Decisions walk each branch up to the immediate post-dominator and emit the
join once afterwards, rather than duplicating the continuation into every
branch. Loops come from Flow's own loop elements, so a back-edge is simply
end-of-body.

Fault connectors become try/catch. Without that a Flow's error path
silently disappears, which is not faithful lowering.

Adds else to ifThen and a tryCatch statement, both with the existing
call sites unchanged."
```

---

### Task 11: Assemble the class and the manifest

**Files:**
- Create: `src/lower/lowerFlow.ts`
- Test: `tests/lower/lowerFlow.test.ts`

**Interfaces:**
- Produces, from `src/lower/lowerFlow.ts`:
  - `interface Manifest { flowName: string; className: string; guesses: string[]; stubs: string[]; dependencies: string[]; unsupported: string[] }`
  - `interface LoweredFlow { apexClass: ApexClass; source: string; manifest: Manifest }`
  - `lowerFlow(ir: FlowIR): LoweredFlow` — throws `LoweringRefusal`

- [ ] **Step 1: Write the failing tests**

Create `tests/lower/lowerFlow.test.ts`:

```typescript
import { FlowIR } from '../../src/ir/types.js';
import { LoweringRefusal } from '../../src/lower/context.js';
import { lowerFlow } from '../../src/lower/lowerFlow.js';

function flow(over: Partial<FlowIR> = {}): FlowIR {
  return {
    flowName: 'NC_Validate_Loans', processType: 'AutoLaunchedFlow',
    declarations: [], nodes: [], unsupported: [],
    start: { triggerKind: 'autolaunched', sourceJson: '{}' },
    ...over,
  };
}

describe('lowerFlow', () => {
  it('names the class after the Flow', () => {
    expect(lowerFlow(flow()).apexClass.name).toBe('NC_Validate_Loans');
  });

  it('renames a Flow whose name is an Apex keyword', () => {
    expect(lowerFlow(flow({ flowName: 'Update' })).apexClass.name).toBe('vUpdate');
  });

  it('defaults to with sharing and honours runInMode', () => {
    expect(lowerFlow(flow()).apexClass.sharing).toBe('with sharing');
    expect(lowerFlow(flow({ runInMode: 'SystemModeWithoutSharing' })).apexClass.sharing)
      .toBe('without sharing');
  });

  it('turns input declarations into method parameters', () => {
    const ir = flow({
      declarations: [{
        name: 'LoansInPP', kind: 'variable', dataType: 'SObject', objectType: 'LLC_BI__Loan__c',
        isCollection: true, isInput: true, isOutput: false, sourceJson: '{}',
      }],
    });
    const method = lowerFlow(ir).apexClass.methods.find((m) => m.name === 'execute');
    expect(method?.params).toEqual([
      { type: { kind: 'List', of: { kind: 'SObject', name: 'LLC_BI__Loan__c' } }, name: 'LoansInPP' },
    ]);
  });

  it('turns constants into private static final fields', () => {
    const ir = flow({
      declarations: [{
        name: 'FIELD_NAME', kind: 'constant', dataType: 'String', isCollection: false,
        isInput: false, isOutput: false, value: { kind: 'string', raw: 'Amount__c' },
        sourceJson: '{}',
      }],
    });
    const field = lowerFlow(ir).apexClass.fields.find((f) => f.name === 'FIELD_NAME');
    expect(field?.isStatic).toBe(true);
    expect(field?.isFinal).toBe(true);
  });

  it('declares non-input variables as locals', () => {
    const ir = flow({
      declarations: [{
        name: 'Msg', kind: 'variable', dataType: 'String', isCollection: false,
        isInput: false, isOutput: false, sourceJson: '{}',
      }],
    });
    expect(lowerFlow(ir).source).toContain('String Msg;');
  });

  it('says in the header that the output is not bulkified', () => {
    // Without this the tool looks broken to anyone reading the output before
    // BulkTransformer lands.
    expect(lowerFlow(flow()).apexClass.doc.join(' ')).toMatch(/not bulkified/i);
  });

  it('lists guessed casts in the class header, not only the manifest', () => {
    const ir = flow({
      declarations: [{
        name: 'Acct', kind: 'variable', dataType: 'SObject', objectType: 'Account',
        isCollection: false, isInput: false, isOutput: false, sourceJson: '{}',
      }],
      nodes: [{
        name: 'Set', kind: 'assignments', connectors: [], sourceJson: '{}', raw: {},
        body: { kind: 'assignment', items: [
          { target: 'Acct.NC_Amount__c', operator: 'Assign', value: { kind: 'string', raw: 'x' } },
        ] },
      }],
      start: { triggerKind: 'autolaunched', connector: { target: 'Set', isFault: false }, sourceJson: '{}' },
    });
    const result = lowerFlow(ir);
    expect(result.apexClass.doc.join(' ')).toContain('NC_Amount__c');
    expect(result.manifest.guesses.join(' ')).toContain('NC_Amount__c');
  });

  it('returns output declarations on an inner Result class', () => {
    // Without this the Flow's outputs are computed into locals and discarded.
    const ir = flow({
      declarations: [{
        name: 'ValidationMessages', kind: 'variable', dataType: 'String', isCollection: true,
        isInput: false, isOutput: true, sourceJson: '{}',
      }],
    });
    const result = lowerFlow(ir);
    expect(result.apexClass.inner.map((c) => c.name)).toEqual(['Result']);
    expect(result.source).toContain('return result;');
    expect(result.source).toContain('result.ValidationMessages = ValidationMessages;');
  });

  it('stays void when the Flow declares no outputs', () => {
    const built = lowerFlow(flow());
    expect(built.apexClass.inner).toEqual([]);
    expect(built.apexClass.methods[0].returnType).toBeNull();
  });

  it('supplies a trigger delegation line for a record-triggered Flow', () => {
    // The converter never emits a trigger file, so the one-line wiring the
    // developer must add is part of the output.
    const ir = flow({
      start: { triggerKind: 'RecordAfterSave', object: 'Account', sourceJson: '{}' },
    });
    expect(lowerFlow(ir).manifest.delegation).toContain('Account');
  });

  it('carries the IR unsupported list into the manifest', () => {
    const ir = flow({
      unsupported: [{ kind: 'screens', name: 'Ask', reason: 'no Apex equivalent', sourceJson: '{}' }],
    });
    expect(lowerFlow(ir).manifest.unsupported.join(' ')).toContain('Ask');
  });

  it('refuses a Flow whose graph cannot be structured', () => {
    const ir = flow({
      nodes: [
        { name: 'A', kind: 'assignments', connectors: [{ target: 'B', isFault: false }],
          sourceJson: '{}', raw: {}, body: { kind: 'assignment', items: [] } },
        { name: 'B', kind: 'assignments', connectors: [{ target: 'A', isFault: false }],
          sourceJson: '{}', raw: {}, body: { kind: 'assignment', items: [] } },
      ],
      start: { triggerKind: 'autolaunched', connector: { target: 'A', isFault: false }, sourceJson: '{}' },
    });
    expect(() => lowerFlow(ir)).toThrow(LoweringRefusal);
  });
});
```

- [ ] **Step 2: Add a return statement to the AST**

Output declarations become fields on a returned `Result` class. `construct()`
already exists from Task 1; the return statement does not.

Add to `tests/apex/stmt.test.ts`:

```typescript
it('emits a return with a value', () => {
  expect(emitStmt(returnStmt(variable(STRING, 'result')))).toBe('return result;');
});

it('emits a bare return', () => {
  expect(emitStmt(returnStmt(null))).toBe('return;');
});
```

In `src/apex/stmt.ts`:

```typescript
  | { stmt: 'returnStmt'; value: ApexExpr | null }
```

```typescript
export function returnStmt(value: ApexExpr | null): ApexStmt {
  return { stmt: 'returnStmt', value };
}
```

In `src/apex/emit.ts`:

```typescript
    case 'returnStmt':
      return s.value === null ? `${pad}return;` : `${pad}return ${emitExpr(s.value)};`;
```

Run: `npx jest tests/apex` — expect PASS.

- [ ] **Step 3: Run the lowerFlow tests to verify they fail, then implement `src/lower/lowerFlow.ts`**

```typescript
import { ApexClass, ApexField, ApexMethod, ApexParam, emitClass } from '../apex/class.js';
import { Scope } from '../apex/scope.js';
import { construct, variable } from '../apex/expr.js';
import { ApexStmt, declare, memberWrite, returnStmt } from '../apex/stmt.js';
import { ApexType, sobjectType } from '../apex/types.js';
import { FlowDeclaration, FlowIR } from '../ir/types.js';
import { buildCfg, checkStructure } from './cfg.js';
import { LowerContext, LoweringRefusal, apexName } from './context.js';
import { lowerFormula } from './elements/stubs.js';
import { declarationTypeSource, flowTypeToApex } from './typeSource.js';
import { lowerValue } from './value.js';
import { lowerFrom } from './walk.js';

export interface Manifest {
  flowName: string;
  className: string;
  guesses: string[];
  stubs: string[];
  dependencies: string[];
  unsupported: string[];
  /**
   * For a record-triggered Flow, the line to add to the org's existing trigger.
   *
   * The overall spec's decision is that the converter emits the handler class
   * and never a trigger file: it cannot know whether a trigger already exists on
   * the object, and a second one fires in undefined order relative to the first.
   */
  delegation?: string;
}

export interface LoweredFlow {
  apexClass: ApexClass;
  source: string;
  manifest: Manifest;
}

function sharingOf(runInMode: string | undefined): ApexClass['sharing'] {
  if (runInMode === undefined) return 'with sharing';
  const mode = runInMode.toLowerCase();
  if (mode.includes('withoutsharing')) return 'without sharing';
  if (mode.includes('default')) return 'inherited sharing';
  return 'with sharing';
}

export function lowerFlow(ir: FlowIR): LoweredFlow {
  const cfg = buildCfg(ir);
  const structure = checkStructure(cfg);
  if (!structure.ok) throw new LoweringRefusal(structure.problems);

  const scope = new Scope();
  const className = scope.allocate(ir.flowName);
  const ctx: LowerContext = {
    ir,
    types: declarationTypeSource(ir),
    scope: scope.child(),
    names: new Map(),
    notes: [],
    stubs: new Map(),
    formulas: new Map(),
  };

  const params: ApexParam[] = [];
  const fields: ApexField[] = [];
  const locals: ApexStmt[] = [];
  const outputs: { declaration: FlowDeclaration; type: ApexType; name: string }[] = [];

  for (const d of ir.declarations) {
    const type = flowTypeToApex(d.dataType, d.objectType, d.isCollection);
    const name = apexName(ctx, d.name);

    if (d.kind === 'formula') {
      // Registers a stub, or resolves to an exact translation. Either way the
      // expression must exist before any element references the formula, which
      // is why declarations are processed before the walk.
      ctx.formulas.set(d.name, lowerFormula(d, ctx));
      continue;
    }
    if (d.kind === 'constant') {
      fields.push({
        visibility: 'private', isStatic: true, isFinal: true, type, name,
        init: d.value ? lowerValue(d.value, ctx) : null,
      });
      continue;
    }
    if (d.isInput) {
      params.push({ type, name });
      continue;
    }
    if (d.isOutput) outputs.push({ declaration: d, type, name });
    locals.push(declare(type, name, null));
  }

  const body: ApexStmt[] = [...locals, ...lowerFrom(cfg, cfg.entry, undefined, ctx)];

  // Outputs become public fields on a returned Result, so a caller can read
  // what the Flow produced. Without this the values are computed and discarded.
  const inner: ApexClass[] = [];
  let returnType: ApexType | null = null;
  if (outputs.length > 0) {
    const resultType = sobjectType('Result');
    inner.push({
      name: 'Result',
      sharing: 'with sharing',
      doc: ["The Flow's output variables."],
      fields: outputs.map((o) => ({
        visibility: 'public' as const, isStatic: false, isFinal: false,
        type: o.type, name: o.name, init: null,
      })),
      methods: [],
      inner: [],
    });
    const resultVar = ctx.scope.allocate('result');
    body.push(declare(resultType, resultVar, construct(resultType, [])));
    for (const o of outputs) {
      body.push(memberWrite(resultVar, o.name, variable(o.type, o.name)));
    }
    body.push(returnStmt(variable(resultType, resultVar)));
    returnType = resultType;
  }

  const guesses = ctx.notes.filter((n) => n.kind === 'guess').map((n) => n.detail);
  const stubs = ctx.notes.filter((n) => n.kind === 'stub').map((n) => n.detail);
  const dependencies = ctx.notes.filter((n) => n.kind === 'dependency').map((n) => n.detail);
  const unsupported = ir.unsupported.map((u) => `${u.kind} ${u.name ?? ''}: ${u.reason}`.trim());

  const doc = [
    `Generated from Flow: ${ir.flowName}.`,
    'Do not edit by hand; re-run the converter instead.',
    '',
    'This output is NOT bulkified. It preserves the Flow\'s semantics exactly,',
    'including per-record DML inside loops. Bulkification is a later milestone.',
  ];
  if (guesses.length > 0) {
    doc.push('', 'Field types GUESSED from naming, not from a describe:');
    for (const g of guesses) doc.push(`  - ${g}`);
  }
  if (stubs.length > 0) {
    doc.push('', 'Not translated — these methods throw until implemented:');
    for (const s of stubs) doc.push(`  - ${s}`);
  }
  if (dependencies.length > 0) {
    doc.push('', 'Requires separately converted Flows:');
    for (const d of dependencies) doc.push(`  - ${d}`);
  }

  const execute: ApexMethod = {
    visibility: 'public', isStatic: true, returnType, name: 'execute',
    params, body, doc: [],
  };

  const apexClass: ApexClass = {
    name: className,
    sharing: sharingOf(ir.runInMode),
    doc,
    fields,
    methods: [execute, ...ctx.stubs.values()],
    inner,
  };

  return {
    apexClass,
    source: emitClass(apexClass),
    manifest: {
      flowName: ir.flowName, className, guesses, stubs, dependencies, unsupported,
      delegation: ir.start?.object
        ? `${className}.execute(Trigger.new);  // add to the existing ${ir.start.object} trigger`
        : undefined,
    },
  };
}
```

- [ ] **Step 4: Run and commit**

Run: `npx jest tests/lower tests/apex`
Expected: PASS.

```bash
git add src/apex/expr.ts src/apex/stmt.ts src/apex/emit.ts src/lower/lowerFlow.ts tests/apex/expr.test.ts tests/apex/stmt.test.ts tests/lower/lowerFlow.test.ts
git commit -m "feat(lower): assemble the Apex class and its manifest

Declarations split by role: inputs become parameters, constants become
private static final fields, the rest become locals. Every name goes
through Scope, so a Flow called Update cannot produce a class that will
not compile.

Guessed casts, stubs and subflow dependencies are listed in the class's
own ApexDoc as well as the manifest. The overall spec requires that a
describe-derived cast and a spelling-derived cast not look the same, and
the person reading the Apex is not holding the manifest.

Output declarations become public fields on a returned inner Result class,
so what the Flow produced is readable by a caller instead of computed into
a local and discarded. That needed construct() and returnStmt(): literal()
refused 'new Result()' because its atom guard rejects compound text, which
is the guard doing its job.

The header states plainly that the output is not bulkified. Without that
the tool looks broken to anyone reading it before BulkTransformer lands."
```

---

### Task 12: The `convert` command, and the acceptance bar

**Files:**
- Modify: `src/index.ts`
- Test: `tests/lower/convert.test.ts`

**Interfaces:**
- Consumes: `lowerFlow`, `parseFlowFile`, `LoweringRefusal`
- Produces: a `convert <flow-file> [--output <dir>]` CLI command

- [ ] **Step 1: Write the failing end-to-end test**

Create `tests/lower/convert.test.ts`:

```typescript
import { parseFlowFile } from '../../src/ir/parseFlow.js';
import { lowerFlow } from '../../src/lower/lowerFlow.js';

describe('converting the bundled example Flow', () => {
  it('lowers without refusing', async () => {
    const ir = await parseFlowFile('exampleflow.xml');
    expect(() => lowerFlow(ir)).not.toThrow();
  });

  it('produces a class whose shape is Apex', async () => {
    const { source } = lowerFlow(await parseFlowFile('exampleflow.xml'));
    expect(source).toContain('public with sharing class');
    expect(source).toContain('public static void execute(');
    expect(source.split('{').length).toBe(source.split('}').length);
  });

  it('reports the stubs it generated rather than hiding them', async () => {
    const { manifest } = lowerFlow(await parseFlowFile('exampleflow.xml'));
    // Two formulas with functions, and one apex action.
    expect(manifest.stubs.length).toBeGreaterThanOrEqual(3);
  });

  it('never emits an unescaped apostrophe inside a string literal', async () => {
    const { source } = lowerFlow(await parseFlowFile('exampleflow.xml'));
    for (const line of source.split('\n')) {
      const quotes = (line.match(/(?<!\\)'/g) ?? []).length;
      expect(quotes % 2).toBe(0);
    }
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx jest tests/lower/convert.test.ts`
Expected: FAIL initially. Fix whatever it surfaces in the module that owns the
problem — do not special-case the fixture.

- [ ] **Step 3: Add the `convert` command**

In `src/index.ts`, following the existing `ir` command's structure:

```typescript
program
  .command('convert <flow-file>')
  .description('Convert a Flow to an Apex class (not yet bulkified)')
  .option('-o, --output <dir>', 'directory to write the class into', '.')
  .action(async (flowFile: string, options: { output: string }) => {
    try {
      const ir = await parseFlowFile(flowFile);
      const { source, manifest } = lowerFlow(ir);
      const classPath = path.join(options.output, `${manifest.className}.cls`);
      const metaPath = `${classPath}-meta.xml`;
      const manifestPath = path.join(options.output, `${manifest.className}-manifest.json`);

      fs.writeFileSync(classPath, `${source}\n`);
      fs.writeFileSync(metaPath,
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">\n' +
        '    <apiVersion>58.0</apiVersion>\n' +
        '    <status>Active</status>\n' +
        '</ApexClass>\n');
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

      console.log(`Wrote ${classPath}`);
      if (manifest.guesses.length > 0) {
        console.log(`  ${manifest.guesses.length} field type(s) guessed from naming`);
      }
      if (manifest.stubs.length > 0) {
        console.log(`  ${manifest.stubs.length} construct(s) stubbed — the class compiles but throws if reached`);
      }
    } catch (error) {
      if (error instanceof LoweringRefusal) {
        // No .cls is written. Half a class whose control flow was guessed is
        // worse than none.
        console.error('Cannot convert this Flow:');
        for (const p of error.problems) console.error(`  - ${p}`);
        process.exitCode = 1;
        return;
      }
      throw error;
    }
  });
```

- [ ] **Step 4: Run the full suite and the static gates**

```bash
pnpm test
npx tsc --noEmit
npx eslint src/apex src/lower tests/apex tests/lower
node dist/index.js ir exampleflow.xml   # must still say 20 of 20 typed bodies
```

Expected: all green; `ir`, `analyze` and `bulkify` unchanged.

- [ ] **Step 5: The acceptance bar — compile the output in a real org**

This is the step that matters. Every Critical found during Milestone 2b was
confirmed by the compiler, and two of them contradicted confident reasoning
about Apex semantics.

```bash
pnpm build
mkdir -p /tmp/convert-out/force-app/main/default/classes
node dist/index.js convert exampleflow.xml --output /tmp/convert-out/force-app/main/default/classes
cd /tmp/convert-out
cat > sfdx-project.json <<'JSON'
{"packageDirectories":[{"path":"force-app","default":true}],"namespace":"","sourceApiVersion":"58.0"}
JSON
sf project deploy validate --source-dir force-app --target-org devedition
```

Expected: validation succeeds. If it fails, the compiler error names the
construct — fix it in the module that owns it, add the failing case as a unit
test first, and re-run. Do not edit the generated file.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/lower/convert.test.ts
git commit -m "feat(cli): add convert, and compile its output against a real org

convert writes the class, its 58.0 meta file and a manifest. A refusal
writes nothing and exits non-zero: half a class whose control flow was
guessed is worse than none.

The acceptance bar is that the generated class validates against a real
org. Every Critical found in Milestone 2b was confirmed by the compiler,
and two of them contradicted confident reasoning about Apex semantics, so
compiling the output is the cheapest available source of truth."
```

---

## After the plan

The generated class **compiles but does not run** — `exampleflow.xml` produces
three stubs. That is the agreed outcome, not a partial success, and it means 2c
cannot be differentially tested against the original Flow. That becomes possible
only once Milestone 6 lands formula translation.

Remaining milestones, unchanged by this plan:

- **Milestone 3** — `TypeResolver` with `sf sobject describe`, removing every
  `heuristic` provenance.
- **BulkTransformer** — hoist queries out of loops, key DML by collected Ids.
  A tree-to-tree transform over a lowering that is already correct and tested.
- **Milestone 6** — `FormulaTranslator`, which turns the stubs into real code.
- **Verifier** — `--mode compile` in CI against a scratch org, then
  `--mode differential`.
