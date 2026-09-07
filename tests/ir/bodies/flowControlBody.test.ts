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
});
