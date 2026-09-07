# FlowIR + Parser Implementation Plan (Milestone 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete, typed intermediate representation of a Salesforce Flow, and a parser that fills it without silently dropping anything.

**Architecture:** A new `src/ir/` module holding pure data types and a parser that maps raw xml2js output onto them. Purely additive — `SimplifiedFlowAnalyzer` and the existing generator keep working untouched, so `main` stays shippable throughout. Nothing consumes FlowIR yet; Milestone 2 (the AST emitter) is its first consumer.

**Tech Stack:** TypeScript 5 (`strict: true`, CommonJS, ES2020 target), xml2js, Jest + ts-jest.

**Spec:** `docs/specs/2026-09-07-flow-to-apex-converter-design.md`

## Global Constraints

- TypeScript `strict: true`. No `any` in exported signatures; `unknown` plus a narrowing guard instead.
- xml2js is configured `{ explicitArray: false, mergeAttrs: true, normalizeTags: true }`. **All tags arrive lowercased**, and a single occurrence is an object, not an array. Every parser must handle both shapes.
- Every IR node retains `sourceJson`: a JSON view of the parsed element, so a construct can
  be reported back to the developer. It is **not** verbatim XML — xml2js discards source
  positions, so true raw capture needs a separate extraction pass and lands in Milestone 2
  alongside the emitter, which is the first consumer that needs verbatim quoting.
- Nothing is dropped silently. An element type the parser does not model is recorded in `FlowIR.unsupported`, never ignored.
- Tests use the committed `exampleflow.xml` where a realistic fixture helps, and inline XML strings where a focused one is clearer.
- Existing tests must keep passing: `npx jest` is 25 tests / 3 suites before this plan starts.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/ir/types.ts` | The FlowIR data model. Types only, no logic. |
| `src/ir/parseDeclarations.ts` | `variables`, `constants`, `formulas`, `textTemplates` → IR |
| `src/ir/parseStart.ts` | `<start>` → trigger kind, object, entry criteria |
| `src/ir/parseElements.ts` | Executable elements → IR, with connectors and fault paths |
| `src/ir/parseFlow.ts` | Orchestration: raw xml2js object → complete `FlowIR` |
| `tests/ir/*.test.ts` | One suite per parser module |

---

### Task 1: The FlowIR data model

**Files:**
- Create: `src/ir/types.ts`
- Test: none (types only; Task 2 is the first behavioural test)

**Interfaces:**
- Consumes: nothing
- Produces: `FlowIR`, `FlowDeclaration`, `FlowStart`, `FlowNode`, `FlowConnector`, `UnsupportedConstruct`, `FlowValue`

- [ ] **Step 1: Create the type module**

```typescript
// src/ir/types.ts

/** A literal value as Flow expresses it, before any Apex typing decision. */
export interface FlowValue {
  kind: 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'reference' | 'none';
  /** Raw text of the literal, or the referenced name when kind === 'reference'. */
  raw?: string;
}

/** variables, constants, formulas, textTemplates — anything declared, not executed. */
export interface FlowDeclaration {
  name: string;
  kind: 'variable' | 'constant' | 'formula' | 'textTemplate';
  dataType: string;
  isCollection: boolean;
  isInput: boolean;
  isOutput: boolean;
  /** Present for formulas and textTemplates. Flow formula syntax, untranslated. */
  expression?: string;
  value?: FlowValue;
  sourceJson: string;
}

export interface FlowConnector {
  target: string;
  /** True when this edge is the element's fault path. */
  isFault: boolean;
}

/** One executable element. */
export interface FlowNode {
  name: string;
  /** Lowercased Flow element type, e.g. 'recordlookups'. */
  kind: string;
  label?: string;
  connectors: FlowConnector[];
  /** Object the element operates on, where the Flow declares one. */
  object?: string;
  sourceJson: string;
  /** Everything the parser read but does not yet model, kept for the emitter. */
  raw: Record<string, unknown>;
}

export interface FlowStart {
  /** 'autolaunched' when the Flow has no trigger; otherwise the Flow's triggerType. */
  triggerKind: string;
  object?: string;
  entryCriteria?: string;
  connector?: FlowConnector;
  sourceJson: string;
}

/** A construct the parser recognised but does not model. Never silently dropped. */
export interface UnsupportedConstruct {
  kind: string;
  name?: string;
  reason: string;
  sourceJson: string;
}

export interface FlowIR {
  flowName: string;
  processType: string;
  start?: FlowStart;
  declarations: FlowDeclaration[];
  nodes: FlowNode[];
  unsupported: UnsupportedConstruct[];
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc -p tsconfig.json`
Expected: exit 0, no output.

- [ ] **Step 3: Commit**

```bash
git add src/ir/types.ts
git commit -m "feat(ir): add the FlowIR data model"
```

---

### Task 2: Parse declarations

**Files:**
- Create: `src/ir/parseDeclarations.ts`
- Test: `tests/ir/parseDeclarations.test.ts`

**Interfaces:**
- Consumes: `FlowDeclaration`, `FlowValue` from `src/ir/types.ts`
- Produces: `parseDeclarations(flowData: Record<string, unknown>): FlowDeclaration[]`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/ir/parseDeclarations.test.ts
import { parseDeclarations } from '../../src/ir/parseDeclarations.js';

/** xml2js is configured normalizeTags, so every key arrives lowercased. */
const flowData = {
  variables: [
    {
      name: 'ErrorMessage',
      datatype: 'String',
      iscollection: 'false',
      isinput: 'false',
      isoutput: 'false',
      value: { stringvalue: 'Amount cannot be null.' },
    },
    { name: 'Loans', datatype: 'SObject', iscollection: 'true', isinput: 'true', isoutput: 'false' },
  ],
  constants: {
    name: 'FIELD_NAME',
    datatype: 'String',
    value: { stringvalue: 'Amount for Commission Calculation' },
  },
  formulas: {
    name: 'IsContingent',
    datatype: 'Boolean',
    expression: "ISPICKVAL({!Loop.Product_Type__c}, 'Contingent Liability')",
  },
};

describe('parseDeclarations', () => {
  it('reads every declaration kind', () => {
    const kinds = parseDeclarations(flowData).map((d) => d.kind).sort();
    expect(kinds).toEqual(['constant', 'formula', 'variable', 'variable']);
  });

  it('parses a single (non-array) declaration, which xml2js does not wrap', () => {
    expect(parseDeclarations(flowData).filter((d) => d.kind === 'constant')).toHaveLength(1);
  });

  it('coerces the string booleans xml2js produces', () => {
    const loans = parseDeclarations(flowData).find((d) => d.name === 'Loans')!;
    expect(loans.isCollection).toBe(true);
    expect(loans.isInput).toBe(true);
    expect(loans.isOutput).toBe(false);
  });

  it('keeps a formula expression untranslated', () => {
    const f = parseDeclarations(flowData).find((d) => d.kind === 'formula')!;
    expect(f.expression).toBe("ISPICKVAL({!Loop.Product_Type__c}, 'Contingent Liability')");
  });

  it('reads a literal value', () => {
    const v = parseDeclarations(flowData).find((d) => d.name === 'ErrorMessage')!;
    expect(v.value).toEqual({ kind: 'string', raw: 'Amount cannot be null.' });
  });

  it('defaults a declaration with no value to kind none', () => {
    const loans = parseDeclarations(flowData).find((d) => d.name === 'Loans')!;
    expect(loans.value).toEqual({ kind: 'none' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/ir/parseDeclarations.test.ts`
Expected: FAIL — "Cannot find module '../../src/ir/parseDeclarations.js'".

- [ ] **Step 3: Write the implementation**

```typescript
// src/ir/parseDeclarations.ts
import { FlowDeclaration, FlowValue } from './types.js';

const KINDS: Array<[string, FlowDeclaration['kind']]> = [
  ['variables', 'variable'],
  ['constants', 'constant'],
  ['formulas', 'formula'],
  ['texttemplates', 'textTemplate'],
];

/** xml2js gives one object for a single occurrence and an array for many. */
function toArray(value: unknown): Record<string, unknown>[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]) as Record<string, unknown>[];
}

/** Flow booleans arrive as the strings 'true'/'false'. */
function toBool(value: unknown): boolean {
  return String(value) === 'true';
}

function readValue(container: unknown): FlowValue {
  if (!container || typeof container !== 'object') return { kind: 'none' };
  const c = container as Record<string, unknown>;
  if (c.stringvalue !== undefined) return { kind: 'string', raw: String(c.stringvalue) };
  if (c.numbervalue !== undefined) return { kind: 'number', raw: String(c.numbervalue) };
  if (c.booleanvalue !== undefined) return { kind: 'boolean', raw: String(c.booleanvalue) };
  if (c.datevalue !== undefined) return { kind: 'date', raw: String(c.datevalue) };
  if (c.datetimevalue !== undefined) return { kind: 'datetime', raw: String(c.datetimevalue) };
  if (c.elementreference !== undefined) return { kind: 'reference', raw: String(c.elementreference) };
  return { kind: 'none' };
}

export function parseDeclarations(flowData: Record<string, unknown>): FlowDeclaration[] {
  const out: FlowDeclaration[] = [];

  for (const [tag, kind] of KINDS) {
    for (const raw of toArray(flowData[tag])) {
      out.push({
        name: String(raw.name ?? ''),
        kind,
        dataType: String(raw.datatype ?? 'Object'),
        isCollection: toBool(raw.iscollection),
        isInput: toBool(raw.isinput),
        isOutput: toBool(raw.isoutput),
        expression: raw.expression === undefined ? undefined : String(raw.expression),
        value: readValue(raw.value),
        sourceJson: JSON.stringify(raw),
      });
    }
  }

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/ir/parseDeclarations.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the whole suite**

Run: `npx jest`
Expected: PASS, 31 tests / 4 suites. Nothing existing regressed.

- [ ] **Step 6: Commit**

```bash
git add src/ir/parseDeclarations.ts tests/ir/parseDeclarations.test.ts
git commit -m "feat(ir): parse variables, constants, formulas and text templates

The existing parser recognises ten executable element types and ignores every
declaration. The bundled example Flow alone carries twelve variables and three
formulas that never reached the generator, which is why formula-derived values
appeared nowhere in the output."
```

---

### Task 3: Parse the start element

**Files:**
- Create: `src/ir/parseStart.ts`
- Test: `tests/ir/parseStart.test.ts`

**Interfaces:**
- Consumes: `FlowStart`, `FlowConnector` from `src/ir/types.ts`
- Produces: `parseStart(flowData: Record<string, unknown>): FlowStart | undefined`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/ir/parseStart.test.ts
import { parseStart } from '../../src/ir/parseStart.js';

describe('parseStart', () => {
  it('reports an autolaunched Flow when no trigger is declared', () => {
    const start = parseStart({
      start: { connector: { targetreference: 'Init_Collection' } },
    })!;
    expect(start.triggerKind).toBe('autolaunched');
    expect(start.connector).toEqual({ target: 'Init_Collection', isFault: false });
  });

  it('reads the trigger type and object of a record-triggered Flow', () => {
    const start = parseStart({
      start: {
        object: 'LLC_BI__Loan__c',
        triggertype: 'RecordAfterSave',
        filterlogic: 'and',
        connector: { targetreference: 'Assign_Defaults' },
      },
    })!;
    expect(start.triggerKind).toBe('RecordAfterSave');
    expect(start.object).toBe('LLC_BI__Loan__c');
  });

  it('captures entry criteria when present', () => {
    const start = parseStart({
      start: { object: 'Account', triggertype: 'RecordBeforeSave', filterlogic: '1 AND 2' },
    })!;
    expect(start.entryCriteria).toBe('1 AND 2');
  });

  it('returns undefined when the Flow has no start element', () => {
    expect(parseStart({})).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/ir/parseStart.test.ts`
Expected: FAIL — "Cannot find module '../../src/ir/parseStart.js'".

- [ ] **Step 3: Write the implementation**

```typescript
// src/ir/parseStart.ts
import { FlowStart } from './types.js';

export function parseStart(flowData: Record<string, unknown>): FlowStart | undefined {
  const raw = flowData.start as Record<string, unknown> | undefined;
  if (!raw) return undefined;

  const connectorRaw = raw.connector as Record<string, unknown> | undefined;

  return {
    // A Flow with no triggerType runs on demand; naming that explicitly keeps the
    // emitter from having to treat undefined as a meaningful state.
    triggerKind: raw.triggertype === undefined ? 'autolaunched' : String(raw.triggertype),
    object: raw.object === undefined ? undefined : String(raw.object),
    entryCriteria: raw.filterlogic === undefined ? undefined : String(raw.filterlogic),
    connector: connectorRaw
      ? { target: String(connectorRaw.targetreference), isFault: false }
      : undefined,
    sourceJson: JSON.stringify(raw),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/ir/parseStart.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ir/parseStart.ts tests/ir/parseStart.test.ts
git commit -m "feat(ir): parse the start element, trigger kind and entry criteria"
```

---

### Task 4: Parse executable elements, connectors and fault paths

**Files:**
- Create: `src/ir/parseElements.ts`
- Test: `tests/ir/parseElements.test.ts`

**Interfaces:**
- Consumes: `FlowNode`, `FlowConnector`, `UnsupportedConstruct` from `src/ir/types.ts`
- Produces: `parseElements(flowData: Record<string, unknown>): { nodes: FlowNode[]; unsupported: UnsupportedConstruct[] }`, and the exported constant `MODELLED_ELEMENT_TYPES: string[]`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/ir/parseElements.test.ts
import { parseElements, MODELLED_ELEMENT_TYPES } from '../../src/ir/parseElements.js';

describe('parseElements', () => {
  it('reads a record lookup with its declared object', () => {
    const { nodes } = parseElements({
      recordlookups: {
        name: 'Get_Pricing_Streams',
        label: 'Get Pricing Streams',
        object: 'LLC_BI__Pricing_Stream__c',
        connector: { targetreference: 'Loop_over_Loans' },
      },
    });
    expect(nodes).toHaveLength(1);
    expect(nodes[0].kind).toBe('recordlookups');
    expect(nodes[0].object).toBe('LLC_BI__Pricing_Stream__c');
  });

  it('marks a fault connector as a fault edge', () => {
    const { nodes } = parseElements({
      recordcreates: {
        name: 'Create_Loan',
        connector: { targetreference: 'Next' },
        faultconnector: { targetreference: 'Handle_Error' },
      },
    });
    expect(nodes[0].connectors).toEqual([
      { target: 'Next', isFault: false },
      { target: 'Handle_Error', isFault: true },
    ]);
  });

  it('reads every branch target of a decision', () => {
    const { nodes } = parseElements({
      decisions: {
        name: 'Check_Amount',
        rules: [
          { name: 'Over', connector: { targetreference: 'Flag_High' } },
          { name: 'Under', connector: { targetreference: 'Flag_Low' } },
        ],
        defaultconnector: { targetreference: 'Continue' },
      },
    });
    expect(nodes[0].connectors.map((c) => c.target).sort()).toEqual([
      'Continue', 'Flag_High', 'Flag_Low',
    ]);
  });

  it('records an element type it does not model instead of dropping it', () => {
    const { nodes, unsupported } = parseElements({
      screens: { name: 'Confirm_Details', label: 'Confirm' },
    });
    expect(nodes).toHaveLength(0);
    expect(unsupported).toHaveLength(1);
    expect(unsupported[0].kind).toBe('screens');
    expect(unsupported[0].name).toBe('Confirm_Details');
  });

  it('ignores Flow metadata keys that are not elements', () => {
    const { nodes, unsupported } = parseElements({
      label: 'My Flow',
      interviewlabel: 'My Flow {!$Flow.CurrentDateTime}',
      processtype: 'AutoLaunchedFlow',
      status: 'Active',
      processmetadatavalues: { name: 'BuilderType' },
    });
    expect(nodes).toHaveLength(0);
    expect(unsupported).toHaveLength(0);
  });

  it('models the element types the analyzer already handled', () => {
    // Guards against a regression in coverage while the IR is being built out.
    for (const kind of [
      'actioncalls', 'assignments', 'decisions', 'loops', 'recordlookups',
      'recordcreates', 'recordupdates', 'recorddeletes', 'subflows',
    ]) {
      expect(MODELLED_ELEMENT_TYPES).toContain(kind);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/ir/parseElements.test.ts`
Expected: FAIL — "Cannot find module '../../src/ir/parseElements.js'".

- [ ] **Step 3: Write the implementation**

```typescript
// src/ir/parseElements.ts
import { FlowConnector, FlowNode, UnsupportedConstruct } from './types.js';

/** Executable element types the IR models. */
export const MODELLED_ELEMENT_TYPES = [
  'actioncalls',
  'assignments',
  'collectionprocessors',
  'decisions',
  'loops',
  'recordcreates',
  'recorddeletes',
  'recordlookups',
  'recordupdates',
  'subflows',
];

/** Executable element types Flow supports that the IR does not model yet. */
const KNOWN_UNMODELLED = [
  'screens',
  'waits',
  'steps',
  'orchestratedstages',
  'customerrors',
  'transforms',
  'apexpluginCalls',
  'recordrollbacks',
];

/**
 * Keys that appear at Flow level but are not elements. Listed explicitly so that a
 * genuinely new element type falls through to `unsupported` rather than being
 * mistaken for metadata and dropped.
 */
const FLOW_METADATA_KEYS = new Set([
  'label', 'interviewlabel', 'processtype', 'status', 'apiversion', 'description',
  'processmetadatavalues', 'start', 'variables', 'constants', 'formulas',
  'texttemplates', 'choices', 'dynamicchoicesets', 'sourcetemplate', 'environments',
  'runinmode', 'timezonesidkey', 'triggerorder', '$', 'xmlns',
]);

function toArray(value: unknown): Record<string, unknown>[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]) as Record<string, unknown>[];
}

function connectorFrom(raw: unknown, isFault: boolean): FlowConnector[] {
  return toArray(raw)
    .filter((c) => c.targetreference !== undefined)
    .map((c) => ({ target: String(c.targetreference), isFault }));
}

/** Every outbound edge of an element: normal, decision branches, default, fault. */
function collectConnectors(raw: Record<string, unknown>): FlowConnector[] {
  const edges: FlowConnector[] = [
    ...connectorFrom(raw.connector, false),
    ...connectorFrom(raw.defaultconnector, false),
    ...connectorFrom(raw.nextvalueconnector, false),
    ...connectorFrom(raw.nomorevaluesconnector, false),
    ...connectorFrom(raw.faultconnector, true),
  ];

  // Decision rules each carry their own connector.
  for (const rule of toArray(raw.rules)) {
    edges.push(...connectorFrom(rule.connector, false));
  }

  return edges;
}

export function parseElements(flowData: Record<string, unknown>): {
  nodes: FlowNode[];
  unsupported: UnsupportedConstruct[];
} {
  const nodes: FlowNode[] = [];
  const unsupported: UnsupportedConstruct[] = [];

  for (const [key, value] of Object.entries(flowData)) {
    if (FLOW_METADATA_KEYS.has(key)) continue;

    const modelled = MODELLED_ELEMENT_TYPES.includes(key);

    for (const raw of toArray(value)) {
      if (raw.name === undefined) continue; // not an element shape

      if (!modelled) {
        unsupported.push({
          kind: key,
          name: String(raw.name),
          reason: KNOWN_UNMODELLED.includes(key)
            ? `Flow element type "${key}" is not modelled by the IR yet`
            : `Unrecognised Flow element type "${key}"`,
          sourceJson: JSON.stringify(raw),
        });
        continue;
      }

      nodes.push({
        name: String(raw.name),
        kind: key,
        label: raw.label === undefined ? undefined : String(raw.label),
        connectors: collectConnectors(raw),
        object: raw.object === undefined ? undefined : String(raw.object),
        sourceJson: JSON.stringify(raw),
        raw,
      });
    }
  }

  return { nodes, unsupported };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/ir/parseElements.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ir/parseElements.ts tests/ir/parseElements.test.ts
git commit -m "feat(ir): parse executable elements, all connectors, and fault paths

Records an unmodelled element type in `unsupported` rather than skipping it.
The previous parser iterated a hardcoded list of ten types, so a Flow
containing anything else was analysed as though those elements did not exist."
```

---

### Task 5: Assemble the FlowIR

**Files:**
- Create: `src/ir/parseFlow.ts`
- Test: `tests/ir/parseFlow.test.ts`

**Interfaces:**
- Consumes: `parseDeclarations`, `parseStart`, `parseElements`, and `FlowIR` from `src/ir/types.ts`
- Produces: `parseFlowXml(xmlContent: string, flowName: string): Promise<FlowIR>` and `parseFlowFile(xmlPath: string): Promise<FlowIR>`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/ir/parseFlow.test.ts
import * as path from 'path';
import { parseFlowFile } from '../../src/ir/parseFlow.js';
import { FlowIR } from '../../src/ir/types.js';

const EXAMPLE_FLOW = path.join(__dirname, '..', '..', 'exampleflow.xml');

describe('parseFlowXml against the bundled example Flow', () => {
  let ir: FlowIR;
  beforeAll(async () => {
    ir = await parseFlowFile(EXAMPLE_FLOW);
  });

  it('names the Flow from its file name', () => {
    expect(ir.flowName).toBe('exampleflow');
  });

  it('reads the process type', () => {
    expect(ir.processType).toBe('AutoLaunchedFlow');
  });

  it('captures the declarations the old parser ignored', () => {
    // The example Flow carries 12 variables and 3 formulas.
    expect(ir.declarations.filter((d) => d.kind === 'variable').length).toBe(12);
    expect(ir.declarations.filter((d) => d.kind === 'formula').length).toBe(3);
    expect(ir.declarations.filter((d) => d.kind === 'constant').length).toBe(1);
    expect(ir.declarations).toHaveLength(16);
  });

  it('captures the executable elements', () => {
    expect(ir.nodes.filter((n) => n.kind === 'assignments').length).toBe(7);
    expect(ir.nodes.filter((n) => n.kind === 'decisions').length).toBe(5);
    expect(ir.nodes.filter((n) => n.kind === 'subflows').length).toBe(4);
    expect(ir.nodes.filter((n) => n.kind === 'loops').length).toBe(1);
    expect(ir.nodes.filter((n) => n.kind === 'recordlookups').length).toBe(1);
  });

  it('reads the object the lookup declares', () => {
    const lookup = ir.nodes.find((n) => n.kind === 'recordlookups')!;
    expect(lookup.object).toBe('LLC_BI__Pricing_Stream__c');
  });

  it('has a start element', () => {
    expect(ir.start).toBeDefined();
    expect(ir.start!.triggerKind).toBe('autolaunched');
  });

  it('reports nothing unsupported for this Flow', () => {
    expect(ir.unsupported).toEqual([]);
  });

  it('retains source XML on every node, so any construct can be quoted back', () => {
    for (const node of ir.nodes) {
      expect(node.sourceJson.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/ir/parseFlow.test.ts`
Expected: FAIL — "Cannot find module '../../src/ir/parseFlow.js'".

- [ ] **Step 3: Write the implementation**

```typescript
// src/ir/parseFlow.ts
import * as fs from 'fs';
import * as path from 'path';
import * as xml2js from 'xml2js';
import { parseDeclarations } from './parseDeclarations.js';
import { parseElements } from './parseElements.js';
import { parseStart } from './parseStart.js';
import { FlowIR } from './types.js';

/**
 * Matches the options the existing analyzer uses, so both read identically shaped
 * data: tags lowercased, a single occurrence left unwrapped, attributes merged.
 */
const PARSER_OPTIONS: xml2js.ParserOptions = {
  explicitArray: false,
  mergeAttrs: true,
  normalizeTags: true,
};

export async function parseFlowXml(xmlContent: string, flowName: string): Promise<FlowIR> {
  const parsed = await new xml2js.Parser(PARSER_OPTIONS).parseStringPromise(xmlContent);
  const flowData = (parsed.flow ?? parsed) as Record<string, unknown>;

  const { nodes, unsupported } = parseElements(flowData);

  return {
    flowName,
    processType: String(flowData.processtype ?? 'Unknown'),
    start: parseStart(flowData),
    declarations: parseDeclarations(flowData),
    nodes,
    unsupported,
  };
}

export async function parseFlowFile(xmlPath: string): Promise<FlowIR> {
  const xmlContent = fs.readFileSync(xmlPath, 'utf-8');
  const flowName = path.basename(xmlPath).replace(/\.(flow-meta\.xml|xml)$/i, '');
  return parseFlowXml(xmlContent, flowName);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/ir/parseFlow.test.ts`
Expected: PASS, 8 tests.

If the declaration or element counts differ from the assertions, do not change the
assertion to match the code. Count the elements in `exampleflow.xml` first
(`grep -c '<variables>' exampleflow.xml`) and find out which side is wrong.

- [ ] **Step 5: Run the whole suite**

Run: `npx jest`
Expected: PASS, 49 tests / 7 suites. The 25 pre-existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/ir/parseFlow.ts tests/ir/parseFlow.test.ts
git commit -m "feat(ir): assemble a complete FlowIR from a Flow file

Verified against the bundled example Flow: 12 variables and 3 formulas that the
previous parser ignored entirely are now in the IR, alongside the executable
elements and the object each record element declares."
```

---

### Task 6: Report IR coverage from the CLI

**Files:**
- Modify: `src/flow-bulkifier-cli.ts` — add an `ir` command alongside `analyze` and `bulkify`
- Test: `tests/ir/coverage.test.ts`

**Interfaces:**
- Consumes: `parseFlowFile` from `src/ir/parseFlow.js`, `FlowIR` from `src/ir/types.js`
- Produces: `summariseCoverage(ir: FlowIR): CoverageSummary` exported from `src/ir/coverage.ts`, where
  `CoverageSummary = { flowName: string; nodeCount: number; declarationCount: number; unsupported: { kind: string; name?: string; reason: string }[] }`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/ir/coverage.test.ts
import { summariseCoverage } from '../../src/ir/coverage.js';
import { FlowIR } from '../../src/ir/types.js';

const ir: FlowIR = {
  flowName: 'MyFlow',
  processType: 'AutoLaunchedFlow',
  declarations: [
    { name: 'V', kind: 'variable', dataType: 'String', isCollection: false, isInput: false, isOutput: false, sourceJson: '{}' },
  ],
  nodes: [
    { name: 'Lookup', kind: 'recordlookups', connectors: [], sourceJson: '{}', raw: {} },
  ],
  unsupported: [
    { kind: 'screens', name: 'Confirm', reason: 'Flow element type "screens" is not modelled by the IR yet', sourceJson: '{}' },
  ],
};

describe('summariseCoverage', () => {
  it('counts what the IR captured', () => {
    const s = summariseCoverage(ir);
    expect(s.nodeCount).toBe(1);
    expect(s.declarationCount).toBe(1);
  });

  it('lists every unsupported construct with its reason', () => {
    const s = summariseCoverage(ir);
    expect(s.unsupported).toEqual([
      { kind: 'screens', name: 'Confirm', reason: 'Flow element type "screens" is not modelled by the IR yet' },
    ]);
  });

  it('drops the source XML, which is for the emitter and not for a summary', () => {
    const s = summariseCoverage(ir) as unknown as Record<string, unknown>;
    expect(JSON.stringify(s)).not.toContain('sourceJson');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/ir/coverage.test.ts`
Expected: FAIL — "Cannot find module '../../src/ir/coverage.js'".

- [ ] **Step 3: Write the implementation**

```typescript
// src/ir/coverage.ts
import { FlowIR } from './types.js';

export interface CoverageSummary {
  flowName: string;
  nodeCount: number;
  declarationCount: number;
  unsupported: { kind: string; name?: string; reason: string }[];
}

/** What the IR understood about a Flow, and what it did not. */
export function summariseCoverage(ir: FlowIR): CoverageSummary {
  return {
    flowName: ir.flowName,
    nodeCount: ir.nodes.length,
    declarationCount: ir.declarations.length,
    unsupported: ir.unsupported.map(({ kind, name, reason }) => ({ kind, name, reason })),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/ir/coverage.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Add the CLI command**

In `src/flow-bulkifier-cli.ts`, alongside the existing `analyze` and `bulkify` command
registrations, add:

```typescript
program
  .command('ir <flow-file>')
  .description('Report what the intermediate representation understands about a Flow')
  .option('--json', 'Emit the coverage summary as JSON')
  .action(async (flowFile: string, options: { json?: boolean }) => {
    const { parseFlowFile } = await import('./ir/parseFlow.js');
    const { summariseCoverage } = await import('./ir/coverage.js');

    const ir = await parseFlowFile(flowFile);
    const summary = summariseCoverage(ir);

    if (options.json) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    console.log(`\nFlow: ${summary.flowName}`);
    console.log(`  Elements understood:  ${summary.nodeCount}`);
    console.log(`  Declarations read:    ${summary.declarationCount}`);
    if (summary.unsupported.length === 0) {
      console.log(`  Nothing unsupported.\n`);
      return;
    }
    console.log(`  Not modelled (${summary.unsupported.length}):`);
    for (const u of summary.unsupported) {
      console.log(`    ${u.kind}/${u.name ?? '?'} — ${u.reason}`);
    }
    console.log('');
  });
```

- [ ] **Step 6: Verify the command runs**

Run: `npx tsc -p tsconfig.json && node dist/index.js ir exampleflow.xml`
Expected: reports 20 elements understood, 16 declarations read, nothing unsupported.

- [ ] **Step 7: Run the whole suite**

Run: `npx jest`
Expected: PASS, 52 tests / 8 suites.

- [ ] **Step 8: Commit**

```bash
git add src/ir/coverage.ts src/flow-bulkifier-cli.ts tests/ir/coverage.test.ts
git commit -m "feat(cli): add an ir command reporting what the IR understands

Makes IR coverage observable before anything depends on it. Running it against
a Flow says how much of that Flow the converter can currently see, which is the
number that has to reach 100% for a given Flow before conversion of that Flow
can be called faithful."
```

---

## Done when

- `npx jest` passes with 52 tests across 8 suites.
- `npx tsc -p tsconfig.json` is clean.
- `node dist/index.js ir exampleflow.xml` reports 20 elements, 16 declarations, nothing unsupported.
- `node dist/index.js bulkify exampleflow.xml --output ./out` still produces the same output it did before this milestone — FlowIR is additive and nothing consumes it yet.

## Not in this milestone

Deliberately deferred, each to its own plan:

- **Type resolution** from `sobject describe` — Milestone 3.
- **The Apex AST emitter** — Milestone 2. FlowIR is its input; that is why this lands first.
- **Formula translation.** Formula expressions are captured verbatim in `FlowDeclaration.expression` and translated by nothing yet.
- **The bulkification transform** on the new IR — Milestone 5. `SimplifiedFlowAnalyzer` continues to serve `bulkify` until then.
