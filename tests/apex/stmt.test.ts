import { ApexTypeError } from '../../src/apex/errors.js';
import { comparison, literal, methodCall, variable } from '../../src/apex/expr.js';
import { soql } from '../../src/apex/soql.js';
import { assign, declare, ifThen, invoke, memberWrite, queryInto } from '../../src/apex/stmt.js';
import { emitStmt } from '../../src/apex/emit.js';
import {
  BOOLEAN, DATE, DATETIME, DECIMAL, ID, INTEGER, OBJECT, STRING, listOf, sobjectType,
} from '../../src/apex/types.js';

describe('declare', () => {
  it('refuses an initialiser Apex cannot assign to the declared type', () => {
    // `Decimal total = 'oops';` compiles nowhere: the org rejects it with
    // "Illegal assignment from String to Decimal". The tree must not be buildable.
    expect(() => declare(DECIMAL, 'total', literal(STRING, "'oops'")))
      .toThrow(ApexTypeError);
  });

  it('refuses an untyped initialiser, which is what record.get() returns', () => {
    // Assigning Object to a typed variable needs an explicit cast in Apex.
    expect(() => declare(DECIMAL, 'amount', variable(OBJECT, 'raw')))
      .toThrow(ApexTypeError);
  });

  it('allows the widening Apex actually permits', () => {
    // Verified against the compiler: Integer -> Decimal, Id <-> String,
    // Date -> Datetime all assign cleanly.
    expect(() => declare(DECIMAL, 'd', literal(INTEGER, '1'))).not.toThrow();
    expect(() => declare(STRING, 's', variable(ID, 'recordId'))).not.toThrow();
    expect(() => declare(ID, 'x', variable(STRING, 's'))).not.toThrow();
    expect(() => declare(DATETIME, 'dt', variable(DATE, 'd'))).not.toThrow();
  });

  it('refuses the narrowing Apex rejects', () => {
    // Decimal -> Integer is rejected by the compiler; Integer -> String too.
    expect(() => declare(INTEGER, 'i', variable(DECIMAL, 'd'))).toThrow(ApexTypeError);
    expect(() => declare(STRING, 's', literal(INTEGER, '1'))).toThrow(ApexTypeError);
  });

  it('allows anything to be assigned to Object', () => {
    expect(() => declare(OBJECT, 'o', literal(STRING, "'hello'"))).not.toThrow();
  });

  it('allows a matching List and rejects a mismatched element type', () => {
    const accounts = variable(listOf(sobjectType('Account')), 'accounts');
    expect(() => declare(listOf(sobjectType('Account')), 'a', accounts)).not.toThrow();
    expect(() => declare(listOf(sobjectType('Contact')), 'c', accounts))
      .toThrow(ApexTypeError);
  });

  it('still allows a declaration with no initialiser', () => {
    expect(() => declare(listOf(sobjectType('Account')), 'toUpdate', null)).not.toThrow();
  });
});

describe('ifThen', () => {
  it('refuses a non-Boolean condition', () => {
    // `if (5)` is not C. The org rejects it: "Condition expression must be of
    // type Boolean: Integer".
    expect(() => ifThen(literal(DECIMAL, '5'), [assign('total', literal(DECIMAL, '1'))]))
      .toThrow(ApexTypeError);
  });

  it('refuses an untyped condition', () => {
    expect(() => ifThen(variable(OBJECT, 'raw'), [])).toThrow(ApexTypeError);
  });

  it('accepts a Boolean condition', () => {
    expect(() => ifThen(variable(BOOLEAN, 'isReady'), [])).not.toThrow();
  });
});

describe('assign', () => {
  it('refuses an untyped value', () => {
    // Not via fieldRead — that refuses OBJECT itself, so it would pass without
    // assign checking anything. A bare Object variable reaches assign untouched.
    expect(() => assign('total', variable(OBJECT, 'raw'))).toThrow(ApexTypeError);
  });
});

describe('queryInto', () => {
  const accountQuery = soql({ object: 'Account', fields: ['Id'] });

  it('refuses a target that is not a List of SObject', () => {
    // `Integer n = [SELECT ...];` does not compile.
    expect(() => queryInto(INTEGER, 'n', accountQuery)).toThrow(ApexTypeError);
    expect(() => queryInto(sobjectType('Account'), 'a', accountQuery)).toThrow(ApexTypeError);
  });

  it('refuses a target whose object disagrees with the query', () => {
    // soql() exists so a query names its own object (DEFECT 3). Letting the
    // variable say Contact while the query says FROM Account reopens that door.
    expect(() => queryInto(listOf(sobjectType('Contact')), 'cs', accountQuery))
      .toThrow(ApexTypeError);
  });

  it('accepts a matching target, matching case-insensitively', () => {
    expect(() => queryInto(listOf(sobjectType('Account')), 'accts', accountQuery))
      .not.toThrow();
    expect(() => queryInto(listOf(sobjectType('account')), 'accts', accountQuery))
      .not.toThrow();
    expect(() => queryInto(listOf(sobjectType()), 'records', accountQuery)).not.toThrow();
  });
});

describe('memberWrite', () => {
  it('writes a member on an Apex-defined type', () => {
    // ValidationMessage.Message = errorText;  — not an SObject, so put() is wrong.
    expect(emitStmt(memberWrite('msg', 'Message', variable(STRING, 'errorText'))))
      .toBe('msg.Message = errorText;');
  });

  it('refuses an invalid target identifier', () => {
    // A dotted name smuggled in as the target would emit a.b.c = x with no check.
    expect(() => memberWrite('msg.inner', 'Message', variable(STRING, 'x')))
      .toThrow(ApexTypeError);
  });

  it('refuses an invalid member name', () => {
    expect(() => memberWrite('msg', '2Message', variable(STRING, 'x')))
      .toThrow(ApexTypeError);
  });

  it('refuses an untyped value', () => {
    expect(() => memberWrite('msg', 'Message', variable(OBJECT, 'raw')))
      .toThrow(ApexTypeError);
  });
});

describe('invoke', () => {
  it('emits a method call as a statement', () => {
    expect(emitStmt(invoke(methodCall(variable(listOf(STRING), 'msgs'), 'clear', [], BOOLEAN))))
      .toBe('msgs.clear();');
  });

  it('refuses an expression Apex cannot use as a statement', () => {
    // `amount > 1000;` is not a statement. Only a call is.
    expect(() => invoke(comparison(variable(DECIMAL, 'amount'), '>', literal(DECIMAL, '1000'))))
      .toThrow(ApexTypeError);
    expect(() => invoke(variable(STRING, 'name'))).toThrow(ApexTypeError);
  });
});
