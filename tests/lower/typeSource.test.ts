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

  it('recognises a custom permission reference regardless of case', () => {
    // Every other lookup in this module folds case because Apex and Flow do.
    // This one did not, so a hand-edited Flow using $permission resolved to a
    // String guess instead of a Boolean permission check.
    const ts = declarationTypeSource(ir([]));
    expect(ts.resolve('$permission.NC_RBNZ_TDTI').type).toEqual(BOOLEAN);
    expect(ts.resolve('$PERMISSION.NC_RBNZ_TDTI').provenance).toBe('standard');
  });

  it('does not claim standard provenance when the object is unresolved', () => {
    // The type may still be right, but 'standard' means "known for this object".
    // Saying it when the object was never resolved is the overstatement this
    // module exists to prevent.
    const ts = declarationTypeSource(ir([]));
    const r = ts.resolve('NoSuchThing.Id');
    expect(r.provenance).toBe('heuristic');
    expect(r.note).toMatch(/unresolved|unknown/i);
  });

  it('falls back to a heuristic for an unknown reference rather than throwing', () => {
    // Refusing here would refuse the Flow; a flagged guess is the agreed policy.
    expect(declarationTypeSource(ir([])).resolve('Mystery').provenance).toBe('heuristic');
  });
});
