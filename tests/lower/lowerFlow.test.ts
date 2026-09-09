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

  it('lists a field guessed twice only once in the header and the manifest', () => {
    // Notes are a faithful log: reading the same guessed field twice legitimately
    // produces two identical entries in ctx.notes, and nothing upstream
    // deduplicates them. Without collapsing them at render time, the header's
    // "N field types guessed" count is inflated and the same guess is printed
    // twice.
    const ir = flow({
      declarations: [
        { name: 'Acct', kind: 'variable', dataType: 'SObject', objectType: 'Account',
          isCollection: false, isInput: false, isOutput: false, sourceJson: '{}' },
        { name: 'Msg1', kind: 'variable', dataType: 'Number', isCollection: false,
          isInput: false, isOutput: false, sourceJson: '{}' },
        { name: 'Msg2', kind: 'variable', dataType: 'Number', isCollection: false,
          isInput: false, isOutput: false, sourceJson: '{}' },
      ],
      nodes: [{
        name: 'Set', kind: 'assignments', connectors: [], sourceJson: '{}', raw: {},
        body: { kind: 'assignment', items: [
          { target: 'Msg1', operator: 'Assign', value: { kind: 'reference', raw: 'Acct.NC_Amount__c' } },
          { target: 'Msg2', operator: 'Assign', value: { kind: 'reference', raw: 'Acct.NC_Amount__c' } },
        ] },
      }],
      start: { triggerKind: 'autolaunched', connector: { target: 'Set', isFault: false }, sourceJson: '{}' },
    });
    const result = lowerFlow(ir);
    const headerGuessLines = result.apexClass.doc.filter((l) => l.includes('NC_Amount__c'));
    expect(headerGuessLines).toHaveLength(1);
    expect(result.manifest.guesses.filter((g) => g.includes('NC_Amount__c'))).toHaveLength(1);
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

  it('initialises a declared collection so Add/AddItem does not NPE', () => {
    // "Accumulate validation messages into a collection" is one of the most
    // common Flow shapes there is. A collection local declared `null` blows up
    // on its first .add() with no Flow-side signal that anything is wrong.
    const ir = flow({
      declarations: [
        { name: 'Msg', kind: 'variable', dataType: 'String', isCollection: false,
          isInput: false, isOutput: false, sourceJson: '{}' },
        { name: 'ValidationMessages', kind: 'variable', dataType: 'String', isCollection: true,
          isInput: false, isOutput: false, sourceJson: '{}' },
      ],
      nodes: [{
        name: 'Add_Message', kind: 'assignments', connectors: [], sourceJson: '{}', raw: {},
        body: { kind: 'assignment', items: [
          { target: 'ValidationMessages', operator: 'AddItem', value: { kind: 'reference', raw: 'Msg' } },
        ] },
      }],
      start: { triggerKind: 'autolaunched', connector: { target: 'Add_Message', isFault: false }, sourceJson: '{}' },
    });
    const result = lowerFlow(ir);
    expect(result.source).toContain('List<String> ValidationMessages = new List<String>();');
    expect(result.source).toContain('ValidationMessages.add(Msg);');
  });

  it('leaves a scalar declaration null-initialised', () => {
    // Pre-constructing an SObject local would mask "no record found" — only
    // collections get an initialiser.
    const ir = flow({
      declarations: [{
        name: 'Acct', kind: 'variable', dataType: 'SObject', objectType: 'Account',
        isCollection: false, isInput: false, isOutput: false, sourceJson: '{}',
      }],
    });
    expect(lowerFlow(ir).source).toContain('Account Acct;');
  });

  it('does not re-declare a Get Records outputReference that is also a Flow declaration', () => {
    // "Manually store record data into a named variable" is the standard Get
    // Records configuration in Flow Builder. Pre-declaring the same name that
    // queryInto is about to declare produces "Variable already defined: Accts",
    // and the class never deploys.
    const ir = flow({
      declarations: [{
        name: 'Accts', kind: 'variable', dataType: 'SObject', objectType: 'Account',
        isCollection: true, isInput: false, isOutput: false, sourceJson: '{}',
      }],
      nodes: [{
        name: 'Get_Accounts', kind: 'recordlookups', connectors: [], sourceJson: '{}', raw: {},
        object: 'Account',
        body: {
          kind: 'record', object: 'Account', filters: [], inputAssignments: [],
          queriedFields: ['Id', 'Name'], getFirstRecordOnly: false,
          storeOutputAutomatically: false, outputReference: 'Accts', outputAssignments: [],
          assignNullValuesIfNoRecordsFound: false,
        },
      }],
      start: { triggerKind: 'autolaunched', connector: { target: 'Get_Accounts', isFault: false }, sourceJson: '{}' },
    });
    const result = lowerFlow(ir);
    expect(result.source).not.toMatch(/List<Account> Accts;/);
    expect(result.source.match(/List<Account> Accts/g)).toHaveLength(1);
    expect(result.source).toContain('List<Account> Accts = [');
  });

  it('does not re-declare a collection processor\'s iteration variable that is also a Flow declaration', () => {
    // Flow Builder declares a "currentItem_X" variable for a Filter/Sort/Map
    // element's iteration variable the same way it declares any other
    // variable, so it shows up in ir.declarations too. lowerCollectionProcessor
    // already emits it as the forEach loop's own iteration variable
    // (`for (T item : ...)` declares it) — pre-declaring the same name again
    // as a plain top-level local produces "Duplicate variable", confirmed by
    // the real compiler, not just a guess about Apex scoping rules.
    const ir = flow({
      declarations: [
        { name: 'Items', kind: 'variable', dataType: 'SObject', objectType: 'Account',
          isCollection: true, isInput: true, isOutput: false, sourceJson: '{}' },
        { name: 'currentItem_Filter', kind: 'variable', dataType: 'SObject', objectType: 'Account',
          isCollection: false, isInput: false, isOutput: false, sourceJson: '{}' },
      ],
      nodes: [{
        name: 'Filter', kind: 'collectionprocessors', connectors: [], sourceJson: '{}', raw: {},
        body: {
          kind: 'collectionProcessor', collection: 'Items', processorType: 'FilterCollectionProcessor',
          conditionLogic: 'and',
          conditions: [{ left: 'currentItem_Filter.Name', operator: 'IsNull', right: { kind: 'boolean', raw: 'false' } }],
          assignNextValueToReference: 'currentItem_Filter',
        },
      }],
      start: { triggerKind: 'autolaunched', connector: { target: 'Filter', isFault: false }, sourceJson: '{}' },
    });
    const result = lowerFlow(ir);
    expect(result.source.match(/Account currentItem_Filter/g)).toHaveLength(1);
    expect(result.source).toContain('for (Account currentItem_Filter : Items)');
  });

  it('refuses a Get Records outputReference that collides with an input parameter', () => {
    // The element would redeclare a parameter, which Apex also rejects.
    const ir = flow({
      declarations: [{
        name: 'Accts', kind: 'variable', dataType: 'SObject', objectType: 'Account',
        isCollection: true, isInput: true, isOutput: false, sourceJson: '{}',
      }],
      nodes: [{
        name: 'Get_Accounts', kind: 'recordlookups', connectors: [], sourceJson: '{}', raw: {},
        object: 'Account',
        body: {
          kind: 'record', object: 'Account', filters: [], inputAssignments: [],
          queriedFields: ['Id'], getFirstRecordOnly: false,
          storeOutputAutomatically: false, outputReference: 'Accts', outputAssignments: [],
          assignNullValuesIfNoRecordsFound: false,
        },
      }],
      start: { triggerKind: 'autolaunched', connector: { target: 'Get_Accounts', isFault: false }, sourceJson: '{}' },
    });
    expect(() => lowerFlow(ir)).toThrow(LoweringRefusal);
  });
});
