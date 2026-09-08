import {
  BOOLEAN, DATE, DATETIME, DECIMAL, ID, INTEGER, NULL, OBJECT, STRING, isAssignable,
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

  it('refuses to order anything against null', () => {
    expect(isComparable(NULL)).toBe(false);
  });
});

describe('isUntyped', () => {
  it('identifies Object and nothing else', () => {
    expect(isUntyped(OBJECT)).toBe(true);
    expect(isUntyped(STRING)).toBe(false);
    expect(isUntyped(sobjectType())).toBe(false);
  });
});

describe('isAssignable', () => {
  it('matches SObject names case-insensitively, because Apex does', () => {
    // `Account a = ...; account b = a;` compiles. The Flow XML supplies whatever
    // the admin typed while a describe supplies canonical casing, so these differ
    // in practice. Rejecting the pair would block a legitimate conversion.
    expect(isAssignable(sobjectType('Account'), sobjectType('account'))).toBe(true);
    expect(isAssignable(sobjectType('LLC_BI__Loan__c'), sobjectType('llc_bi__loan__c')))
      .toBe(true);
  });

  it('assigns a List in either direction when the elements are related', () => {
    // Verified against the compiler: Apex accepts List<Account> -> List<SObject>
    // AND List<SObject> -> List<Account>, plus List<Integer> -> List<Decimal>.
    expect(isAssignable(listOf(sobjectType('Account')), listOf(sobjectType()))).toBe(true);
    expect(isAssignable(listOf(sobjectType()), listOf(sobjectType('Account')))).toBe(true);
    expect(isAssignable(listOf(DECIMAL), listOf(INTEGER))).toBe(true);
  });

  it('refuses a List of unrelated elements', () => {
    // These the compiler does reject.
    expect(isAssignable(listOf(sobjectType('Contact')), listOf(sobjectType('Account'))))
      .toBe(false);
    expect(isAssignable(listOf(INTEGER), listOf(STRING))).toBe(false);
    expect(isAssignable(listOf(BOOLEAN), listOf(STRING))).toBe(false);
  });

  it('assigns null to every type', () => {
    // `Decimal d = null;` compiles; typing null as String made isAssignable
    // refuse it, which would have blocked legal assignments during lowering.
    for (const t of [DECIMAL, INTEGER, BOOLEAN, DATE, ID, STRING, sobjectType('Account'), listOf(ID)]) {
      expect(isAssignable(t, NULL)).toBe(true);
    }
  });
});
