import {
  BOOLEAN, DATE, DATETIME, DECIMAL, ID, INTEGER, OBJECT, STRING,
  isComparable, isUntyped, listOf, renderType, sobjectType,
} from '../../src/apex/types.js';

describe('renderType', () => {
  it('renders scalars', () => {
    expect(renderType(ID)).toBe('Id');
    expect(renderType(STRING)).toBe('String');
    expect(renderType(DECIMAL)).toBe('Decimal');
    expect(renderType(OBJECT)).toBe('Object');
  });

  it('renders a named SObject and the generic one', () => {
    expect(renderType(sobjectType('LLC_BI__Loan__c'))).toBe('LLC_BI__Loan__c');
    expect(renderType(sobjectType())).toBe('SObject');
  });

  it('renders a list of a type', () => {
    expect(renderType(listOf(sobjectType('Account')))).toBe('List<Account>');
    expect(renderType(listOf(listOf(ID)))).toBe('List<List<Id>>');
  });
});

describe('isComparable', () => {
  it('accepts the types Apex can order', () => {
    for (const t of [DECIMAL, INTEGER, DATE, DATETIME]) {
      expect(isComparable(t)).toBe(true);
    }
  });

  it('accepts String, which Apex orders lexicographically', () => {
    // Verified against the compiler: `'apple' < 'banana'` compiles and is true.
    // This module previously refused it on an unverified assumption.
    expect(isComparable(STRING)).toBe(true);
  });

  it('accepts Id, which Apex also orders', () => {
    expect(isComparable(ID)).toBe(true);
  });

  it('rejects Object, which is what record.get() returns', () => {
    // This is the whole defence against `record.get('X') > 1000`.
    expect(isComparable(OBJECT)).toBe(false);
  });

  it('rejects Boolean and SObject, which Apex cannot order', () => {
    expect(isComparable(BOOLEAN)).toBe(false);
    expect(isComparable(sobjectType('Account'))).toBe(false);
  });
});

describe('isUntyped', () => {
  it('identifies Object and nothing else', () => {
    expect(isUntyped(OBJECT)).toBe(true);
    expect(isUntyped(STRING)).toBe(false);
    expect(isUntyped(sobjectType())).toBe(false);
  });
});
