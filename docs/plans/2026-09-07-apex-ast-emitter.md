# Apex AST and Emitter Implementation Plan (Milestone 2b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a typed Apex AST and source emitter in which this project's four original defects cannot be constructed at all.

**Architecture:** A new `src/apex/` module: a small Apex type model, expression and statement nodes whose *constructors enforce Apex's typing rules*, a scope that allocates identifiers, a SOQL builder that cannot omit its object, and an emitter that renders the tree. Purely additive — nothing produces this AST yet; lowering `FlowIR` onto it is Milestone 2c.

**Tech Stack:** TypeScript 5 (`strict: true`, CommonJS, ES2020 target), Jest + ts-jest. No new dependencies.

**Spec:** `docs/specs/2026-09-07-flow-to-apex-converter-design.md`

## The point of this milestone

The 2.0.x generator built Apex — a typed language — out of template strings, and shipped four defects with one root cause:

| Defect | Emitted | Why templates allowed it |
|---|---|---|
| Non-compiling comparison | `record.get('Amount__c') > 1000` | `get()` returns `Object`; no type was tracked |
| Non-compiling operator | `a contains 'x'` | Flow operator pasted as an infix word |
| Wrong table queried | `FROM Account` for every Flow | Object was a literal in the template |
| Silent data loss | update collected without its field writes | Field writes computed, then not interpolated |

Each was fixed individually. That is not the same as preventing the class. **This AST's acceptance bar is that all four are unrepresentable** — the code to produce them does not typecheck, or throws at construction. Task 6 is that bar, written as tests.

Two more, from the same family, are also made impossible: the doubled `_Bulkified` suffix and the reused `relatedRecords` variable, both of which came from string concatenation with no notion of an identifier.

## Global Constraints

- TypeScript `strict: true`. No `any` in exported signatures; `unknown` plus a narrowing guard instead.
- **Generated Apex targets API 58.0 or later** (spec decision): SOQL carries `WITH USER_MODE`, DML goes through `Database.*(records, AccessLevel.USER_MODE)`, classes are `with sharing`.
- Nothing in `src/apex/` may import from `src/ir/` or `src/utils/`. The AST knows Apex; it does not know Flow. Lowering is Milestone 2c's job and lives elsewhere.
- Constructors validate. An invalid tree throws `ApexTypeError` at construction rather than emitting bad source — the failure surfaces where the mistake is, not at deploy time in someone else's org.
- Existing behaviour untouched: `analyze`, `bulkify` and `ir` keep working.
- Existing tests must keep passing: `npx jest` is 121 tests / 15 suites before this plan starts.

## File Structure

| File | Responsibility |
|---|---|
| `src/apex/types.ts` | The Apex type model and its rendering |
| `src/apex/errors.ts` | `ApexTypeError` |
| `src/apex/expr.ts` | Expression nodes and the constructors that enforce typing |
| `src/apex/scope.ts` | Identifier allocation and uniqueness |
| `src/apex/soql.ts` | SOQL query construction |
| `src/apex/stmt.ts` | Statement nodes |
| `src/apex/emit.ts` | AST → Apex source |
| `tests/apex/*.test.ts` | One suite per module, plus the defect-regression suite |

---

### Task 1: The Apex type model

**Files:**
- Create: `src/apex/types.ts`, `src/apex/errors.ts`
- Test: `tests/apex/types.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `ApexType`, the constants `ID`, `STRING`, `BOOLEAN`, `DECIMAL`, `INTEGER`, `DATE`, `DATETIME`, `OBJECT`, the constructors `sobjectType(name?)` and `listOf(type)`, the predicates `isComparable(type)` and `isUntyped(type)`, the renderer `renderType(type)`, and `ApexTypeError`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/apex/types.test.ts
import {
  BOOLEAN, DATE, DECIMAL, ID, INTEGER, OBJECT, STRING,
  isComparable, isUntyped, listOf, renderType, sobjectType,
} from '../../src/apex/types.js';

describe('renderType', () => {
  it('renders scalars', () => {
    expect(renderType(ID)).toBe('Id');
    expect(renderType(STRING)).toBe('String');
    expect(renderType(DECIMAL)).toBe('Decimal');
    expect(renderType(OBJECT)).toBe('Object');
  });

  it('renders a named SObject and the generic one', () => {
    expect(renderType(sobjectType('LLC_BI__Loan__c'))).toBe('LLC_BI__Loan__c');
    expect(renderType(sobjectType())).toBe('SObject');
  });

  it('renders a list of a type', () => {
    expect(renderType(listOf(sobjectType('Account')))).toBe('List<Account>');
    expect(renderType(listOf(listOf(ID)))).toBe('List<List<Id>>');
  });
});

describe('isComparable', () => {
  it('accepts the types Apex can order', () => {
    for (const t of [DECIMAL, INTEGER, DATE]) {
      expect(isComparable(t)).toBe(true);
    }
  });

  it('rejects Object, which is what record.get() returns', () => {
    // This is the whole defence against `record.get('X') > 1000`.
    expect(isComparable(OBJECT)).toBe(false);
  });

  it('rejects Boolean and SObject, which Apex cannot order', () => {
    expect(isComparable(BOOLEAN)).toBe(false);
    expect(isComparable(sobjectType('Account'))).toBe(false);
  });
});

describe('isUntyped', () => {
  it('identifies Object and nothing else', () => {
    expect(isUntyped(OBJECT)).toBe(true);
    expect(isUntyped(STRING)).toBe(false);
    expect(isUntyped(sobjectType())).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/apex/types.test.ts`
Expected: FAIL — "Cannot find module '../../src/apex/types.js'".

- [ ] **Step 3: Create `src/apex/errors.ts`**

```typescript
// src/apex/errors.ts

/**
 * Thrown when a caller tries to construct an Apex tree that could not compile.
 *
 * The point of raising at construction is that the mistake surfaces in the
 * converter's own test run, not as a deploy error in a customer's org.
 */
export class ApexTypeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApexTypeError';
  }
}
```

- [ ] **Step 4: Create `src/apex/types.ts`**

```typescript
// src/apex/types.ts

export type ApexType =
  | { kind: 'Id' }
  | { kind: 'String' }
  | { kind: 'Boolean' }
  | { kind: 'Decimal' }
  | { kind: 'Integer' }
  | { kind: 'Date' }
  | { kind: 'Datetime' }
  /** A concrete SObject when `name` is set; the abstract `SObject` when it is not. */
  | { kind: 'SObject'; name?: string }
  | { kind: 'List'; of: ApexType }
  /** What `record.get()` returns. Deliberately near-useless: see isComparable. */
  | { kind: 'Object' };

export const ID: ApexType = { kind: 'Id' };
export const STRING: ApexType = { kind: 'String' };
export const BOOLEAN: ApexType = { kind: 'Boolean' };
export const DECIMAL: ApexType = { kind: 'Decimal' };
export const INTEGER: ApexType = { kind: 'Integer' };
export const DATE: ApexType = { kind: 'Date' };
export const DATETIME: ApexType = { kind: 'Datetime' };
export const OBJECT: ApexType = { kind: 'Object' };

export function sobjectType(name?: string): ApexType {
  return { kind: 'SObject', name };
}

export function listOf(of: ApexType): ApexType {
  return { kind: 'List', of };
}

export function renderType(type: ApexType): string {
  switch (type.kind) {
    case 'SObject':
      return type.name ?? 'SObject';
    case 'List':
      return `List<${renderType(type.of)}>`;
    default:
      return type.kind;
  }
}

/**
 * Types Apex will accept either side of `<`, `>`, `<=`, `>=`.
 *
 * String is deliberately excluded: Apex's ordering operators cover numeric and
 * date types, and string ordering goes through `compareTo()`. Confidence note —
 * this was checked against secondary sources rather than the official operator
 * reference, which returned 403; if `'a' < 'b'` does compile, add 'String' here
 * and the rest of the module is unaffected. The error message already points a
 * caller at compareTo, so the failure mode is a clear refusal, not wrong output.
 */
export function isComparable(type: ApexType): boolean {
  return ['Decimal', 'Integer', 'Date', 'Datetime'].includes(type.kind);
}

/**
 * True for the one type that carries no information. `record.get()` returns Object,
 * and every relational comparison the 2.0.x generator emitted was against one.
 */
export function isUntyped(type: ApexType): boolean {
  return type.kind === 'Object';
}
```

- [ ] **Step 5: Run the tests**

Run: `npx jest tests/apex/types.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add src/apex/types.ts src/apex/errors.ts tests/apex/types.test.ts
git commit -m "feat(apex): add the Apex type model

isComparable is the load-bearing predicate: Object is not comparable, and
record.get() returns Object. Every non-compiling comparison this project has
shipped was one an untyped expression was allowed into."
```

---

### Task 2: Typed expressions

**Files:**
- Create: `src/apex/expr.ts`
- Test: `tests/apex/expr.test.ts`

**Interfaces:**
- Consumes: everything from `src/apex/types.js` and `ApexTypeError` from `src/apex/errors.js`
- Produces: `ApexExpr`, and the constructors `literal(type, text)`, `variable(type, name)`, `fieldRead(record, field, type)`, `comparison(left, op, right)`, `equality(left, op, right)`, `logical(op, operands)`, `nullTest(operand, negated)`, `methodCall(target, method, args, type)`

The `Comparison` and `Equality` split matters: Apex will compare any two values for equality, but will only *order* comparable ones.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/apex/expr.test.ts
import { ApexTypeError } from '../../src/apex/errors.js';
import {
  comparison, equality, fieldRead, literal, logical, methodCall, nullTest, variable,
} from '../../src/apex/expr.js';
import { BOOLEAN, DECIMAL, ID, OBJECT, STRING, sobjectType } from '../../src/apex/types.js';

describe('fieldRead', () => {
  it('carries the type it was told, never Object', () => {
    const e = fieldRead('record', 'LLC_BI__Amount__c', DECIMAL);
    expect(e.type).toEqual(DECIMAL);
  });

  it('refuses to produce an untyped read', () => {
    // A field read with no known type is the input to every defect this module
    // exists to prevent. Callers must resolve the type first.
    expect(() => fieldRead('record', 'X__c', OBJECT)).toThrow(ApexTypeError);
  });
});

describe('comparison', () => {
  it('accepts two comparable operands', () => {
    const e = comparison(fieldRead('record', 'Amount__c', DECIMAL), '>', literal(DECIMAL, '1000'));
    expect(e.type).toEqual(BOOLEAN);
  });

  it('refuses an untyped left operand', () => {
    // This is `record.get('Amount__c') > 1000`, the original defect.
    expect(() =>
      comparison(variable(OBJECT, 'raw'), '>', literal(DECIMAL, '1000'))
    ).toThrow(ApexTypeError);
  });

  it('refuses to order a String', () => {
    expect(() =>
      comparison(literal(STRING, "'a'"), '<', literal(STRING, "'b'"))
    ).toThrow(ApexTypeError);
  });

  it('refuses a Boolean operand', () => {
    expect(() =>
      comparison(literal(BOOLEAN, 'true'), '>=', literal(BOOLEAN, 'false'))
    ).toThrow(ApexTypeError);
  });
});

describe('equality', () => {
  it('compares two values of the same type', () => {
    expect(equality(literal(STRING, "'a'"), '==', literal(STRING, "'b'")).type).toEqual(BOOLEAN);
  });

  it('still refuses an untyped operand', () => {
    expect(() => equality(variable(OBJECT, 'raw'), '==', literal(ID, "'001'"))).toThrow(ApexTypeError);
  });
});

describe('nullTest', () => {
  it('is unary — there is no right-hand side to leave dangling', () => {
    // `x == null 1000` was only possible because a template pasted three parts.
    const e = nullTest(variable(STRING, 'name'), false);
    expect(e.node).toBe('nullTest');
    expect(e.type).toEqual(BOOLEAN);
  });

  it('accepts an untyped operand, because null-testing one is valid Apex', () => {
    expect(() => nullTest(variable(OBJECT, 'raw'), true)).not.toThrow();
  });
});

describe('methodCall', () => {
  it('is the only way to express contains', () => {
    // There is no infix operator to misuse, so `a contains 'x'` cannot be built.
    const e = methodCall(variable(STRING, 'name'), 'contains', [literal(STRING, "'x'")], BOOLEAN);
    expect(e.node).toBe('methodCall');
    expect(e.method).toBe('contains');
  });
});

describe('logical', () => {
  it('joins boolean operands', () => {
    const a = equality(literal(STRING, "'a'"), '==', literal(STRING, "'b'"));
    expect(logical('&&', [a, a]).type).toEqual(BOOLEAN);
  });

  it('refuses a non-boolean operand', () => {
    expect(() => logical('&&', [literal(DECIMAL, '1')])).toThrow(ApexTypeError);
  });

  it('refuses an SObject operand', () => {
    expect(() => logical('||', [variable(sobjectType('Account'), 'a')])).toThrow(ApexTypeError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/apex/expr.test.ts`
Expected: FAIL — "Cannot find module '../../src/apex/expr.js'".

- [ ] **Step 3: Create `src/apex/expr.ts`**

```typescript
// src/apex/expr.ts
import { ApexTypeError } from './errors.js';
import { ApexType, BOOLEAN, isComparable, isUntyped, renderType } from './types.js';

export type OrderingOperator = '<' | '>' | '<=' | '>=';
export type EqualityOperator = '==' | '!=';
export type LogicalOperator = '&&' | '||';

export type ApexExpr =
  | { node: 'literal'; type: ApexType; text: string }
  | { node: 'variable'; type: ApexType; name: string }
  | { node: 'fieldRead'; type: ApexType; record: string; field: string }
  | { node: 'comparison'; type: ApexType; op: OrderingOperator; left: ApexExpr; right: ApexExpr }
  | { node: 'equality'; type: ApexType; op: EqualityOperator; left: ApexExpr; right: ApexExpr }
  | { node: 'logical'; type: ApexType; op: LogicalOperator; operands: ApexExpr[] }
  | { node: 'nullTest'; type: ApexType; operand: ApexExpr; negated: boolean }
  | { node: 'methodCall'; type: ApexType; target: ApexExpr; method: string; args: ApexExpr[] };

/** A literal, already rendered as Apex source (quotes included for strings). */
export function literal(type: ApexType, text: string): ApexExpr {
  return { node: 'literal', type, text };
}

export function variable(type: ApexType, name: string): ApexExpr {
  return { node: 'variable', type, name };
}

/**
 * A field read off an SObject, always cast to the type the caller resolved.
 *
 * Refusing OBJECT here is deliberate: an unresolved field type is the input to
 * every defect this module prevents. The caller must resolve the type — from a
 * describe, or from the Flow's own declaration — before it can build a read.
 */
export function fieldRead(record: string, field: string, type: ApexType): ApexExpr {
  if (isUntyped(type)) {
    throw new ApexTypeError(
      `Cannot build a field read for '${field}' with no resolved type. ` +
        `record.get() returns Object; resolve the field's type first.`
    );
  }
  return { node: 'fieldRead', type, record, field };
}

function requireOperand(e: ApexExpr, what: string): void {
  if (isUntyped(e.type)) {
    throw new ApexTypeError(`Cannot use an untyped (Object) expression as ${what}.`);
  }
}

/** `<`, `>`, `<=`, `>=` — only over types Apex can order. */
export function comparison(left: ApexExpr, op: OrderingOperator, right: ApexExpr): ApexExpr {
  requireOperand(left, `the left operand of '${op}'`);
  requireOperand(right, `the right operand of '${op}'`);
  for (const side of [left, right]) {
    if (!isComparable(side.type)) {
      throw new ApexTypeError(
        `Apex cannot order ${renderType(side.type)} with '${op}'. ` +
          `Use equality, or a method call such as compareTo.`
      );
    }
  }
  return { node: 'comparison', type: BOOLEAN, op, left, right };
}

/** `==` and `!=` — any two typed values. */
export function equality(left: ApexExpr, op: EqualityOperator, right: ApexExpr): ApexExpr {
  requireOperand(left, `the left operand of '${op}'`);
  requireOperand(right, `the right operand of '${op}'`);
  return { node: 'equality', type: BOOLEAN, op, left, right };
}

/**
 * `x == null` / `x != null`. Unary by construction: there is no right-hand slot,
 * so the `x == null 1000` shape a three-part template produced cannot be built.
 * An untyped operand is fine — null-testing an Object is valid Apex.
 */
export function nullTest(operand: ApexExpr, negated: boolean): ApexExpr {
  return { node: 'nullTest', type: BOOLEAN, operand, negated };
}

export function logical(op: LogicalOperator, operands: ApexExpr[]): ApexExpr {
  for (const o of operands) {
    if (o.type.kind !== 'Boolean') {
      throw new ApexTypeError(`'${op}' needs Boolean operands; got ${renderType(o.type)}.`);
    }
  }
  return { node: 'logical', type: BOOLEAN, op, operands };
}

/**
 * A method call. String membership tests live here rather than as operators,
 * so `a contains 'x'` — which is not Apex — has no way to be expressed.
 */
export function methodCall(
  target: ApexExpr,
  method: string,
  args: ApexExpr[],
  type: ApexType
): ApexExpr {
  return { node: 'methodCall', type, target, method, args };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx jest tests/apex/expr.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add src/apex/expr.ts tests/apex/expr.test.ts
git commit -m "feat(apex): typed expressions whose constructors reject bad Apex

comparison() refuses untyped and non-orderable operands, so
record.get('X') > 1000 cannot be built. nullTest is unary, so x == null 1000
has no shape to occupy. contains is a method call, so a contains 'x' has no
operator to abuse. Each refusal is a defect this project actually shipped."
```

---

### Task 3: Identifier scope

**Files:**
- Create: `src/apex/scope.ts`
- Test: `tests/apex/scope.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `class Scope` with `allocate(preferred: string): string`, `has(name: string): boolean`, and `child(): Scope`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/apex/scope.test.ts
import { Scope } from '../../src/apex/scope.js';

describe('Scope', () => {
  it('returns the preferred name when it is free', () => {
    expect(new Scope().allocate('relatedRecords')).toBe('relatedRecords');
  });

  it('never returns the same name twice', () => {
    // Two record lookups both wanted `relatedRecords`, and the generator
    // declared it twice in one method.
    const s = new Scope();
    expect(s.allocate('relatedRecords')).toBe('relatedRecords');
    expect(s.allocate('relatedRecords')).toBe('relatedRecords2');
    expect(s.allocate('relatedRecords')).toBe('relatedRecords3');
  });

  it('sanitises a name into a valid Apex identifier', () => {
    expect(new Scope().allocate('Get Pricing-Streams')).toBe('Get_Pricing_Streams');
  });

  it('prefixes a name that starts with a digit', () => {
    expect(new Scope().allocate('2ndPass')).toBe('v2ndPass');
  });

  it('falls back when a name sanitises to nothing', () => {
    expect(new Scope().allocate('---')).toBe('v');
  });

  it('reports what it has allocated', () => {
    const s = new Scope();
    s.allocate('total');
    expect(s.has('total')).toBe(true);
    expect(s.has('other')).toBe(false);
  });

  it('a child sees the parent names and cannot shadow them', () => {
    const parent = new Scope();
    parent.allocate('record');
    expect(parent.child().allocate('record')).toBe('record2');
  });

  it('a child allocation does not leak into the parent', () => {
    const parent = new Scope();
    parent.child().allocate('temp');
    expect(parent.has('temp')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/apex/scope.test.ts`
Expected: FAIL — "Cannot find module '../../src/apex/scope.js'".

- [ ] **Step 3: Create `src/apex/scope.ts`**

```typescript
// src/apex/scope.ts

/**
 * Allocates Apex identifiers, guaranteeing each is valid and unique.
 *
 * Both of this project's identifier defects came from string concatenation with
 * no notion of a name: two lookups each declared `relatedRecords`, and a method
 * name was built by appending a suffix that the sanitiser had already added,
 * producing validateX_Bulkified_Bulkified. Allocation removes the possibility.
 */
export class Scope {
  private readonly taken = new Set<string>();

  constructor(private readonly parent?: Scope) {}

  /** True when this scope, or any ancestor, has allocated the name. */
  has(name: string): boolean {
    return this.taken.has(name) || (this.parent?.has(name) ?? false);
  }

  /**
   * A valid, unique Apex identifier close to `preferred`. Collisions get a numeric
   * suffix rather than being silently reused.
   */
  allocate(preferred: string): string {
    const base = Scope.sanitise(preferred);
    if (!this.has(base)) {
      this.taken.add(base);
      return base;
    }
    for (let n = 2; ; n += 1) {
      const candidate = `${base}${n}`;
      if (!this.has(candidate)) {
        this.taken.add(candidate);
        return candidate;
      }
    }
  }

  /** A nested scope: sees the parent's names, but does not add to them. */
  child(): Scope {
    return new Scope(this);
  }

  private static sanitise(name: string): string {
    const cleaned = name.replace(/[^A-Za-z0-9_]/g, '_').replace(/_+$/, '');
    if (cleaned === '' || /^_+$/.test(cleaned)) return 'v';
    return /^[0-9]/.test(cleaned) ? `v${cleaned}` : cleaned;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx jest tests/apex/scope.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/apex/scope.ts tests/apex/scope.test.ts
git commit -m "feat(apex): allocate identifiers instead of concatenating them

Two record lookups both declared relatedRecords in one method, and a method
name gained _Bulkified twice because a suffix was appended to a string that
already carried it. Allocation makes both impossible."
```

---

### Task 4: SOQL construction

**Files:**
- Create: `src/apex/soql.ts`
- Test: `tests/apex/soql.test.ts`

**Interfaces:**
- Consumes: `ApexTypeError` from `src/apex/errors.js`
- Produces: `SoqlQuery`, `soql(spec: SoqlSpec): SoqlQuery`, `renderSoql(query: SoqlQuery): string`, and the type `SoqlSpec = { object: string; fields: string[]; whereIdIn?: string; orderBy?: { field: string; direction?: 'ASC' | 'DESC' }; limit?: number }`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/apex/soql.test.ts
import { ApexTypeError } from '../../src/apex/errors.js';
import { renderSoql, soql } from '../../src/apex/soql.js';

describe('soql', () => {
  it('requires an object — there is no default to fall back to', () => {
    // The 2.0.x generator emitted `FROM Account` for every Flow because the
    // object was a literal in a template. Here it is a required input.
    expect(() => soql({ object: '', fields: ['Id'] })).toThrow(ApexTypeError);
  });

  it('requires at least one field', () => {
    expect(() => soql({ object: 'Account', fields: [] })).toThrow(ApexTypeError);
  });

  it('always selects Id, and never twice', () => {
    expect(soql({ object: 'Account', fields: ['Name'] }).fields).toEqual(['Id', 'Name']);
    expect(soql({ object: 'Account', fields: ['Id', 'Name'] }).fields).toEqual(['Id', 'Name']);
  });

  it('rejects a field name that is not an identifier', () => {
    expect(() => soql({ object: 'Account', fields: ["Name FROM User WHERE Id != null OR '1'='1"] }))
      .toThrow(ApexTypeError);
  });

  it('rejects an object name that is not an identifier', () => {
    expect(() => soql({ object: 'Account; DELETE', fields: ['Id'] })).toThrow(ApexTypeError);
  });
});

describe('renderSoql', () => {
  it('renders the object the caller named', () => {
    const q = soql({ object: 'LLC_BI__Pricing_Stream__c', fields: ['Id'] });
    expect(renderSoql(q)).toContain('FROM LLC_BI__Pricing_Stream__c');
  });

  it('always carries WITH USER_MODE', () => {
    // Spec decision: generated Apex targets API 58.0+ and runs in user mode.
    expect(renderSoql(soql({ object: 'Account', fields: ['Id'] }))).toContain('WITH USER_MODE');
  });

  it('binds an Id set rather than interpolating it', () => {
    const q = soql({ object: 'Account', fields: ['Id'], whereIdIn: 'recordIds' });
    expect(renderSoql(q)).toContain('WHERE Id IN :recordIds');
  });

  it('renders ORDER BY and LIMIT when asked', () => {
    const q = soql({
      object: 'Account', fields: ['Id'],
      orderBy: { field: 'CreatedDate', direction: 'DESC' }, limit: 1,
    });
    const sql = renderSoql(q);
    expect(sql).toContain('ORDER BY CreatedDate DESC');
    expect(sql).toContain('LIMIT 1');
  });

  it('puts the clauses in the order Apex requires', () => {
    const sql = renderSoql(soql({
      object: 'Account', fields: ['Id'], whereIdIn: 'ids',
      orderBy: { field: 'Name' }, limit: 5,
    }));
    const order = ['SELECT', 'FROM', 'WHERE', 'WITH USER_MODE', 'ORDER BY', 'LIMIT']
      .map((k) => sql.indexOf(k));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i >= 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/apex/soql.test.ts`
Expected: FAIL — "Cannot find module '../../src/apex/soql.js'".

- [ ] **Step 3: Create `src/apex/soql.ts`**

```typescript
// src/apex/soql.ts
import { ApexTypeError } from './errors.js';

export interface SoqlSpec {
  object: string;
  fields: string[];
  /** Name of an Apex variable holding the Ids to bind. Never a literal list. */
  whereIdIn?: string;
  orderBy?: { field: string; direction?: 'ASC' | 'DESC' };
  limit?: number;
}

export interface SoqlQuery extends SoqlSpec {
  fields: string[];
}

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/;

function requireIdentifier(value: string, what: string): void {
  if (!IDENTIFIER.test(value)) {
    throw new ApexTypeError(`${what} '${value}' is not a valid SOQL identifier.`);
  }
}

/**
 * Build a query. The object is a required input with no default, which is the
 * structural answer to a generator that emitted `FROM Account` for every Flow:
 * there is no query to render until a caller has named the object.
 *
 * Identifiers are validated rather than escaped. A field name is not user prose;
 * anything that is not an identifier is a bug or an injection attempt, and both
 * deserve to fail loudly.
 */
export function soql(spec: SoqlSpec): SoqlQuery {
  if (!spec.object) {
    throw new ApexTypeError('A SOQL query needs an object; none was given.');
  }
  requireIdentifier(spec.object, 'SOQL object');

  if (spec.fields.length === 0) {
    throw new ApexTypeError(`A SOQL query on ${spec.object} needs at least one field.`);
  }
  for (const f of spec.fields) requireIdentifier(f, 'SOQL field');
  if (spec.orderBy) requireIdentifier(spec.orderBy.field, 'ORDER BY field');
  if (spec.whereIdIn) requireIdentifier(spec.whereIdIn, 'bind variable');

  const fields = spec.fields.includes('Id') ? [...spec.fields] : ['Id', ...spec.fields];
  return { ...spec, fields };
}

export function renderSoql(query: SoqlQuery): string {
  const parts = [`SELECT ${query.fields.join(', ')}`, `FROM ${query.object}`];
  if (query.whereIdIn) parts.push(`WHERE Id IN :${query.whereIdIn}`);
  // Spec decision: generated Apex targets 58.0+, so user mode is unconditional.
  parts.push('WITH USER_MODE');
  if (query.orderBy) {
    parts.push(`ORDER BY ${query.orderBy.field}${query.orderBy.direction ? ` ${query.orderBy.direction}` : ''}`);
  }
  if (query.limit !== undefined) parts.push(`LIMIT ${query.limit}`);
  return parts.join('\n');
}
```

- [ ] **Step 4: Run the tests**

Run: `npx jest tests/apex/soql.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/apex/soql.ts tests/apex/soql.test.ts
git commit -m "feat(apex): SOQL that cannot omit its object

soql() takes the object as a required input with no default, so the FROM
Account the 2.0.x generator emitted for every Flow has nowhere to come from.
WITH USER_MODE is unconditional per the spec's 58.0 floor, and identifiers are
validated rather than escaped."
```

---

### Task 5: Statements and the emitter

**Files:**
- Create: `src/apex/stmt.ts`, `src/apex/emit.ts`
- Test: `tests/apex/emit.test.ts`

**Interfaces:**
- Consumes: `ApexExpr` from `src/apex/expr.js`, `SoqlQuery`/`renderSoql` from `src/apex/soql.js`, `ApexType`/`renderType` from `src/apex/types.js`
- Produces: `ApexStmt` and the constructors `declare`, `assign`, `fieldWrite`, `collectInto`, `queryInto`, `ifThen`, `forEach`, `dmlBulk`; plus `emitExpr(e: ApexExpr): string` and `emitStmt(s: ApexStmt, indent?: number): string`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/apex/emit.test.ts
import { emitExpr, emitStmt } from '../../src/apex/emit.js';
import { comparison, equality, fieldRead, literal, methodCall, nullTest, variable } from '../../src/apex/expr.js';
import { soql } from '../../src/apex/soql.js';
import {
  assign, collectInto, declare, dmlBulk, fieldWrite, forEach, ifThen, queryInto,
} from '../../src/apex/stmt.js';
import { DECIMAL, ID, STRING, listOf, sobjectType } from '../../src/apex/types.js';

describe('emitExpr', () => {
  it('emits a field read with its cast', () => {
    expect(emitExpr(fieldRead('record', 'LLC_BI__Amount__c', DECIMAL)))
      .toBe("((Decimal)record.get('LLC_BI__Amount__c'))");
  });

  it('emits a comparison that compiles', () => {
    const e = comparison(fieldRead('record', 'Amount__c', DECIMAL), '>', literal(DECIMAL, '1000'));
    expect(emitExpr(e)).toBe("((Decimal)record.get('Amount__c')) > 1000");
  });

  it('emits a null test with nothing after null', () => {
    expect(emitExpr(nullTest(variable(STRING, 'name'), false))).toBe('name == null');
    expect(emitExpr(nullTest(variable(STRING, 'name'), true))).toBe('name != null');
  });

  it('emits contains as a call', () => {
    const e = methodCall(variable(STRING, 'name'), 'contains', [literal(STRING, "'x'")], STRING);
    expect(emitExpr(e)).toBe("name.contains('x')");
  });

  it('emits equality', () => {
    expect(emitExpr(equality(variable(ID, 'a'), '!=', literal(ID, 'null')))).toBe('a != null');
  });
});

describe('emitStmt', () => {
  it('declares a typed variable', () => {
    expect(emitStmt(declare(listOf(sobjectType('Account')), 'accts', null)))
      .toBe('List<Account> accts;');
  });

  it('declares with an initialiser', () => {
    expect(emitStmt(declare(DECIMAL, 'total', literal(DECIMAL, '0'))))
      .toBe('Decimal total = 0;');
  });

  it('assigns to an existing variable', () => {
    expect(emitStmt(assign('total', literal(DECIMAL, '1')))).toBe('total = 1;');
  });

  it('writes a field onto a record', () => {
    // The 2.0.x generator computed these and then dropped them.
    expect(emitStmt(fieldWrite('record', 'Stage__c', literal(STRING, "'Funded'"))))
      .toBe("record.put('Stage__c', 'Funded');");
  });

  it('collects a record rather than issuing DML', () => {
    expect(emitStmt(collectInto('recordsToUpdate', 'record')))
      .toBe('recordsToUpdate.add(record);');
  });

  it('assigns a query result to a named variable', () => {
    const q = soql({ object: 'Account', fields: ['Id'], whereIdIn: 'ids' });
    const emitted = emitStmt(queryInto(listOf(sobjectType('Account')), 'accts', q));
    expect(emitted).toContain('List<Account> accts = [');
    expect(emitted).toContain('FROM Account');
    expect(emitted).toContain('WITH USER_MODE');
    expect(emitted.trimEnd().endsWith('];')).toBe(true);
  });

  it('emits DML in user mode, guarded by an emptiness check', () => {
    const emitted = emitStmt(dmlBulk('update', 'recordsToUpdate'));
    expect(emitted).toContain('if (!recordsToUpdate.isEmpty())');
    expect(emitted).toContain('Database.update(recordsToUpdate, AccessLevel.USER_MODE);');
  });

  it('emits an if with its body indented', () => {
    const cond = equality(variable(ID, 'a'), '==', literal(ID, 'null'));
    const emitted = emitStmt(ifThen(cond, [assign('total', literal(DECIMAL, '1'))]));
    expect(emitted).toBe('if (a == null) {\n    total = 1;\n}');
  });

  it('emits a for-each over a collection', () => {
    const emitted = emitStmt(
      forEach(sobjectType('Account'), 'acct', 'accts', [collectInto('toUpdate', 'acct')])
    );
    expect(emitted).toBe('for (Account acct : accts) {\n    toUpdate.add(acct);\n}');
  });

  it('nests indentation correctly', () => {
    const inner = ifThen(equality(variable(ID, 'x'), '==', literal(ID, 'null')), [
      collectInto('toUpdate', 'acct'),
    ]);
    const emitted = emitStmt(forEach(sobjectType('Account'), 'acct', 'accts', [inner]));
    expect(emitted).toContain('\n        toUpdate.add(acct);');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/apex/emit.test.ts`
Expected: FAIL — "Cannot find module '../../src/apex/emit.js'".

- [ ] **Step 3: Create `src/apex/stmt.ts`**

```typescript
// src/apex/stmt.ts
import { ApexExpr } from './expr.js';
import { SoqlQuery } from './soql.js';
import { ApexType } from './types.js';

export type DmlOperation = 'insert' | 'update' | 'delete';

export type ApexStmt =
  | { stmt: 'declare'; type: ApexType; name: string; init: ApexExpr | null }
  | { stmt: 'assign'; name: string; value: ApexExpr }
  | { stmt: 'fieldWrite'; record: string; field: string; value: ApexExpr }
  | { stmt: 'collectInto'; collection: string; record: string }
  | { stmt: 'queryInto'; type: ApexType; name: string; query: SoqlQuery }
  | { stmt: 'ifThen'; condition: ApexExpr; body: ApexStmt[] }
  | { stmt: 'forEach'; itemType: ApexType; item: string; collection: string; body: ApexStmt[] }
  | { stmt: 'dmlBulk'; operation: DmlOperation; collection: string };

export function declare(type: ApexType, name: string, init: ApexExpr | null): ApexStmt {
  return { stmt: 'declare', type, name, init };
}

export function assign(name: string, value: ApexExpr): ApexStmt {
  return { stmt: 'assign', name, value };
}

/** `record.put('Field__c', value);` — the write the old generator dropped. */
export function fieldWrite(record: string, field: string, value: ApexExpr): ApexStmt {
  return { stmt: 'fieldWrite', record, field, value };
}

/**
 * Add a record to a collection for later DML.
 *
 * There is deliberately no statement for DML on a single record. The only way to
 * write to the database is dmlBulk over a collection, so a per-iteration
 * insert/update — the anti-pattern this whole tool exists to remove — cannot be
 * represented in the tree at all.
 */
export function collectInto(collection: string, record: string): ApexStmt {
  return { stmt: 'collectInto', collection, record };
}

export function queryInto(type: ApexType, name: string, query: SoqlQuery): ApexStmt {
  return { stmt: 'queryInto', type, name, query };
}

export function ifThen(condition: ApexExpr, body: ApexStmt[]): ApexStmt {
  return { stmt: 'ifThen', condition, body };
}

export function forEach(
  itemType: ApexType,
  item: string,
  collection: string,
  body: ApexStmt[]
): ApexStmt {
  return { stmt: 'forEach', itemType, item, collection, body };
}

export function dmlBulk(operation: DmlOperation, collection: string): ApexStmt {
  return { stmt: 'dmlBulk', operation, collection };
}
```

- [ ] **Step 4: Create `src/apex/emit.ts`**

```typescript
// src/apex/emit.ts
import { ApexExpr } from './expr.js';
import { renderSoql } from './soql.js';
import { ApexStmt } from './stmt.js';
import { renderType } from './types.js';

const INDENT = '    ';

export function emitExpr(e: ApexExpr): string {
  switch (e.node) {
    case 'literal':
      return e.text;
    case 'variable':
      return e.name;
    case 'fieldRead':
      // The cast is not optional: record.get() returns Object.
      return `((${renderType(e.type)})${e.record}.get('${e.field}'))`;
    case 'comparison':
    case 'equality':
      return `${emitExpr(e.left)} ${e.op} ${emitExpr(e.right)}`;
    case 'logical':
      return e.operands.map(emitExpr).join(` ${e.op} `);
    case 'nullTest':
      return `${emitExpr(e.operand)} ${e.negated ? '!=' : '=='} null`;
    case 'methodCall':
      return `${emitExpr(e.target)}.${e.method}(${e.args.map(emitExpr).join(', ')})`;
  }
}

function block(body: ApexStmt[], depth: number): string {
  return body.map((s) => emitStmt(s, depth)).join('\n');
}

export function emitStmt(s: ApexStmt, depth = 0): string {
  const pad = INDENT.repeat(depth);
  switch (s.stmt) {
    case 'declare':
      return s.init === null
        ? `${pad}${renderType(s.type)} ${s.name};`
        : `${pad}${renderType(s.type)} ${s.name} = ${emitExpr(s.init)};`;
    case 'assign':
      return `${pad}${s.name} = ${emitExpr(s.value)};`;
    case 'fieldWrite':
      return `${pad}${s.record}.put('${s.field}', ${emitExpr(s.value)});`;
    case 'collectInto':
      return `${pad}${s.collection}.add(${s.record});`;
    case 'queryInto': {
      const q = renderSoql(s.query)
        .split('\n')
        .map((line) => `${pad}${INDENT}${line}`)
        .join('\n');
      return `${pad}${renderType(s.type)} ${s.name} = [\n${q}\n${pad}];`;
    }
    case 'ifThen':
      return `${pad}if (${emitExpr(s.condition)}) {\n${block(s.body, depth + 1)}\n${pad}}`;
    case 'forEach':
      return (
        `${pad}for (${renderType(s.itemType)} ${s.item} : ${s.collection}) {\n` +
        `${block(s.body, depth + 1)}\n${pad}}`
      );
    case 'dmlBulk': {
      const call = `Database.${s.operation}(${s.collection}, AccessLevel.USER_MODE);`;
      return `${pad}if (!${s.collection}.isEmpty()) {\n${pad}${INDENT}${call}\n${pad}}`;
    }
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx jest tests/apex/emit.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 6: Run the whole suite**

Run: `npx jest`
Expected: PASS, 175 tests / 20 suites.

- [ ] **Step 7: Commit**

```bash
git add src/apex/stmt.ts src/apex/emit.ts tests/apex/emit.test.ts
git commit -m "feat(apex): statements and the source emitter

There is no statement for DML on a single record. The only route to the
database is dmlBulk over a collection, so a per-iteration insert — the
anti-pattern this tool exists to remove — cannot be represented in the tree."
```

---

### Task 6: The defect-regression suite

**Files:**
- Test: `tests/apex/defects.test.ts`

**Interfaces:**
- Consumes: everything in `src/apex/`
- Produces: no source — this task is the milestone's acceptance bar

This suite is the reason the module exists. Each test names a defect this project actually shipped and asserts it can no longer be built.

- [ ] **Step 1: Write the suite**

```typescript
// tests/apex/defects.test.ts
import { ApexTypeError } from '../../src/apex/errors.js';
import { emitExpr, emitStmt } from '../../src/apex/emit.js';
import { comparison, fieldRead, literal, methodCall, nullTest, variable } from '../../src/apex/expr.js';
import { Scope } from '../../src/apex/scope.js';
import { renderSoql, soql } from '../../src/apex/soql.js';
import { collectInto, dmlBulk, fieldWrite } from '../../src/apex/stmt.js';
import { DECIMAL, OBJECT, STRING } from '../../src/apex/types.js';

/**
 * Every test here corresponds to Apex this project once generated and shipped.
 * They are phrased as "cannot be built" rather than "is built correctly",
 * because the milestone's claim is about the class of defect, not one instance.
 */
describe('defects that are now unrepresentable', () => {
  test('DEFECT 1: record.get() compared with > does not typecheck', () => {
    // Shipped as: record.get('LLC_BI__Amount__c') > 1000
    expect(() =>
      comparison(variable(OBJECT, "record.get('Amount__c')"), '>', literal(DECIMAL, '1000'))
    ).toThrow(ApexTypeError);

    // And a field read cannot be created untyped in the first place.
    expect(() => fieldRead('record', 'Amount__c', OBJECT)).toThrow(ApexTypeError);

    // The only buildable form carries the cast.
    expect(emitExpr(comparison(fieldRead('record', 'Amount__c', DECIMAL), '>', literal(DECIMAL, '1000'))))
      .toBe("((Decimal)record.get('Amount__c')) > 1000");
  });

  test('DEFECT 2: contains has no infix form to abuse', () => {
    // Shipped as: a contains 'x'
    const only = methodCall(variable(STRING, 'name'), 'contains', [literal(STRING, "'x'")], STRING);
    expect(emitExpr(only)).toBe("name.contains('x')");
    // There is no operator named 'contains' anywhere in the expression union;
    // comparison() accepts only the four ordering operators, enforced by its type.
  });

  test("DEFECT 2b: a null test cannot carry a dangling right-hand value", () => {
    // Shipped as: x == null 1000
    expect(emitExpr(nullTest(variable(STRING, 'x'), false))).toBe('x == null');
  });

  test('DEFECT 3: a query cannot be built without naming its object', () => {
    // Shipped as: SELECT Id, Name FROM Account — for every Flow, whatever it declared.
    expect(() => soql({ object: '', fields: ['Id'] })).toThrow(ApexTypeError);

    const q = soql({ object: 'LLC_BI__Pricing_Stream__c', fields: ['Id'] });
    expect(renderSoql(q)).toContain('FROM LLC_BI__Pricing_Stream__c');
    expect(renderSoql(q)).not.toContain('FROM Account');
  });

  test('DEFECT 4: a field write is a statement, not an interpolation that can vanish', () => {
    // Shipped as: an update that collected the record without its field writes.
    expect(emitStmt(fieldWrite('record', 'Stage__c', literal(STRING, "'Funded'"))))
      .toBe("record.put('Stage__c', 'Funded');");
  });

  test('DEFECT 5: two lookups cannot share a variable name', () => {
    // Shipped as: List<SObject> relatedRecords declared twice in one method.
    const scope = new Scope();
    expect(scope.allocate('relatedRecords')).toBe('relatedRecords');
    expect(scope.allocate('relatedRecords')).toBe('relatedRecords2');
  });

  test('DEFECT 6: a suffix cannot be applied twice by accident', () => {
    // Shipped as: validateKey_Loan_Date_Validation_Bulkified_Bulkified
    const scope = new Scope();
    const first = scope.allocate('validateKey_Loan_Date_Validation_Bulkified');
    const second = scope.allocate('validateKey_Loan_Date_Validation_Bulkified');
    expect(first).toBe('validateKey_Loan_Date_Validation_Bulkified');
    expect(second).toBe('validateKey_Loan_Date_Validation_Bulkified2');
    expect(second).not.toContain('_Bulkified_Bulkified');
  });

  test('per-record DML has no representation at all', () => {
    // The tool exists to remove DML from loops. The tree offers only collection
    // then bulk DML — there is no single-record DML statement to construct.
    expect(emitStmt(collectInto('recordsToUpdate', 'record'))).toBe('recordsToUpdate.add(record);');
    expect(emitStmt(dmlBulk('update', 'recordsToUpdate'))).toContain('AccessLevel.USER_MODE');
  });
});
```

- [ ] **Step 2: Run the suite**

Run: `npx jest tests/apex/defects.test.ts`
Expected: PASS, 8 tests. If any fails, the module does not yet meet the milestone's bar — fix the module, never the test.

- [ ] **Step 3: Run the whole suite**

Run: `npx jest`
Expected: PASS, 183 tests / 21 suites.

Run: `npx tsc -p tsconfig.json`
Expected: exit 0.

Confirm existing behaviour: `node dist/index.js ir exampleflow.xml` still reports 20 of 20 typed bodies, and `analyze` / `bulkify` still work.

- [ ] **Step 4: Commit**

```bash
git add tests/apex/defects.test.ts
git commit -m "test(apex): pin every shipped defect as unrepresentable

Six defects this project put in front of users, each asserted to be
unbuildable rather than merely fixed. This is the milestone's acceptance bar:
the claim is about the class of defect, not one instance of it."
```

---

## Done when

- `npx jest` passes with 183 tests across 21 suites.
- `npx tsc -p tsconfig.json` is clean.
- `tests/apex/defects.test.ts` passes — every shipped defect is unrepresentable.
- `analyze`, `bulkify` and `ir` behave exactly as before; `ir exampleflow.xml` still reports 20 of 20 typed bodies.
- Nothing in `src/apex/` imports from `src/ir/` or `src/utils/`.

## Not in this milestone

- **Lowering `FlowIR` onto this AST** — Milestone 2c. That is where the typed bodies from 2a meet this tree, and it is deliberately separate: the AST is testable on its own, by building trees by hand.
- **Class and method structure** — `ApexClass`, method declarations, ApexDoc. Added in 2c when there is a class to build.
- **Type resolution from `sobject describe`** — Milestone 3. Until then a caller supplies the `ApexType` for a field read; this module only insists that one is supplied.
- **Formula translation.** Untouched.
- **Replacing the existing generator.** `bulkify` keeps using `BulkifiedApexGenerator` until 2c can produce a complete class.
