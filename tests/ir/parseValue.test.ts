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

  // toArray's declared return type is Record<string, unknown>[], but queriedFields is
  // an example of a Flow field whose entries are bare strings, not objects — runtime
  // behaviour is correct (it wraps/passes through whatever it is given), the cast is
  // just not type-sound for every caller. These cases exercise that caller.
  it('wraps a single bare string, as a single queriedFields entry arrives from xml2js', () => {
    expect(toArray('Id')).toEqual(['Id']);
  });
  it('passes an array of bare strings through, as multiple queriedFields entries arrive', () => {
    expect(toArray(['Id', 'Name'])).toEqual(['Id', 'Name']);
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
  it('reads a date value', () => {
    expect(readValue({ datevalue: '2026-01-01' })).toEqual({ kind: 'date', raw: '2026-01-01' });
  });
  it('reads a datetime value', () => {
    expect(readValue({ datetimevalue: '2026-01-01T00:00:00.000Z' }))
      .toEqual({ kind: 'datetime', raw: '2026-01-01T00:00:00.000Z' });
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
