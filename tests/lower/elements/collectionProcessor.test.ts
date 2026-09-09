import { emitStmt } from '../../../src/apex/emit.js';
import { Scope } from '../../../src/apex/scope.js';
import {
  CollectionProcessorBody, FlowConditionIR, FlowDeclaration, FlowIR, FlowNode,
} from '../../../src/ir/types.js';
import { LowerContext } from '../../../src/lower/context.js';
import { declarationTypeSource } from '../../../src/lower/typeSource.js';
import { UnsupportedConstructError } from '../../../src/lower/value.js';
import { lowerCollectionProcessor } from '../../../src/lower/elements/collectionProcessor.js';

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

function processorNode(body: Partial<CollectionProcessorBody> = {}): FlowNode {
  return {
    name: 'Filter_Loans', kind: 'collectionProcessors', connectors: [], sourceJson: '{}', raw: {},
    body: {
      kind: 'collectionProcessor',
      collection: 'Loans',
      processorType: 'FilterCollectionProcessor',
      conditionLogic: 'and',
      conditions: [],
      assignNextValueToReference: 'CurrentLoan',
      ...body,
    },
  };
}

const overThreshold: FlowConditionIR = {
  left: 'CurrentLoan.Amount__c',
  operator: 'GreaterThan',
  right: { kind: 'number', raw: '1000' },
};

describe('lowerCollectionProcessor', () => {
  it('lowers a filter to a declaration and a guarded foreach', () => {
    const c = ctx([
      decl('Loans', 'SObject', true, 'Loan__c'),
      decl('CurrentLoan', 'SObject', false, 'Loan__c'),
    ]);
    const node = processorNode({ conditions: [overThreshold] });
    const out = lowerCollectionProcessor(node, c).map((s) => emitStmt(s)).join('\n');
    // The declaration must construct the list. A null list that is then .add()ed to
    // compiles and throws NullPointerException on the first matching row.
    //
    // 'CurrentLoan' is a Flow declaration here, so lowerFlow declares it at the
    // method's top level and the for-each iterates a separate identifier,
    // copying each item across: a for-each header always DECLARES, which would
    // be "Variable already defined" against the top-level declaration, and
    // declaring it only in the header would block-scope it (see isFlowDeclared).
    // 'Filter_Loans' is NOT a Flow declaration here, so it still declares in place.
    expect(out).toBe(
      [
        'List<Loan__c> Filter_Loans = new List<Loan__c>();',
        'for (Loan__c CurrentLoan_item : Loans) {',
        '    CurrentLoan = CurrentLoan_item;',
        "    if (((Decimal)CurrentLoan.get('Amount__c')) > 1000) {",
        '        Filter_Loans.add(CurrentLoan);',
        '    }',
        '}',
      ].join('\n')
    );
  });

  it('falls back to a generated item name when none is given', () => {
    const c = ctx([decl('Loans', 'SObject', true, 'Loan__c')]);
    const node = processorNode({ conditions: [overThreshold], assignNextValueToReference: undefined });
    const out = lowerCollectionProcessor(node, c).map((s) => emitStmt(s)).join('\n');
    expect(out).toContain('for (Loan__c Filter_Loans_item : Loans)');
  });

  it('refuses a non-Filter processor by name, rather than skipping it silently', () => {
    const c = ctx([decl('Loans', 'SObject', true, 'Loan__c')]);
    const node = processorNode({ processorType: 'SortCollectionProcessor' });
    expect(() => lowerCollectionProcessor(node, c)).toThrow(UnsupportedConstructError);
    expect(() => lowerCollectionProcessor(node, c)).toThrow(/SortCollectionProcessor/);
  });

  it('refuses a node with no collection-processor body', () => {
    const c = ctx([]);
    const node: FlowNode = {
      name: 'Set_Message', kind: 'assignments', connectors: [], sourceJson: '{}', raw: {},
      body: { kind: 'assignment', items: [] },
    };
    expect(() => lowerCollectionProcessor(node, c)).toThrow(UnsupportedConstructError);
  });

  it('refuses an empty condition list rather than emitting `if () { ... }`', () => {
    const c = ctx([
      decl('Loans', 'SObject', true, 'Loan__c'),
      decl('CurrentLoan', 'SObject', false, 'Loan__c'),
    ]);
    const node = processorNode({ conditions: [] });
    expect(() => lowerCollectionProcessor(node, c)).toThrow(UnsupportedConstructError);
  });
});
