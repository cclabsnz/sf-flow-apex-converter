# Typed Element Bodies Implementation Plan (Milestone 2a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every executable Flow element a typed body in the IR, so the Apex emitter reads a model instead of doing archaeology on untyped xml2js blobs.

**Architecture:** Extends the existing `src/ir/` module. A shared value/condition parser feeds one body parser per element family; `parseElements` attaches the typed body to `FlowNode.body`. `FlowNode.raw` stays for now as an escape hatch but stops being the only source of truth. Purely additive — nothing consumes bodies yet, and `analyze`/`bulkify`/`ir` keep working.

**Tech Stack:** TypeScript 5 (`strict: true`, CommonJS, ES2020 target), xml2js, Jest + ts-jest.

**Spec:** `docs/specs/2026-09-07-flow-to-apex-converter-design.md`

## Why this comes before the emitter

Milestone 1's final review found the graph layer sound and the statement layer absent: `FlowNode` is `name / kind / label / connectors / object` plus `raw: Record<string, unknown>`. An emitter reading `node.raw.assignmentitems` would be doing untyped xml2js archaeology at the exact moment it decides what Apex to write — the same "no model of the thing" hazard that produced the four defects this whole effort exists to remove, moved one stage upstream. Bodies get typed first.

## Global Constraints

- TypeScript `strict: true`. No `any` in exported signatures; `unknown` plus a narrowing guard instead.
- xml2js is configured `{ explicitArray: false, mergeAttrs: true, normalizeTags: true }`. **All tags arrive lowercased**, and a single occurrence is an object, not an array. Every parser must handle both shapes.
- **Nothing is dropped silently.** An element body the parser cannot model is recorded, never ignored. This is the guarantee Milestone 1's final review found broken twice; do not break it again.
- Existing behaviour is untouched: `analyze`, `bulkify` and `ir` must work exactly as before.
- Existing tests must keep passing: `npx jest` is 68 tests / 8 suites before this plan starts.
- Every count asserted against `exampleflow.xml` in this plan was verified against the file. If an assertion fails, count the file first (`grep -c '<assignmentItems>' exampleflow.xml`) and find out which side is wrong — never weaken the assertion to match the code.

## File Structure

| File | Responsibility |
|---|---|
| `src/ir/parseValue.ts` | `FlowValue` reading and condition parsing, shared by every body parser |
| `src/ir/bodies/recordBody.ts` | recordLookups / recordCreates / recordUpdates / recordDeletes |
| `src/ir/bodies/decisionBody.ts` | decisions — rules and their conditions |
| `src/ir/bodies/assignmentBody.ts` | assignments — assignmentItems |
| `src/ir/bodies/flowControlBody.ts` | loops, subflows, actionCalls |
| `src/ir/bodies/index.ts` | dispatch: element kind → body parser |
| `tests/ir/bodies/*.test.ts` | one suite per body parser |

---

### Task 1: Shared value and condition parsing

**Files:**
- Create: `src/ir/parseValue.ts`
- Modify: `src/ir/parseDeclarations.ts` (import the shared reader instead of its private copy)
- Modify: `src/ir/types.ts` (add `FlowConditionIR`)
- Test: `tests/ir/parseValue.test.ts`

**Interfaces:**
- Consumes: `FlowValue` from `src/ir/types.ts`
- Produces: `readValue(container: unknown): FlowValue`, `toArray(value: unknown): Record<string, unknown>[]`, `parseCondition(raw: Record<string, unknown>): FlowConditionIR`, and the type `FlowConditionIR`

`readValue` and `toArray` currently live privately inside `parseDeclarations.ts`. Every body parser needs both. Move them; do not copy them.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/ir/parseValue.test.ts
import { parseCondition, readValue, toArray } from '../../src/ir/parseValue.js';

describe('toArray', () => {
  it('wraps a single xml2js object', () => {
    expect(toArray({ a: 1 })).toEqual([{ a: 1 }]);
  });
  it('passes an array through', () => {
    expect(toArray([{ a: 1 }, { a: 2 }])).toHaveLength(2);
  });
  it('treats absent as empty', () => {
    expect(toArray(undefined)).toEqual([]);
    expect(toArray(null)).toEqual([]);
  });
});

describe('readValue', () => {
  it('reads each literal variant', () => {
    expect(readValue({ stringvalue: 'x' })).toEqual({ kind: 'string', raw: 'x' });
    expect(readValue({ numbervalue: 3 })).toEqual({ kind: 'number', raw: '3' });
    expect(readValue({ booleanvalue: 'false' })).toEqual({ kind: 'boolean', raw: 'false' });
  });
  it('reads an element reference', () => {
    expect(readValue({ elementreference: 'Loop_over_Loans.Amount__c' }))
      .toEqual({ kind: 'reference', raw: 'Loop_over_Loans.Amount__c' });
  });
  it('returns kind none for an absent container', () => {
    expect(readValue(undefined)).toEqual({ kind: 'none' });
  });
});

describe('parseCondition', () => {
  it('reads a Flow condition into left/operator/right', () => {
    // Real shape from exampleflow.xml.
    const c = parseCondition({
      leftvaluereference: 'BS20ErrorMessages',
      operator: 'IsNull',
      rightvalue: { booleanvalue: 'false' },
    });
    expect(c.left).toBe('BS20ErrorMessages');
    expect(c.operator).toBe('IsNull');
    expect(c.right).toEqual({ kind: 'boolean', raw: 'false' });
  });

  it('defaults a missing operator rather than inventing one', () => {
    const c = parseCondition({ leftvaluereference: 'X' });
    expect(c.operator).toBe('');
    expect(c.right).toEqual({ kind: 'none' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/ir/parseValue.test.ts`
Expected: FAIL — "Cannot find module '../../src/ir/parseValue.js'".

- [ ] **Step 3: Add the condition type to `src/ir/types.ts`**

Add this interface (place it directly after `FlowValue`):

```typescript
/** One Flow condition, as written — no Apex typing decision is made here. */
export interface FlowConditionIR {
  /** Left-hand reference, e.g. 'Loop_over_Loans.LLC_BI__Amount__c'. */
  left: string;
  /** Flow operator verbatim, e.g. 'EqualTo', 'IsNull', 'GreaterThan'. */
  operator: string;
  right: FlowValue;
}
```

- [ ] **Step 4: Create `src/ir/parseValue.ts`**

```typescript
// src/ir/parseValue.ts
import { FlowConditionIR, FlowValue } from './types.js';

/** xml2js gives one object for a single occurrence and an array for many. */
export function toArray(value: unknown): Record<string, unknown>[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]) as Record<string, unknown>[];
}

/**
 * Read a Flow value container. Every variant Flow can express is handled; an
 * unrecognised container yields kind 'none' rather than a guess.
 */
export function readValue(container: unknown): FlowValue {
  if (!container || typeof container !== 'object') return { kind: 'none' };
  const c = container as Record<string, unknown>;
  if (c.stringvalue !== undefined) return { kind: 'string', raw: String(c.stringvalue) };
  if (c.numbervalue !== undefined) return { kind: 'number', raw: String(c.numbervalue) };
  if (c.booleanvalue !== undefined) return { kind: 'boolean', raw: String(c.booleanvalue) };
  if (c.datevalue !== undefined) return { kind: 'date', raw: String(c.datevalue) };
  if (c.datetimevalue !== undefined) return { kind: 'datetime', raw: String(c.datetimevalue) };
  if (c.elementreference !== undefined) return { kind: 'reference', raw: String(c.elementreference) };
  if (c.apexvalue !== undefined) return { kind: 'apex', raw: String(c.apexvalue) };
  if (c.sobjectvalue !== undefined) return { kind: 'sobject', raw: String(c.sobjectvalue) };
  if (c.formulaexpression !== undefined) return { kind: 'formula', raw: String(c.formulaexpression) };
  if (c.setupreference !== undefined) return { kind: 'setupReference', raw: String(c.setupreference) };
  return { kind: 'none' };
}

/**
 * A Flow condition. Both `leftValueReference` (decisions) and `field` (record filters)
 * name the left-hand side, so both are accepted.
 */
export function parseCondition(raw: Record<string, unknown>): FlowConditionIR {
  const left = raw.leftvaluereference ?? raw.field;
  return {
    left: left === undefined ? '' : String(left),
    operator: raw.operator === undefined ? '' : String(raw.operator),
    right: readValue(raw.rightvalue ?? raw.value),
  };
}
```

- [ ] **Step 5: Point `parseDeclarations.ts` at the shared helpers**

In `src/ir/parseDeclarations.ts`, delete its private `toArray` and `readValue` definitions and import them instead:

```typescript
import { readValue, toArray } from './parseValue.js';
```

Leave its private `toBool` where it is — no other module needs it yet.

- [ ] **Step 6: Run the tests**

Run: `npx jest`
Expected: PASS. `tests/ir/parseValue.test.ts` adds 8 tests, and every existing declaration test still passes — proving the move changed no behaviour. 76 tests / 9 suites.

- [ ] **Step 7: Commit**

```bash
git add src/ir/parseValue.ts src/ir/types.ts src/ir/parseDeclarations.ts tests/ir/parseValue.test.ts
git commit -m "feat(ir): share value and condition parsing across body parsers

readValue and toArray were private to parseDeclarations; every element body
parser needs both. Moved rather than copied, so there is one definition of what
a Flow value is. parseCondition accepts leftValueReference and field, because
decisions name the left side one way and record filters the other."
```

---

### Task 2: Record element bodies

**Files:**
- Create: `src/ir/bodies/recordBody.ts`
- Modify: `src/ir/types.ts` (add `RecordBody`)
- Test: `tests/ir/bodies/recordBody.test.ts`

**Interfaces:**
- Consumes: `readValue`, `toArray`, `parseCondition` from `src/ir/parseValue.js`; `FlowConditionIR` from `src/ir/types.js`
- Produces: `parseRecordBody(raw: Record<string, unknown>): RecordBody`, and the type `RecordBody`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/ir/bodies/recordBody.test.ts
import { parseRecordBody } from '../../../src/ir/bodies/recordBody.js';

describe('parseRecordBody', () => {
  // Shape taken from exampleflow.xml's Get_Pricing_Streams_for_Loans lookup.
  const lookup = {
    name: 'Get_Pricing_Streams_for_Loans',
    object: 'LLC_BI__Pricing_Stream__c',
    filterlogic: 'and',
    filters: {
      field: 'LLC_BI__Loan__c',
      operator: 'In',
      value: { elementreference: 'Get_Loan_IDs_from_input_records' },
    },
    getfirstrecordonly: 'false',
    storeoutputautomatically: 'true',
  };

  it('reads the object the Flow declares', () => {
    expect(parseRecordBody(lookup).object).toBe('LLC_BI__Pricing_Stream__c');
  });

  it('reads a single filter, which xml2js does not wrap in an array', () => {
    const filters = parseRecordBody(lookup).filters;
    expect(filters).toHaveLength(1);
    expect(filters[0].left).toBe('LLC_BI__Loan__c');
    expect(filters[0].operator).toBe('In');
    expect(filters[0].right).toEqual({
      kind: 'reference', raw: 'Get_Loan_IDs_from_input_records',
    });
  });

  it('reads multiple filters', () => {
    const body = parseRecordBody({
      ...lookup,
      filters: [
        { field: 'A__c', operator: 'EqualTo', value: { stringvalue: 'x' } },
        { field: 'B__c', operator: 'GreaterThan', value: { numbervalue: 5 } },
      ],
    });
    expect(body.filters.map((f) => f.left)).toEqual(['A__c', 'B__c']);
  });

  it('reads the filter logic and the cardinality flags', () => {
    const body = parseRecordBody(lookup);
    expect(body.filterLogic).toBe('and');
    expect(body.getFirstRecordOnly).toBe(false);
    expect(body.storeOutputAutomatically).toBe(true);
  });

  it('reads the fields a create or update assigns', () => {
    const body = parseRecordBody({
      object: 'Account',
      inputassignments: [
        { field: 'Name', value: { stringvalue: 'Acme' } },
        { field: 'Rating', value: { elementreference: 'Var_Rating' } },
      ],
    });
    expect(body.inputAssignments).toEqual([
      { field: 'Name', value: { kind: 'string', raw: 'Acme' } },
      { field: 'Rating', value: { kind: 'reference', raw: 'Var_Rating' } },
    ]);
  });

  it('yields empty collections rather than undefined for an element with no filters', () => {
    const body = parseRecordBody({ object: 'Account' });
    expect(body.filters).toEqual([]);
    expect(body.inputAssignments).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/ir/bodies/recordBody.test.ts`
Expected: FAIL — "Cannot find module '../../../src/ir/bodies/recordBody.js'".

- [ ] **Step 3: Add the type to `src/ir/types.ts`**

```typescript
/** A field write on a record create or update. */
export interface FlowFieldAssignment {
  field: string;
  value: FlowValue;
}

/** Body of recordLookups / recordCreates / recordUpdates / recordDeletes. */
export interface RecordBody {
  kind: 'record';
  object?: string;
  filterLogic?: string;
  filters: FlowConditionIR[];
  inputAssignments: FlowFieldAssignment[];
  /** Fields the lookup asks for. Empty means the Flow did not restrict them. */
  queriedFields: string[];
  getFirstRecordOnly: boolean;
  storeOutputAutomatically: boolean;
}
```

- [ ] **Step 4: Create `src/ir/bodies/recordBody.ts`**

```typescript
// src/ir/bodies/recordBody.ts
import { parseCondition, readValue, toArray } from '../parseValue.js';
import { FlowFieldAssignment, RecordBody } from '../types.js';

function toBool(value: unknown): boolean {
  return String(value) === 'true';
}

/**
 * The body of a record element: which object, which filters, which field writes.
 *
 * This is the source the emitter uses to build a SOQL WHERE clause and the field
 * writes preceding a DML collection add. Guessing any of it — as the 2.0.x generator
 * did when it hardcoded `FROM Account` — produces Apex that compiles and reads the
 * wrong table.
 */
export function parseRecordBody(raw: Record<string, unknown>): RecordBody {
  const inputAssignments: FlowFieldAssignment[] = toArray(raw.inputassignments).map((a) => ({
    field: String(a.field ?? ''),
    value: readValue(a.value),
  }));

  return {
    kind: 'record',
    object: raw.object === undefined ? undefined : String(raw.object),
    filterLogic: raw.filterlogic === undefined ? undefined : String(raw.filterlogic),
    filters: toArray(raw.filters).map(parseCondition),
    inputAssignments,
    queriedFields: toArray(raw.queriedfields).map((f) => String(f)).filter(Boolean),
    getFirstRecordOnly: toBool(raw.getfirstrecordonly),
    storeOutputAutomatically: toBool(raw.storeoutputautomatically),
  };
}
```

Note on `queriedFields`: xml2js yields a bare string (or array of strings) for repeated
`<queriedFields>` text nodes, so `toArray` receives strings rather than objects. The
`.map(String)` handles both, and `.filter(Boolean)` drops the empty-tag case.

- [ ] **Step 5: Run the tests**

Run: `npx jest tests/ir/bodies/recordBody.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Run the whole suite**

Run: `npx jest`
Expected: PASS, 82 tests / 10 suites.

- [ ] **Step 7: Commit**

```bash
git add src/ir/bodies/recordBody.ts src/ir/types.ts tests/ir/bodies/recordBody.test.ts
git commit -m "feat(ir): type record element bodies

Object, filters, filter logic, field writes and queried fields, read from the
Flow rather than assumed. This is the data whose absence let 2.0.x emit
SELECT Id, Name FROM Account for a Flow that declared
LLC_BI__Pricing_Stream__c."
```

---

### Task 3: Decision bodies

**Files:**
- Create: `src/ir/bodies/decisionBody.ts`
- Modify: `src/ir/types.ts` (add `DecisionBody`, `FlowRule`)
- Test: `tests/ir/bodies/decisionBody.test.ts`

**Interfaces:**
- Consumes: `parseCondition`, `toArray` from `src/ir/parseValue.js`
- Produces: `parseDecisionBody(raw: Record<string, unknown>): DecisionBody`, and types `DecisionBody`, `FlowRule`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/ir/bodies/decisionBody.test.ts
import { parseDecisionBody } from '../../../src/ir/bodies/decisionBody.js';

describe('parseDecisionBody', () => {
  // Shape taken from exampleflow.xml.
  const decision = {
    name: 'Check_BS20',
    defaultconnector: { targetreference: 'Continue' },
    defaultconnectorlabel: 'No',
    rules: {
      name: 'Yes_BS20_Exception',
      conditionlogic: 'and',
      conditions: [
        { leftvaluereference: 'BS20ErrorMessages', operator: 'IsNull', rightvalue: { booleanvalue: 'false' } },
        { leftvaluereference: 'Loop_over_Loans.Amount__c', operator: 'GreaterThan', rightvalue: { numbervalue: 1000 } },
      ],
      connector: { targetreference: 'Flag_Exception' },
      label: 'Yes',
    },
  };

  it('reads a single rule, which xml2js does not wrap in an array', () => {
    expect(parseDecisionBody(decision).rules).toHaveLength(1);
  });

  it('reads the rule name, label, logic and branch target', () => {
    const rule = parseDecisionBody(decision).rules[0];
    expect(rule.name).toBe('Yes_BS20_Exception');
    expect(rule.label).toBe('Yes');
    expect(rule.conditionLogic).toBe('and');
    expect(rule.target).toBe('Flag_Exception');
  });

  it('reads every condition of a rule', () => {
    const rule = parseDecisionBody(decision).rules[0];
    expect(rule.conditions).toHaveLength(2);
    expect(rule.conditions[1].left).toBe('Loop_over_Loans.Amount__c');
    expect(rule.conditions[1].operator).toBe('GreaterThan');
    expect(rule.conditions[1].right).toEqual({ kind: 'number', raw: '1000' });
  });

  it('reads the default branch', () => {
    const body = parseDecisionBody(decision);
    expect(body.defaultTarget).toBe('Continue');
    expect(body.defaultLabel).toBe('No');
  });

  it('yields an empty rule list for a decision with none', () => {
    expect(parseDecisionBody({ name: 'D' }).rules).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/ir/bodies/decisionBody.test.ts`
Expected: FAIL — "Cannot find module '../../../src/ir/bodies/decisionBody.js'".

- [ ] **Step 3: Add the types to `src/ir/types.ts`**

```typescript
/** One branch of a decision. */
export interface FlowRule {
  name: string;
  label?: string;
  /** 'and' | 'or' | a custom expression such as '1 AND (2 OR 3)'. */
  conditionLogic: string;
  conditions: FlowConditionIR[];
  /** Element this branch connects to when its conditions hold. */
  target?: string;
}

export interface DecisionBody {
  kind: 'decision';
  rules: FlowRule[];
  defaultTarget?: string;
  defaultLabel?: string;
}
```

- [ ] **Step 4: Create `src/ir/bodies/decisionBody.ts`**

```typescript
// src/ir/bodies/decisionBody.ts
import { parseCondition, toArray } from '../parseValue.js';
import { DecisionBody, FlowRule } from '../types.js';

function targetOf(connector: unknown): string | undefined {
  const c = connector as Record<string, unknown> | undefined;
  if (!c || c.targetreference === undefined) return undefined;
  return String(c.targetreference);
}

/**
 * The body of a decision: its branches, each with its conditions and where it goes.
 *
 * `conditionLogic` is kept verbatim rather than normalised to and/or, because Flow
 * permits custom expressions like '1 AND (2 OR 3)' that index the conditions by
 * position. Collapsing that to a boolean operator loses the expression.
 */
export function parseDecisionBody(raw: Record<string, unknown>): DecisionBody {
  const rules: FlowRule[] = toArray(raw.rules).map((r) => ({
    name: String(r.name ?? ''),
    label: r.label === undefined ? undefined : String(r.label),
    conditionLogic: String(r.conditionlogic ?? 'and'),
    conditions: toArray(r.conditions).map(parseCondition),
    target: targetOf(r.connector),
  }));

  return {
    kind: 'decision',
    rules,
    defaultTarget: targetOf(raw.defaultconnector),
    defaultLabel: raw.defaultconnectorlabel === undefined ? undefined : String(raw.defaultconnectorlabel),
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx jest tests/ir/bodies/decisionBody.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/ir/bodies/decisionBody.ts src/ir/types.ts tests/ir/bodies/decisionBody.test.ts
git commit -m "feat(ir): type decision bodies

Rules, their conditions, and each branch target. conditionLogic is kept
verbatim: Flow allows custom expressions like '1 AND (2 OR 3)' that index
conditions by position, and normalising it to a boolean operator loses that."
```

---

### Task 4: Assignment bodies

**Files:**
- Create: `src/ir/bodies/assignmentBody.ts`
- Modify: `src/ir/types.ts` (add `AssignmentBody`, `FlowAssignmentItem`)
- Test: `tests/ir/bodies/assignmentBody.test.ts`

**Interfaces:**
- Consumes: `readValue`, `toArray` from `src/ir/parseValue.js`
- Produces: `parseAssignmentBody(raw: Record<string, unknown>): AssignmentBody`, and types `AssignmentBody`, `FlowAssignmentItem`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/ir/bodies/assignmentBody.test.ts
import { parseAssignmentBody } from '../../../src/ir/bodies/assignmentBody.js';

describe('parseAssignmentBody', () => {
  it('reads a single assignment item, which xml2js does not wrap', () => {
    // Real shape from exampleflow.xml.
    const body = parseAssignmentBody({
      name: 'Set_Error',
      assignmentitems: {
        assigntoreference: 'ValidationMessage.Message',
        operator: 'Assign',
        value: { elementreference: 'AmountForCommissionCalculationNotEnteredError' },
      },
    });
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toEqual({
      target: 'ValidationMessage.Message',
      operator: 'Assign',
      value: { kind: 'reference', raw: 'AmountForCommissionCalculationNotEnteredError' },
    });
  });

  it('reads every item of a multi-item assignment', () => {
    const body = parseAssignmentBody({
      assignmentitems: [
        { assigntoreference: 'Total', operator: 'Add', value: { numbervalue: 1 } },
        { assigntoreference: 'Names', operator: 'AddItem', value: { elementreference: 'Loop.Name' } },
      ],
    });
    expect(body.items.map((i) => i.operator)).toEqual(['Add', 'AddItem']);
    expect(body.items[1].value).toEqual({ kind: 'reference', raw: 'Loop.Name' });
  });

  it('keeps the Flow operator verbatim rather than mapping it to Apex', () => {
    // Translation is the emitter's job and needs type information this layer
    // does not have. Mapping here would bake in a guess.
    const body = parseAssignmentBody({
      assignmentitems: { assigntoreference: 'X', operator: 'RemoveAfterFirst', value: { stringvalue: 'a' } },
    });
    expect(body.items[0].operator).toBe('RemoveAfterFirst');
  });

  it('yields an empty item list for an assignment with none', () => {
    expect(parseAssignmentBody({ name: 'A' }).items).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/ir/bodies/assignmentBody.test.ts`
Expected: FAIL — "Cannot find module '../../../src/ir/bodies/assignmentBody.js'".

- [ ] **Step 3: Add the types to `src/ir/types.ts`**

```typescript
/** One write performed by an assignment element. */
export interface FlowAssignmentItem {
  /** Variable or field the value is written to. */
  target: string;
  /** Flow operator verbatim — 'Assign', 'Add', 'AddItem', 'RemoveAfterFirst', … */
  operator: string;
  value: FlowValue;
}

export interface AssignmentBody {
  kind: 'assignment';
  items: FlowAssignmentItem[];
}
```

- [ ] **Step 4: Create `src/ir/bodies/assignmentBody.ts`**

```typescript
// src/ir/bodies/assignmentBody.ts
import { readValue, toArray } from '../parseValue.js';
import { AssignmentBody, FlowAssignmentItem } from '../types.js';

/**
 * The body of an assignment: what it writes, with which operator, to where.
 *
 * Operators are kept as Flow spells them. Translating 'Add' to '+=' or '.add()'
 * depends on whether the target is a collection, which needs field type information
 * this layer does not have — deciding it here would bake in exactly the kind of
 * guess the emitter exists to avoid.
 */
export function parseAssignmentBody(raw: Record<string, unknown>): AssignmentBody {
  const items: FlowAssignmentItem[] = toArray(raw.assignmentitems).map((i) => ({
    target: String(i.assigntoreference ?? ''),
    operator: String(i.operator ?? ''),
    value: readValue(i.value),
  }));

  return { kind: 'assignment', items };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx jest tests/ir/bodies/assignmentBody.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/ir/bodies/assignmentBody.ts src/ir/types.ts tests/ir/bodies/assignmentBody.test.ts
git commit -m "feat(ir): type assignment bodies

Target, operator and value per item. Operators stay as Flow spells them:
mapping 'Add' to '+=' or '.add()' depends on whether the target is a
collection, which this layer cannot know."
```

---

### Task 5: Loop, subflow and action bodies

**Files:**
- Create: `src/ir/bodies/flowControlBody.ts`
- Modify: `src/ir/types.ts` (add `LoopBody`, `SubflowBody`, `ActionBody`, `FlowParameterBinding`)
- Test: `tests/ir/bodies/flowControlBody.test.ts`

**Interfaces:**
- Consumes: `readValue`, `toArray` from `src/ir/parseValue.js`
- Produces: `parseLoopBody`, `parseSubflowBody`, `parseActionBody`, each `(raw: Record<string, unknown>) => …Body`, and the four types

- [ ] **Step 1: Write the failing test**

```typescript
// tests/ir/bodies/flowControlBody.test.ts
import {
  parseActionBody, parseLoopBody, parseSubflowBody,
} from '../../../src/ir/bodies/flowControlBody.js';

describe('parseLoopBody', () => {
  it('reads the collection it iterates and the order', () => {
    // Real shape from exampleflow.xml.
    const body = parseLoopBody({
      name: 'Loop_over_Loans',
      collectionreference: 'Get_Loan_IDs_from_input_records',
      iterationorder: 'Asc',
      nextvalueconnector: { targetreference: 'Validate' },
    });
    expect(body.collection).toBe('Get_Loan_IDs_from_input_records');
    expect(body.iterationOrder).toBe('Asc');
    expect(body.bodyTarget).toBe('Validate');
  });

  it('reads the after-loop target when present', () => {
    const body = parseLoopBody({
      collectionreference: 'C',
      nomorevaluesconnector: { targetreference: 'After_Loop' },
    });
    expect(body.afterTarget).toBe('After_Loop');
  });
});

describe('parseSubflowBody', () => {
  // Real shape from exampleflow.xml.
  const subflow = {
    name: 'Validate_Key_Loan_Dates',
    flowname: 'Key_Loan_Date_Validation',
    inputassignments: [
      { name: 'LoanId', value: { elementreference: 'Loop_over_Loans.Id' } },
      { name: 'SettlementDate', value: { elementreference: 'Loop_over_Loans.LLC_BI__CloseDate__c' } },
    ],
    outputassignments: { name: 'ValidationMessage', assigntoreference: 'BS20ErrorMessages' },
  };

  it('reads the referenced flow name', () => {
    expect(parseSubflowBody(subflow).flowName).toBe('Key_Loan_Date_Validation');
  });

  it('reads every input binding', () => {
    const inputs = parseSubflowBody(subflow).inputs;
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toEqual({
      name: 'LoanId', value: { kind: 'reference', raw: 'Loop_over_Loans.Id' }, target: undefined,
    });
  });

  it('reads an output binding and where it lands', () => {
    const outputs = parseSubflowBody(subflow).outputs;
    expect(outputs).toHaveLength(1);
    expect(outputs[0].name).toBe('ValidationMessage');
    expect(outputs[0].target).toBe('BS20ErrorMessages');
  });
});

describe('parseActionBody', () => {
  it('reads the action name and type', () => {
    // Real shape from exampleflow.xml.
    const body = parseActionBody({
      name: 'Get_Loan_IDs_from_input_records',
      actionname: 'GetIdsFromRecords',
      actiontype: 'apex',
      inputparameters: { name: 'inputList', value: { elementreference: 'Loans' } },
    });
    expect(body.actionName).toBe('GetIdsFromRecords');
    expect(body.actionType).toBe('apex');
    expect(body.inputs).toHaveLength(1);
    expect(body.inputs[0].name).toBe('inputList');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/ir/bodies/flowControlBody.test.ts`
Expected: FAIL — "Cannot find module '../../../src/ir/bodies/flowControlBody.js'".

- [ ] **Step 3: Add the types to `src/ir/types.ts`**

```typescript
/** An input or output binding on a subflow or action call. */
export interface FlowParameterBinding {
  name: string;
  /** Value passed in. `kind: 'none'` for an output binding. */
  value: FlowValue;
  /** Where an output binding's result is stored. Undefined for inputs. */
  target?: string;
}

export interface LoopBody {
  kind: 'loop';
  /** Collection the loop iterates. */
  collection: string;
  iterationOrder?: string;
  /** First element of the loop body. */
  bodyTarget?: string;
  /** Element reached when the collection is exhausted. */
  afterTarget?: string;
}

export interface SubflowBody {
  kind: 'subflow';
  flowName: string;
  inputs: FlowParameterBinding[];
  outputs: FlowParameterBinding[];
}

export interface ActionBody {
  kind: 'action';
  actionName: string;
  actionType: string;
  inputs: FlowParameterBinding[];
  outputs: FlowParameterBinding[];
}
```

- [ ] **Step 4: Create `src/ir/bodies/flowControlBody.ts`**

```typescript
// src/ir/bodies/flowControlBody.ts
import { readValue, toArray } from '../parseValue.js';
import { ActionBody, FlowParameterBinding, LoopBody, SubflowBody } from '../types.js';

function targetOf(connector: unknown): string | undefined {
  const c = connector as Record<string, unknown> | undefined;
  if (!c || c.targetreference === undefined) return undefined;
  return String(c.targetreference);
}

function bindings(raw: unknown): FlowParameterBinding[] {
  return toArray(raw).map((p) => ({
    name: String(p.name ?? ''),
    value: readValue(p.value),
    target: p.assigntoreference === undefined ? undefined : String(p.assigntoreference),
  }));
}

/**
 * The body of a loop. `collection` is the whole point: it names what the loop walks,
 * which is what the bulkification transform hoists queries against.
 */
export function parseLoopBody(raw: Record<string, unknown>): LoopBody {
  return {
    kind: 'loop',
    collection: String(raw.collectionreference ?? ''),
    iterationOrder: raw.iterationorder === undefined ? undefined : String(raw.iterationorder),
    bodyTarget: targetOf(raw.nextvalueconnector),
    afterTarget: targetOf(raw.nomorevaluesconnector),
  };
}

/** The body of a subflow call: which Flow, and how its parameters are bound. */
export function parseSubflowBody(raw: Record<string, unknown>): SubflowBody {
  return {
    kind: 'subflow',
    flowName: String(raw.flowname ?? ''),
    inputs: bindings(raw.inputassignments),
    outputs: bindings(raw.outputassignments),
  };
}

/** The body of an action call: which action, of which type, and its parameters. */
export function parseActionBody(raw: Record<string, unknown>): ActionBody {
  return {
    kind: 'action',
    actionName: String(raw.actionname ?? ''),
    actionType: String(raw.actiontype ?? ''),
    inputs: bindings(raw.inputparameters),
    outputs: bindings(raw.outputparameters),
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx jest tests/ir/bodies/flowControlBody.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add src/ir/bodies/flowControlBody.ts src/ir/types.ts tests/ir/bodies/flowControlBody.test.ts
git commit -m "feat(ir): type loop, subflow and action bodies

The loop's collection reference is what the bulkification transform hoists
queries against; the subflow's parameter bindings are what let a per-iteration
call become a collection-taking method."
```

---

### Task 6: Attach bodies to nodes and report body coverage

**Files:**
- Create: `src/ir/bodies/index.ts`
- Modify: `src/ir/types.ts` (add `FlowBody` union, `body?` on `FlowNode`)
- Modify: `src/ir/parseElements.ts` (attach the body)
- Modify: `src/ir/coverage.ts` (report typed-body coverage)
- Modify: `src/index.ts` (show it in the `ir` command)
- Test: `tests/ir/bodies/index.test.ts`, and update `tests/ir/coverage.test.ts`

**Interfaces:**
- Consumes: every `parse*Body` from Tasks 2-5
- Produces: `parseBody(kind: string, raw: Record<string, unknown>): FlowBody | undefined`, the `FlowBody` union type, `FlowNode.body`, and `CoverageSummary.typedBodies`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/ir/bodies/index.test.ts
import * as path from 'path';
import { parseBody } from '../../../src/ir/bodies/index.js';
import { parseFlowFile } from '../../../src/ir/parseFlow.js';

const EXAMPLE_FLOW = path.join(__dirname, '..', '..', '..', 'exampleflow.xml');

describe('parseBody', () => {
  it('dispatches each element kind to its parser', () => {
    expect(parseBody('recordlookups', { object: 'Account' })?.kind).toBe('record');
    expect(parseBody('decisions', {})?.kind).toBe('decision');
    expect(parseBody('assignments', {})?.kind).toBe('assignment');
    expect(parseBody('loops', { collectionreference: 'C' })?.kind).toBe('loop');
    expect(parseBody('subflows', { flowname: 'F' })?.kind).toBe('subflow');
    expect(parseBody('actioncalls', { actionname: 'A' })?.kind).toBe('action');
  });

  it('returns undefined for a kind with no body parser', () => {
    // collectionprocessors is modelled as a node but has no typed body yet.
    expect(parseBody('collectionprocessors', {})).toBeUndefined();
  });
});

describe('bodies attached to the example Flow', () => {
  it('types every node whose kind has a parser', async () => {
    const ir = await parseFlowFile(EXAMPLE_FLOW);
    // 20 modelled elements; only collectionprocessors (1) has no body parser.
    const typed = ir.nodes.filter((n) => n.body !== undefined);
    expect(typed).toHaveLength(19);
  });

  it('reads the real lookup object through the typed body', async () => {
    const ir = await parseFlowFile(EXAMPLE_FLOW);
    const lookup = ir.nodes.find((n) => n.kind === 'recordlookups')!;
    expect(lookup.body).toBeDefined();
    expect(lookup.body!.kind).toBe('record');
    if (lookup.body!.kind === 'record') {
      expect(lookup.body!.object).toBe('LLC_BI__Pricing_Stream__c');
    }
  });

  it('reads all 13 assignment items across the Flow', async () => {
    const ir = await parseFlowFile(EXAMPLE_FLOW);
    const total = ir.nodes
      .filter((n) => n.body?.kind === 'assignment')
      .reduce((sum, n) => sum + (n.body!.kind === 'assignment' ? n.body!.items.length : 0), 0);
    expect(total).toBe(13);
  });

  it('reads all 21 subflow input bindings across the Flow', async () => {
    const ir = await parseFlowFile(EXAMPLE_FLOW);
    const total = ir.nodes
      .filter((n) => n.body?.kind === 'subflow')
      .reduce((sum, n) => sum + (n.body!.kind === 'subflow' ? n.body!.inputs.length : 0), 0);
    expect(total).toBe(21);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/ir/bodies/index.test.ts`
Expected: FAIL — "Cannot find module '../../../src/ir/bodies/index.js'".

- [ ] **Step 3: Add the union and the node field to `src/ir/types.ts`**

```typescript
/** Typed body of an executable element. Absent when its kind has no parser yet. */
export type FlowBody =
  | RecordBody
  | DecisionBody
  | AssignmentBody
  | LoopBody
  | SubflowBody
  | ActionBody;
```

Then add to `FlowNode`, directly after `object`:

```typescript
  /** Typed body. Undefined means this element kind has no body parser yet — read `raw`. */
  body?: FlowBody;
```

- [ ] **Step 4: Create `src/ir/bodies/index.ts`**

```typescript
// src/ir/bodies/index.ts
import { FlowBody } from '../types.js';
import { parseAssignmentBody } from './assignmentBody.js';
import { parseDecisionBody } from './decisionBody.js';
import { parseActionBody, parseLoopBody, parseSubflowBody } from './flowControlBody.js';
import { parseRecordBody } from './recordBody.js';

/**
 * Element kind to typed body.
 *
 * A kind with no entry returns undefined rather than an empty body, so a caller can
 * tell "this element has no typed body yet" from "this element's body is empty".
 * Conflating the two is how a consumer ends up silently treating unparsed structure
 * as absent structure.
 */
export function parseBody(kind: string, raw: Record<string, unknown>): FlowBody | undefined {
  switch (kind) {
    case 'recordlookups':
    case 'recordcreates':
    case 'recordupdates':
    case 'recorddeletes':
      return parseRecordBody(raw);
    case 'decisions':
      return parseDecisionBody(raw);
    case 'assignments':
      return parseAssignmentBody(raw);
    case 'loops':
      return parseLoopBody(raw);
    case 'subflows':
      return parseSubflowBody(raw);
    case 'actioncalls':
      return parseActionBody(raw);
    default:
      return undefined;
  }
}
```

- [ ] **Step 5: Attach the body in `src/ir/parseElements.ts`**

Add the import at the top:

```typescript
import { parseBody } from './bodies/index.js';
```

Then, in the object literal pushed to `nodes`, add `body` directly after `object`:

```typescript
        body: parseBody(key, raw),
```

- [ ] **Step 6: Report body coverage in `src/ir/coverage.ts`**

Add `typedBodies: number;` to `CoverageSummary`, and populate it in `summariseCoverage`:

```typescript
    typedBodies: ir.nodes.filter((n) => n.body !== undefined).length,
```

- [ ] **Step 7: Show it in the `ir` command**

In `src/index.ts`, in the `ir` command's human-readable output, add this line directly after the "Elements understood" line:

```typescript
    console.log(`  Typed bodies:         ${summary.typedBodies} of ${summary.nodeCount}`);
```

- [ ] **Step 8: Update the coverage test**

In `tests/ir/coverage.test.ts`, the fixture `ir` has one node with no `body`. Add an assertion to the "counts what the IR captured" test:

```typescript
    expect(s.typedBodies).toBe(0);
```

- [ ] **Step 9: Run everything**

Run: `npx jest`
Expected: PASS, 103 tests / 14 suites.

Run: `npx tsc -p tsconfig.json && node dist/index.js ir exampleflow.xml`
Expected:
```
  Elements understood:  20
  Typed bodies:         19 of 20
  Declarations read:    16
  Nothing unsupported.
```

Confirm existing behaviour: `node dist/index.js analyze exampleflow.xml` and
`node dist/index.js bulkify exampleflow.xml --output /tmp/bodies` both still work.

- [ ] **Step 10: Commit**

```bash
git add src/ir/bodies/index.ts src/ir/types.ts src/ir/parseElements.ts src/ir/coverage.ts src/index.ts tests/ir/bodies/index.test.ts tests/ir/coverage.test.ts
git commit -m "feat(ir): attach typed bodies to nodes and report body coverage

Nineteen of the example Flow's twenty elements now carry a typed body;
collectionProcessors is the one without a parser and reports as untyped rather
than as an element with an empty body. The ir command shows the ratio, which is
the number that has to reach parity with element count before the emitter can
stop reading raw."
```

---

## Done when

- `npx jest` passes with 103 tests across 14 suites.
- `npx tsc -p tsconfig.json` is clean.
- `node dist/index.js ir exampleflow.xml` reports 20 elements, **19 of 20 typed bodies**, 16 declarations, nothing unsupported.
- `analyze` and `bulkify` produce exactly what they did before this milestone.

## Not in this milestone

- **The Apex AST emitter** — Milestone 2b. This plan exists so the emitter has a typed input.
- **Type resolution from `sobject describe`** — Milestone 3. Bodies carry Flow's own type words; resolving a field to its real Salesforce type is separate.
- **Formula translation.** `FlowDeclaration.expression` holds formula source; nothing translates it.
- **`collectionprocessors` bodies.** Modelled as nodes, reported as untyped. Add when a fixture exercises one.
- **Removing `FlowNode.raw`.** It stays as an escape hatch until the emitter proves the typed bodies are sufficient.
