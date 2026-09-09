import { emitStmt } from '../../../src/apex/emit.js';
import { ApexTypeError } from '../../../src/apex/errors.js';
import { Scope } from '../../../src/apex/scope.js';
import { FlowDeclaration, FlowIR, FlowNode } from '../../../src/ir/types.js';
import { LowerContext, apexName } from '../../../src/lower/context.js';
import { UnsupportedConstructError } from '../../../src/lower/value.js';
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

  it('refuses more than one filter rather than dropping one', () => {
    // Two IN filters used to overwrite each other, silently widening the query
    // to a near-full-object scan.
    const node = lookup();
    if (node.body?.kind === 'record') {
      node.body.filters = [
        { left: 'LLC_BI__Loan__c', operator: 'In', right: { kind: 'reference', raw: 'A' } },
        { left: 'Status__c', operator: 'In', right: { kind: 'reference', raw: 'B' } },
      ];
    }
    expect(() => lowerRecord(node, ctx())).toThrow(UnsupportedConstructError);
  });

  it('keeps the synthesized DML collection distinct from a real X_records element', () => {
    const node: FlowNode = {
      name: 'X', kind: 'recordcreates', connectors: [], sourceJson: '{}', raw: {},
      object: 'Account',
      body: {
        kind: 'record', object: 'Account', filters: [],
        inputAssignments: [], queriedFields: [], getFirstRecordOnly: false,
        storeOutputAutomatically: false, outputAssignments: [],
        assignNullValuesIfNoRecordsFound: false,
      },
    };
    const c = ctx();
    // A real Flow element named X_records claims that identifier first.
    const reserved = apexName(c, 'X_records');
    const out = lowerRecord(node, c).map((s) => emitStmt(s)).join('\n');
    const match = out.match(/List<Account> (\w+) = new List<Account>\(\);/);
    expect(match).not.toBeNull();
    expect(match?.[1]).not.toBe(reserved);
  });

  it('stores a getFirstRecordOnly lookup into a single SObject, not a List', () => {
    // Flow Builder's DEFAULT Get Records configuration. Ignoring the flag
    // emitted `List<T> X = [...]`, and a later `{!X.Name}` lowered to
    // `X.get('Name')` — compiler-confirmed as "Method does not exist or
    // incorrect signature: void get(String) from the type List<Account>".
    const node = lookup();
    if (node.body?.kind === 'record') {
      node.body.getFirstRecordOnly = true;
      node.body.outputReference = 'Found';
    }
    const c = ctx([{
      name: 'Found', kind: 'variable', dataType: 'SObject',
      objectType: 'LLC_BI__Pricing_Stream__c', isCollection: false,
      isInput: false, isOutput: false, sourceJson: '{}',
    }]);
    const out = lowerRecord(node, c).map((s) => emitStmt(s)).join('\n');
    expect(out).not.toMatch(/List<[^>]+> Found =/);
    expect(out).toMatch(/List<LLC_BI__Pricing_Stream__c> \w+ = \[/);
    // 'Found' is a Flow declaration, so lowerFlow declares it at the method's
    // top level and the element assigns into it (see isFlowDeclared).
    expect(out).not.toMatch(/^LLC_BI__Pricing_Stream__c Found/m);
    // Flow's semantics: no record found leaves the variable null. `[...][0]`
    // would throw on an empty result instead.
    expect(out).toMatch(/Found = \w+\.isEmpty\(\) \? null : \w+\.get\(0\);/);
    expect(out).not.toContain('][0]');
  });

  it('caps a getFirstRecordOnly query at one row', () => {
    const node = lookup();
    if (node.body?.kind === 'record') node.body.getFirstRecordOnly = true;
    const out = lowerRecord(node, ctx()).map((s) => emitStmt(s)).join('\n');
    expect(out).toContain('LIMIT 1');
  });

  it('declares an element-internal getFirstRecordOnly target in place', () => {
    // No outputReference, so the target is the element's own name and is not a
    // Flow declaration — nothing else declares it.
    const node = lookup();
    if (node.body?.kind === 'record') node.body.getFirstRecordOnly = true;
    const out = lowerRecord(node, ctx()).map((s) => emitStmt(s)).join('\n');
    expect(out).toMatch(/LLC_BI__Pricing_Stream__c Get_Streams = \w+\.isEmpty\(\)/);
  });

  it('refuses a getFirstRecordOnly lookup whose target is declared a collection', () => {
    // The Flow says "first record only" and its own declaration says List.
    // Those disagree; picking one would be a guess.
    const node = lookup();
    if (node.body?.kind === 'record') {
      node.body.getFirstRecordOnly = true;
      node.body.outputReference = 'Found';
    }
    const c = ctx([{
      name: 'Found', kind: 'variable', dataType: 'SObject',
      objectType: 'LLC_BI__Pricing_Stream__c', isCollection: true,
      isInput: false, isOutput: false, sourceJson: '{}',
    }]);
    expect(() => lowerRecord(node, c)).toThrow(UnsupportedConstructError);
  });

  it('refuses a lookup whose declared outputReference type does not match the query', () => {
    const node = lookup();
    if (node.body?.kind === 'record') {
      node.body.outputReference = 'Found';
    }
    const c = ctx([{
      name: 'Found', kind: 'variable', dataType: 'Boolean', isCollection: false,
      isInput: false, isOutput: false, sourceJson: '{}',
    }]);
    expect(() => lowerRecord(node, c)).toThrow(ApexTypeError);
  });
});
