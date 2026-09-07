import { parseCollectionProcessorBody } from '../../../src/ir/bodies/collectionProcessorBody.js';

describe('parseCollectionProcessorBody', () => {
  // Real shape from exampleflow.xml:181-203 — Get_Pricing_Streams_for_this_Loan,
  // a FilterCollectionProcessor whose whole semantics previously lived only in `raw`.
  const filter = {
    name: 'Get_Pricing_Streams_for_this_Loan',
    elementsubtype: 'FilterCollectionProcessor',
    assignnextvaluetoreference: 'currentItem_Get_Pricing_Streams_for_this_Loan',
    collectionprocessortype: 'FilterCollectionProcessor',
    collectionreference: 'Get_Pricing_Streams_for_Loans',
    conditionlogic: 'and',
    conditions: {
      leftvaluereference: 'currentItem_Get_Pricing_Streams_for_this_Loan.LLC_BI__Loan__c',
      operator: 'EqualTo',
      rightvalue: { elementreference: 'Loop_over_Loans.Id' },
    },
    connector: { targetreference: 'Validate_Rates_and_Payments_components_on_Loan' },
  };

  it('reads the collection it filters', () => {
    expect(parseCollectionProcessorBody(filter).collection).toBe('Get_Pricing_Streams_for_Loans');
  });

  it('reads the processor type', () => {
    expect(parseCollectionProcessorBody(filter).processorType).toBe('FilterCollectionProcessor');
  });

  it('reads the condition logic and a single condition, which xml2js does not wrap in an array', () => {
    const body = parseCollectionProcessorBody(filter);
    expect(body.conditionLogic).toBe('and');
    expect(body.conditions).toHaveLength(1);
    expect(body.conditions[0]).toEqual({
      left: 'currentItem_Get_Pricing_Streams_for_this_Loan.LLC_BI__Loan__c',
      operator: 'EqualTo',
      right: { kind: 'reference', raw: 'Loop_over_Loans.Id' },
    });
  });

  it('reads the current-item variable', () => {
    expect(parseCollectionProcessorBody(filter).assignNextValueToReference)
      .toBe('currentItem_Get_Pricing_Streams_for_this_Loan');
  });

  it('yields an empty condition list for a processor with none', () => {
    expect(parseCollectionProcessorBody({ collectionreference: 'C' }).conditions).toEqual([]);
  });
});
