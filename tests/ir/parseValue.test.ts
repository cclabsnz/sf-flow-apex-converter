import { parseCondition, readValue, toArray } from '../../src/ir/parseValue.js';

describe('toArray', () => {
  it('wraps a single xml2js object', () => {
    expect(toArray({ a: 1 })).toEqual([{ a: 1 }]);
  });
  it('passes an array through', () => {
    expect(toArray([{ a: 1 }, { a: 2 }])).toHaveLength(2);
  });
  it('treats absent as empty', () => {
    expect(toArray(undefined)).toEqual([]);
    expect(toArray(null)).toEqual([]);
  });
});

describe('readValue', () => {
  it('reads each literal variant', () => {
    expect(readValue({ stringvalue: 'x' })).toEqual({ kind: 'string', raw: 'x' });
    expect(readValue({ numbervalue: 3 })).toEqual({ kind: 'number', raw: '3' });
    expect(readValue({ booleanvalue: 'false' })).toEqual({ kind: 'boolean', raw: 'false' });
  });
  it('reads an element reference', () => {
    expect(readValue({ elementreference: 'Loop_over_Loans.Amount__c' }))
      .toEqual({ kind: 'reference', raw: 'Loop_over_Loans.Amount__c' });
  });
  it('returns kind none for an absent container', () => {
    expect(readValue(undefined)).toEqual({ kind: 'none' });
  });
});

describe('parseCondition', () => {
  it('reads a Flow condition into left/operator/right', () => {
    // Real shape from exampleflow.xml.
    const c = parseCondition({
      leftvaluereference: 'BS20ErrorMessages',
      operator: 'IsNull',
      rightvalue: { booleanvalue: 'false' },
    });
    expect(c.left).toBe('BS20ErrorMessages');
    expect(c.operator).toBe('IsNull');
    expect(c.right).toEqual({ kind: 'boolean', raw: 'false' });
  });

  it('defaults a missing operator rather than inventing one', () => {
    const c = parseCondition({ leftvaluereference: 'X' });
    expect(c.operator).toBe('');
    expect(c.right).toEqual({ kind: 'none' });
  });
});
