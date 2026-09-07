import {
  parseActionBody, parseLoopBody, parseSubflowBody,
} from '../../../src/ir/bodies/flowControlBody.js';

describe('parseLoopBody', () => {
  it('reads the collection it iterates and the order', () => {
    // Real shape from exampleflow.xml.
    const body = parseLoopBody({
      name: 'Loop_over_Loans',
      collectionreference: 'Get_Loan_IDs_from_input_records',
      iterationorder: 'Asc',
      nextvalueconnector: { targetreference: 'Validate' },
    });
    expect(body.collection).toBe('Get_Loan_IDs_from_input_records');
    expect(body.iterationOrder).toBe('Asc');
    expect(body.bodyTarget).toBe('Validate');
  });

  it('reads the after-loop target when present', () => {
    const body = parseLoopBody({
      collectionreference: 'C',
      nomorevaluesconnector: { targetreference: 'After_Loop' },
    });
    expect(body.afterTarget).toBe('After_Loop');
  });

  it('reads the iteration variable', () => {
    // exampleflow.xml's own Loop_over_Loans has no assignNextValueToReference, but its
    // sibling collectionProcessor (Get_Pricing_Streams_for_this_Loan) uses the same
    // field on the same element family — this reuses that real value on a loop shape.
    const body = parseLoopBody({
      collectionreference: 'LoansInPP',
      assignnextvaluetoreference: 'currentItem_Get_Pricing_Streams_for_this_Loan',
    });
    expect(body.iterationVariable).toBe('currentItem_Get_Pricing_Streams_for_this_Loan');
  });
});

describe('parseSubflowBody', () => {
  // Real shape from exampleflow.xml.
  const subflow = {
    name: 'Validate_Key_Loan_Dates',
    flowname: 'Key_Loan_Date_Validation',
    inputassignments: [
      { name: 'LoanId', value: { elementreference: 'Loop_over_Loans.Id' } },
      { name: 'SettlementDate', value: { elementreference: 'Loop_over_Loans.LLC_BI__CloseDate__c' } },
    ],
    outputassignments: { name: 'ValidationMessage', assigntoreference: 'BS20ErrorMessages' },
  };

  it('reads the referenced flow name', () => {
    expect(parseSubflowBody(subflow).flowName).toBe('Key_Loan_Date_Validation');
  });

  it('reads every input binding', () => {
    const inputs = parseSubflowBody(subflow).inputs;
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toEqual({
      name: 'LoanId', value: { kind: 'reference', raw: 'Loop_over_Loans.Id' }, target: undefined,
    });
  });

  it('reads an output binding and where it lands', () => {
    const outputs = parseSubflowBody(subflow).outputs;
    expect(outputs).toHaveLength(1);
    expect(outputs[0].name).toBe('ValidationMessage');
    expect(outputs[0].target).toBe('BS20ErrorMessages');
  });

  it('distinguishes an auto-stored output from genuinely no output, same as an action', () => {
    expect(parseSubflowBody(subflow).storeOutputAutomatically).toBe(false);
    expect(parseSubflowBody({ ...subflow, storeoutputautomatically: 'true' }).storeOutputAutomatically).toBe(true);
  });
});

describe('parseActionBody', () => {
  it('reads the action name and type', () => {
    // Real shape from exampleflow.xml.
    const body = parseActionBody({
      name: 'Get_Loan_IDs_from_input_records',
      actionname: 'GetIdsFromRecords',
      actiontype: 'apex',
      inputparameters: { name: 'inputList', value: { elementreference: 'Loans' } },
    });
    expect(body.actionName).toBe('GetIdsFromRecords');
    expect(body.actionType).toBe('apex');
    expect(body.inputs).toHaveLength(1);
    expect(body.inputs[0].name).toBe('inputList');
  });

  it('distinguishes an auto-stored output from genuinely no output', () => {
    // Real shape from exampleflow.xml:3-27 — Get_Loan_IDs_from_input_records has
    // storeOutputAutomatically true and no outputParameters at all. Without reading
    // storeOutputAutomatically, this is indistinguishable from an action that returns
    // nothing, even though the next element (a recordLookups filter) references its result.
    const body = parseActionBody({
      name: 'Get_Loan_IDs_from_input_records',
      actionname: 'GetIdsFromRecords',
      actiontype: 'apex',
      storeoutputautomatically: 'true',
      datatypemappings: { typename: 'T__inputList', typevalue: 'LLC_BI__Loan__c' },
      inputparameters: { name: 'inputList', value: { elementreference: 'LoansInPP' } },
    });
    expect(body.outputs).toEqual([]);
    expect(body.storeOutputAutomatically).toBe(true);
  });

  it('reads the generic type argument from dataTypeMappings', () => {
    // Real shape from exampleflow.xml:14-17.
    const body = parseActionBody({
      name: 'Get_Loan_IDs_from_input_records',
      actionname: 'GetIdsFromRecords',
      actiontype: 'apex',
      datatypemappings: { typename: 'T__inputList', typevalue: 'LLC_BI__Loan__c' },
    });
    expect(body.dataTypeMappings).toEqual([
      { typeName: 'T__inputList', typeValue: 'LLC_BI__Loan__c' },
    ]);
  });

  it('reports storeOutputAutomatically false and no output when the action genuinely returns nothing', () => {
    const body = parseActionBody({ name: 'Send_Email', actionname: 'emailSimple', actiontype: 'emailSimple' });
    expect(body.outputs).toEqual([]);
    expect(body.storeOutputAutomatically).toBe(false);
  });
});
