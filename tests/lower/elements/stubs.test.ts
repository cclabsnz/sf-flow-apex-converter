import { emitClass } from '../../../src/apex/class.js';
import { emitStmt } from '../../../src/apex/emit.js';
import { Scope } from '../../../src/apex/scope.js';
import { FlowDeclaration, FlowIR, FlowNode } from '../../../src/ir/types.js';
import { LowerContext } from '../../../src/lower/context.js';
import { declarationTypeSource } from '../../../src/lower/typeSource.js';
import { lowerAction, lowerFormula, lowerSubflow } from '../../../src/lower/elements/stubs.js';
import { UnsupportedConstructError } from '../../../src/lower/value.js';

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
    const c = ctx([formula('isCA', "ISPICKVAL({!A.T__c}, 'X')")]);
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

  it('emits a well-formed doc block for an expression containing */', () => {
    // A formula's text literal can contain '*/', which would close an ApexDoc
    // comment early and make the rest of the class unparseable. The method
    // body's throw message legitimately contains the same raw text inside an
    // Apex string literal — that occurrence is not a defect, so the check below
    // isolates the doc block itself (a non-greedy match stops at the FIRST `*/`,
    // which would land mid-expression if the doc line were not escaped).
    const c = ctx([formula('isCA', "OR({!A.X__c}, 'a*/b')")]);
    lowerFormula(c.ir.declarations[0], c);
    const method = [...c.stubs.values()][0];
    const cls = emitClass({
      name: 'T', sharing: 'with sharing', doc: [], fields: [], inner: [], methods: [method],
    });
    const [docBlock] = cls.match(/\/\*\*[\s\S]*?\*\//) ?? [''];
    expect(docBlock).toContain('a*\\/b');
    expect(docBlock).toContain('Flow expression:');
    expect(cls).toContain('private static Boolean formula_isCA()');
  });

  it('translates a bare global permission reference exactly, with no stub', () => {
    // {!$Permission.CanApprove} is fully translated by lowerReference already;
    // BARE_REFERENCE must not exclude the leading $ and send it to a stub.
    const c = ctx([formula('canApprove', '{!$Permission.CanApprove}')]);
    const expr = lowerFormula(c.ir.declarations[0], c);
    expect(c.stubs.size).toBe(0);
    expect(emitStmt({ stmt: 'invoke', call: expr } as never)).toBe(
      "FeatureManagement.checkPermission('CanApprove');"
    );
  });
});

describe('lowerSubflow', () => {
  const subflowNode = (name: string, flowName: string): FlowNode => ({
    name, kind: 'subflows', connectors: [], sourceJson: '{}', raw: {},
    body: { kind: 'subflow', flowName, inputs: [], outputs: [],
      storeOutputAutomatically: true },
  });

  it('calls the subflow class and records a dependency', () => {
    const node = subflowNode('Validate', 'NC_Validate_Dates');
    const c = ctx();
    const out = lowerSubflow(node, c).map((s) => emitStmt(s)).join('\n');
    expect(out).toContain('NC_Validate_Dates');
    expect(c.notes.filter((n) => n.kind === 'dependency')).toHaveLength(1);
  });

  it('emits the identical class name for two calls to the same subflow', () => {
    // A subflow names a class this converter does not generate, so it cannot be
    // renamed on collision the way a local can. A prior bug ran the name through
    // Scope, so a second reference to NC_Validate emitted NC_Validate2 — a class
    // that does not exist, or worse, a different one that does.
    const c = ctx();
    const first = lowerSubflow(subflowNode('Before', 'NC_Validate'), c)
      .map((s) => emitStmt(s)).join('\n');
    const second = lowerSubflow(subflowNode('After', 'NC_Validate'), c)
      .map((s) => emitStmt(s)).join('\n');
    expect(first).toBe('NC_Validate.execute();');
    expect(second).toBe('NC_Validate.execute();');
  });

  it('emits the subflow name verbatim even when it collides with an allocated local', () => {
    const c = ctx();
    c.scope.allocate('NC_Validate');
    const out = lowerSubflow(subflowNode('Validate', 'NC_Validate'), c)
      .map((s) => emitStmt(s)).join('\n');
    expect(out).toBe('NC_Validate.execute();');
  });

  it('refuses a subflow name that is an Apex reserved word', () => {
    const c = ctx();
    expect(() => lowerSubflow(subflowNode('Validate', 'List'), c))
      .toThrow(UnsupportedConstructError);
  });

  it('refuses a subflow name that is not a valid Apex identifier', () => {
    const c = ctx();
    expect(() => lowerSubflow(subflowNode('Validate', '2Bad'), c))
      .toThrow(UnsupportedConstructError);
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
