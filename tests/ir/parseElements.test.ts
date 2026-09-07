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

  it('records a choice as unsupported instead of dropping it', () => {
    const { nodes, unsupported } = parseElements({
      choices: { name: 'Yes_No_Choice', label: 'Yes or No' },
    });
    expect(nodes).toHaveLength(0);
    expect(unsupported).toHaveLength(1);
    expect(unsupported[0].kind).toBe('choices');
    expect(unsupported[0].name).toBe('Yes_No_Choice');
  });

  it('records a dynamicChoiceSet as unsupported instead of dropping it', () => {
    const { nodes, unsupported } = parseElements({
      dynamicchoicesets: { name: 'Account_Choices', object: 'Account' },
    });
    expect(nodes).toHaveLength(0);
    expect(unsupported).toHaveLength(1);
    expect(unsupported[0].kind).toBe('dynamicchoicesets');
    expect(unsupported[0].name).toBe('Account_Choices');
  });

  it('records a nameless unmodelled element as unsupported instead of skipping it', () => {
    // A malformed <screens> with no <name> must still surface — silently skipping it
    // here would be exactly the "vanishes entirely" bug this IR exists to prevent.
    const { nodes, unsupported } = parseElements({
      screens: { label: 'No name given' },
    });
    expect(nodes).toHaveLength(0);
    expect(unsupported).toHaveLength(1);
    expect(unsupported[0].kind).toBe('screens');
    expect(unsupported[0].name).toBeUndefined();
  });

  it('still skips a nameless entry for a modelled type, since it is not element-shaped', () => {
    const { nodes, unsupported } = parseElements({
      assignments: { label: 'No name given' },
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
