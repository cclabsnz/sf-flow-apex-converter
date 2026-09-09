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

  it('refuses a Flow name longer than Apex\'s 40-character class-name limit', () => {
    // Verified against the org: a 41-character class name fails with
    // "Identifier name is too long"; 40 deploys. Unlike a subflow reference,
    // this converter DOES generate the main class, so truncation is
    // technically available — but separate CLI invocations share no Scope,
    // so a truncated name risks a silent collision across unrelated Flows,
    // and it changes the artifact's identity without the user asking.
    // Refuse instead, consistent with this project's preference throughout.
    const longName = 'A'.repeat(41);
    expect(() => lowerFlow(flow({ flowName: longName }))).toThrow(LoweringRefusal);
  });

  it('accepts a Flow name exactly at the 40-character limit', () => {
    const fortyChars = 'A'.repeat(40);
    expect(lowerFlow(flow({ flowName: fortyChars })).apexClass.name).toBe(fortyChars);
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

  it('declares a Get Records outputReference once, at the top level, and assigns into it', () => {
    // "Manually store record data into a named variable" is the standard Get
    // Records configuration in Flow Builder. The name is BOTH a Flow
    // declaration and element-owned, so it gets its one top-level declaration
    // and the element assigns into it. Letting the element declare it instead
    // is only correct when the element sits at the method's top level; inside
    // an if or a for it block-scopes the name and every later reference is
    // "Variable does not exist".
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
    expect(result.source.match(/List<Account> Accts/g)).toHaveLength(1);
    expect(result.source).toContain('List<Account> Accts = new List<Account>();');
    expect(result.source).toContain('Accts = [');
    expect(result.source).not.toContain('List<Account> Accts = [');
  });

  it('declares a collection processor\'s iteration variable once, and assigns into it', () => {
    // Flow Builder declares a "currentItem_X" variable for a Filter/Sort/Map
    // element's iteration variable the same way it declares any other
    // variable, so it shows up in ir.declarations too. It therefore gets its
    // top-level declaration; the for-each iterates a separate, element-owned
    // identifier and copies each item into the declared name. Declaring it in
    // the for-each header instead is "Variable already defined" against the
    // top-level declaration, and omitting the top-level declaration puts it
    // out of scope for anything after the element.
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
    expect(result.source.match(/Account currentItem_Filter\b/g)).toHaveLength(1);
    expect(result.source).toContain('Account currentItem_Filter;');
    expect(result.source).not.toContain('for (Account currentItem_Filter : Items)');
    expect(result.source).toMatch(/for \(Account (\w+) : Items\) \{\n\s+currentItem_Filter = \1;/);
  });

  it('assigns into an input parameter a Get Records also outputs to', () => {
    // Apex method parameters are not final, so the element assigning into the
    // parameter compiles. This used to be refused because the element declared
    // its own name; with the declaration inverted there is nothing to refuse.
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
    const result = lowerFlow(ir);
    expect(result.source).toContain('execute(List<Account> Accts)');
    expect(result.source).toContain('Accts = [');
    expect(result.source).not.toContain('List<Account> Accts = [');
  });

  it('keeps an element-owned declaration inside a nested block in scope afterwards', () => {
    // "Get Records inside a decision branch" is one of the most common Flow
    // shapes. When the element declared its own output variable, that
    // declaration was scoped to the if-block and every later reference —
    // including the Result assembly — was out of scope. Compiler-confirmed:
    // "Variable does not exist: Found".
    const ir = flow({
      declarations: [
        { name: 'Flag', kind: 'variable', dataType: 'Boolean', isCollection: false,
          isInput: true, isOutput: false, sourceJson: '{}' },
        { name: 'Found', kind: 'variable', dataType: 'SObject', objectType: 'Account',
          isCollection: true, isInput: false, isOutput: true, sourceJson: '{}' },
      ],
      nodes: [
        { name: 'D', kind: 'decisions', sourceJson: '{}', raw: {},
          connectors: [{ target: 'Get_Accounts', isFault: false }, { target: 'J', isFault: false }],
          body: {
            kind: 'decision',
            rules: [{ name: 'Yes', conditionLogic: 'and', target: 'Get_Accounts',
              conditions: [{ left: 'Flag', operator: 'EqualTo', right: { kind: 'boolean', raw: 'true' } }] }],
            defaultTarget: 'J',
          } },
        { name: 'Get_Accounts', kind: 'recordlookups', object: 'Account', sourceJson: '{}', raw: {},
          connectors: [{ target: 'J', isFault: false }],
          body: {
            kind: 'record', object: 'Account', filters: [], inputAssignments: [],
            queriedFields: ['Id', 'Name'], getFirstRecordOnly: false,
            storeOutputAutomatically: false, outputReference: 'Found', outputAssignments: [],
            assignNullValuesIfNoRecordsFound: false,
          } },
        { name: 'J', kind: 'assignments', connectors: [], sourceJson: '{}', raw: {},
          body: { kind: 'assignment', items: [] } },
      ],
      start: { triggerKind: 'autolaunched', connector: { target: 'D', isFault: false }, sourceJson: '{}' },
    });
    const source = lowerFlow(ir).source;
    const lines = source.split('\n');
    const declaredAt = lines.findIndex((l) => /^\s{8}List<Account> Found = new List<Account>\(\);$/.test(l));
    const assignedAt = lines.findIndex((l) => /^\s+Found = \[$/.test(l));
    // Declared at method top level (two indents), not inside the if-block.
    expect(declaredAt).toBeGreaterThanOrEqual(0);
    expect(assignedAt).toBeGreaterThan(declaredAt);
    expect(source).not.toContain('List<Account> Found = [');
    // The Result assembly reads it after the branch closes.
    expect(source).toContain('result.Found = Found;');
  });
});

describe('lowerFlow and Flow behaviour the output does not reproduce', () => {
  it('carries a lowering note into the manifest and the class header', () => {
    // A note must reach BOTH, the same way a guess does. A note recorded in
    // ctx.notes and rendered nowhere is the silent drop it exists to prevent.
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
          queriedFields: ['Id'], getFirstRecordOnly: false,
          storeOutputAutomatically: false, outputReference: 'Accts', outputAssignments: [],
          assignNullValuesIfNoRecordsFound: false,
        },
      }],
      start: { triggerKind: 'autolaunched', connector: { target: 'Get_Accounts', isFault: false }, sourceJson: '{}' },
    });
    const { source, manifest } = lowerFlow(ir);
    expect(manifest.notes.length).toBeGreaterThan(0);
    expect(manifest.notes.join(' ')).toContain('Get_Accounts');
    expect(source).toContain('Flow behaviour NOT reproduced exactly:');
    expect(source).toContain(manifest.notes[0]);
  });
});
