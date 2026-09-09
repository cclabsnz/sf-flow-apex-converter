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
