import { parseRecordBody } from '../../../src/ir/bodies/recordBody.js';

describe('parseRecordBody', () => {
  // Shape taken from exampleflow.xml's Get_Pricing_Streams_for_Loans lookup.
  const lookup = {
    name: 'Get_Pricing_Streams_for_Loans',
    object: 'LLC_BI__Pricing_Stream__c',
    filterlogic: 'and',
    filters: {
      field: 'LLC_BI__Loan__c',
      operator: 'In',
      value: { elementreference: 'Get_Loan_IDs_from_input_records' },
    },
    getfirstrecordonly: 'false',
    storeoutputautomatically: 'true',
  };

  it('reads the object the Flow declares', () => {
    expect(parseRecordBody(lookup).object).toBe('LLC_BI__Pricing_Stream__c');
  });

  it('reads a single filter, which xml2js does not wrap in an array', () => {
    const filters = parseRecordBody(lookup).filters;
    expect(filters).toHaveLength(1);
    expect(filters[0].left).toBe('LLC_BI__Loan__c');
    expect(filters[0].operator).toBe('In');
    expect(filters[0].right).toEqual({
      kind: 'reference', raw: 'Get_Loan_IDs_from_input_records',
    });
  });

  it('reads multiple filters', () => {
    const body = parseRecordBody({
      ...lookup,
      filters: [
        { field: 'A__c', operator: 'EqualTo', value: { stringvalue: 'x' } },
        { field: 'B__c', operator: 'GreaterThan', value: { numbervalue: 5 } },
      ],
    });
    expect(body.filters.map((f) => f.left)).toEqual(['A__c', 'B__c']);
  });

  it('reads the filter logic and the cardinality flags', () => {
    const body = parseRecordBody(lookup);
    expect(body.filterLogic).toBe('and');
    expect(body.getFirstRecordOnly).toBe(false);
    expect(body.storeOutputAutomatically).toBe(true);
  });

  it('reads the fields a create or update assigns', () => {
    const body = parseRecordBody({
      object: 'Account',
      inputassignments: [
        { field: 'Name', value: { stringvalue: 'Acme' } },
        { field: 'Rating', value: { elementreference: 'Var_Rating' } },
      ],
    });
    expect(body.inputAssignments).toEqual([
      { field: 'Name', value: { kind: 'string', raw: 'Acme' } },
      { field: 'Rating', value: { kind: 'reference', raw: 'Var_Rating' } },
    ]);
  });

  it('yields empty collections rather than undefined for an element with no filters', () => {
    const body = parseRecordBody({ object: 'Account' });
    expect(body.filters).toEqual([]);
    expect(body.inputAssignments).toEqual([]);
  });
});
