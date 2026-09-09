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

  it('maps an Apex-defined type to its class name, not to String', () => {
    // dataType 'Apex' carries the class in <apexClass>, not <objectType> — a
    // Flow variable typed this way (e.g. an invocable's request/response
    // wrapper) has no <objectType> at all. Falling through to the String
    // default here means every field write on it (`msg.Message = x;`) is a
    // compile error against a real class: String has no such member.
    expect(flowTypeToApex('Apex', undefined, false, 'ValidationMessage')).toEqual(
      sobjectType('ValidationMessage')
    );
  });

  it('wraps a collection of an Apex-defined type in a List of that type', () => {
    expect(flowTypeToApex('Apex', undefined, true, 'ValidationMessage')).toEqual(
      listOf(sobjectType('ValidationMessage'))
    );
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

describe('declarationTypeSource on an undotted loop element name', () => {
  const loopNode: FlowNode = {
    name: 'Loop_over_Loans', kind: 'loops', connectors: [], sourceJson: '{}', raw: {},
    body: { kind: 'loop', collection: 'LoansInPP', bodyTarget: 'X' },
  };
  const loans = decl({
    name: 'LoansInPP', dataType: 'SObject', objectType: 'LLC_BI__Loan__c', isCollection: true,
  });

  it('resolves the bare loop name to the collection element type', () => {
    // The loops map was consulted only inside objectOf — the DOTTED path — so a
    // bare resolve('Loop_over_Loans') fell through to "not declared; assumed
    // String". lowerAssignment's `kind === 'SObject'` check therefore never
    // fired for a loop variable, and a field write's guessed type never reached
    // the class header.
    const resolved = declarationTypeSource(ir([loans], [loopNode])).resolve('Loop_over_Loans');
    expect(resolved.type).toEqual(sobjectType('LLC_BI__Loan__c'));
    expect(resolved.provenance).toBe('declared');
  });

  it('folds case, as Flow and Apex both do', () => {
    expect(declarationTypeSource(ir([loans], [loopNode])).resolve('loop_over_loans').type)
      .toEqual(sobjectType('LLC_BI__Loan__c'));
  });

  it('lets a real declaration of the same name win', () => {
    const shadow = decl({ name: 'Loop_over_Loans', dataType: 'Boolean' });
    expect(declarationTypeSource(ir([loans, shadow], [loopNode])).resolve('Loop_over_Loans').type)
      .toEqual(BOOLEAN);
  });

  it('still guesses when the loop iterates something undeclared', () => {
    const orphan: FlowNode = {
      ...loopNode,
      body: { kind: 'loop', collection: 'Nowhere', bodyTarget: 'X' },
    };
    const resolved = declarationTypeSource(ir([], [orphan])).resolve('Loop_over_Loans');
    expect(resolved.provenance).toBe('heuristic');
  });
});
