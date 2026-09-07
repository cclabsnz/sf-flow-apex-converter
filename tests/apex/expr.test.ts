import { ApexTypeError } from '../../src/apex/errors.js';
import {
  comparison, equality, fieldRead, literal, logical, methodCall, nullTest, variable,
} from '../../src/apex/expr.js';
import { BOOLEAN, DECIMAL, ID, OBJECT, STRING, sobjectType } from '../../src/apex/types.js';

describe('fieldRead', () => {
  it('carries the type it was told, never Object', () => {
    const e = fieldRead('record', 'LLC_BI__Amount__c', DECIMAL);
    expect(e.type).toEqual(DECIMAL);
  });

  it('refuses to produce an untyped read', () => {
    // A field read with no known type is the input to every defect this module
    // exists to prevent. Callers must resolve the type first.
    expect(() => fieldRead('record', 'X__c', OBJECT)).toThrow(ApexTypeError);
  });
});

describe('comparison', () => {
  it('accepts two comparable operands', () => {
    const e = comparison(fieldRead('record', 'Amount__c', DECIMAL), '>', literal(DECIMAL, '1000'));
    expect(e.type).toEqual(BOOLEAN);
  });

  it('refuses an untyped left operand', () => {
    // This is `record.get('Amount__c') > 1000`, the original defect.
    expect(() =>
      comparison(variable(OBJECT, 'raw'), '>', literal(DECIMAL, '1000'))
    ).toThrow(ApexTypeError);
  });

  it('refuses to order a String', () => {
    expect(() =>
      comparison(literal(STRING, "'a'"), '<', literal(STRING, "'b'"))
    ).toThrow(ApexTypeError);
  });

  it('refuses a Boolean operand', () => {
    expect(() =>
      comparison(literal(BOOLEAN, 'true'), '>=', literal(BOOLEAN, 'false'))
    ).toThrow(ApexTypeError);
  });
});

describe('equality', () => {
  it('compares two values of the same type', () => {
    expect(equality(literal(STRING, "'a'"), '==', literal(STRING, "'b'")).type).toEqual(BOOLEAN);
  });

  it('still refuses an untyped operand', () => {
    expect(() => equality(variable(OBJECT, 'raw'), '==', literal(ID, "'001'"))).toThrow(ApexTypeError);
  });
});

describe('nullTest', () => {
  it('is unary — there is no right-hand side to leave dangling', () => {
    // `x == null 1000` was only possible because a template pasted three parts.
    const e = nullTest(variable(STRING, 'name'), false);
    expect(e.node).toBe('nullTest');
    expect(e.type).toEqual(BOOLEAN);
  });

  it('accepts an untyped operand, because null-testing one is valid Apex', () => {
    expect(() => nullTest(variable(OBJECT, 'raw'), true)).not.toThrow();
  });
});

describe('methodCall', () => {
  it('is the only way to express contains', () => {
    // There is no infix operator to misuse, so `a contains 'x'` cannot be built.
    const e = methodCall(variable(STRING, 'name'), 'contains', [literal(STRING, "'x'")], BOOLEAN);
    expect(e.node).toBe('methodCall');
    expect(e.method).toBe('contains');
  });
});

describe('logical', () => {
  it('joins boolean operands', () => {
    const a = equality(literal(STRING, "'a'"), '==', literal(STRING, "'b'"));
    expect(logical('&&', [a, a]).type).toEqual(BOOLEAN);
  });

  it('refuses a non-boolean operand', () => {
    expect(() => logical('&&', [literal(DECIMAL, '1')])).toThrow(ApexTypeError);
  });

  it('refuses an SObject operand', () => {
    expect(() => logical('||', [variable(sobjectType('Account'), 'a')])).toThrow(ApexTypeError);
  });
});
