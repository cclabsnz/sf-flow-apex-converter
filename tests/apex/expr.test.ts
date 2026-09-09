import { ApexTypeError } from '../../src/apex/errors.js';
import {
  comparison, construct, equality, fieldRead, literal, logical, methodCall, nullTest, staticCall,
  stringLiteral, ternary, variable,
} from '../../src/apex/expr.js';
import { emitExpr } from '../../src/apex/emit.js';
import { declare } from '../../src/apex/stmt.js';
import { BOOLEAN, DATE, DECIMAL, ID, INTEGER, NULL, OBJECT, STRING, listOf, sobjectType } from '../../src/apex/types.js';

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

  it('orders a String, which Apex compares lexicographically', () => {
    const e = comparison(literal(STRING, "'a'"), '<', literal(STRING, "'b'"));
    expect(e.type).toEqual(BOOLEAN);
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
    // Narrow before reading a variant-specific field: methodCall returns the
    // ApexExpr union, like every other constructor in this module.
    if (e.node !== 'methodCall') throw new Error('expected a methodCall node');
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

describe('operand compatibility', () => {
  it('refuses to order two types Apex cannot compare with each other', () => {
    // Each side is individually orderable, so a per-operand check passes both.
    // The org rejects the pair: "Comparison arguments must be compatible types".
    expect(() => comparison(variable(STRING, 's'), '<', variable(DATE, 'd')))
      .toThrow(ApexTypeError);
    expect(() => comparison(variable(ID, 'a'), '<', variable(DECIMAL, 'n')))
      .toThrow(ApexTypeError);
  });

  it('refuses to equate two unrelated types', () => {
    expect(() => equality(variable(INTEGER, 'i'), '==', variable(sobjectType('Account'), 'a')))
      .toThrow(ApexTypeError);
    expect(() => equality(variable(BOOLEAN, 'b'), '==', variable(listOf(ID), 'ids')))
      .toThrow(ApexTypeError);
  });

  it('still allows the compatible pairs Apex accepts', () => {
    expect(() => comparison(variable(INTEGER, 'i'), '<', variable(DECIMAL, 'd'))).not.toThrow();
    expect(() => comparison(variable(ID, 'a'), '<', variable(STRING, 's'))).not.toThrow();
    expect(() => equality(variable(STRING, 's'), '==', variable(ID, 'a'))).not.toThrow();
  });
});

describe('logical arity', () => {
  it('refuses an empty operand list', () => {
    // Joining nothing produced `if () { ... }`, which is a syntax error.
    expect(() => logical('&&', [])).toThrow(ApexTypeError);
  });

  it('accepts a single operand', () => {
    expect(() => logical('&&', [variable(BOOLEAN, 'b')])).not.toThrow();
  });
});

describe('literal', () => {
  it('refuses text that is not a single atom', () => {
    // literal text is spliced in verbatim and never parenthesised, so a compound
    // expression here re-parses and defeats the precedence guarantee entirely:
    // logical('&&', [literal(BOOLEAN, 'a || b'), c]) emitted `a || b && c`.
    expect(() => literal(BOOLEAN, 'a || b')).toThrow(ApexTypeError);
    expect(() => literal(DECIMAL, '1 + 2')).toThrow(ApexTypeError);
  });

  it('accepts the atoms a converter actually produces', () => {
    expect(() => literal(DECIMAL, '1000')).not.toThrow();
    expect(() => literal(DECIMAL, '-2.5')).not.toThrow();
    expect(() => literal(STRING, "'Funded'")).not.toThrow();
    expect(() => literal(STRING, "'it\\'s'")).not.toThrow();
    expect(() => literal(BOOLEAN, 'true')).not.toThrow();
    expect(() => literal(ID, 'null')).not.toThrow();
  });
});

describe('stringLiteral', () => {
  it('quotes a plain value', () => {
    const e = stringLiteral('Funded');
    if (e.node !== 'literal') throw new Error('expected literal node');
    expect(e.text).toBe("'Funded'");
  });

  it('escapes an embedded apostrophe', () => {
    // The O'Brien case. Emitting 'O'Brien' unescaped ends the literal early
    // and leaves `Brien'` as a syntax error.
    const e = stringLiteral("O'Brien");
    if (e.node !== 'literal') throw new Error('expected literal node');
    expect(e.text).toBe("'O\\'Brien'");
  });

  it('escapes a backslash before escaping quotes', () => {
    // Order matters: escaping quotes first would then double the backslash
    // this step adds, producing 'a\\\'b'.
    const e = stringLiteral("a\\b");
    if (e.node !== 'literal') throw new Error('expected literal node');
    expect(e.text).toBe("'a\\\\b'");
  });

  it('produces a value literal() accepts as an atom', () => {
    // literal()'s atom guard is what stops compound text defeating the
    // emitter's parenthesisation. stringLiteral must satisfy it by construction.
    const e = stringLiteral("it's a || b");
    if (e.node !== 'literal') throw new Error('expected literal node');
    expect(() => literal(STRING, e.text)).not.toThrow();
  });

  it('handles newlines and tabs', () => {
    const e1 = stringLiteral('a\nb');
    if (e1.node !== 'literal') throw new Error('expected literal node');
    expect(e1.text).toBe("'a\\nb'");
    const e2 = stringLiteral('a\tb');
    if (e2.node !== 'literal') throw new Error('expected literal node');
    expect(e2.text).toBe("'a\\tb'");
  });
});

describe('construct', () => {
  it('constructs an SObject', () => {
    expect(emitExpr(construct(sobjectType('Account'), []))).toBe('new Account()');
  });

  it('constructs a typed list', () => {
    expect(emitExpr(construct(listOf(sobjectType('Account')), [])))
      .toBe('new List<Account>()');
  });

  it('is assignable to its own declared type', () => {
    // declare() validates assignability, so this must satisfy isAssignable.
    expect(() => declare(sobjectType('Account'), 'a', construct(sobjectType('Account'), [])))
      .not.toThrow();
  });
});

describe('staticCall', () => {
  it('emits a call with no target', () => {
    expect(emitExpr(staticCall('formula_isReady', [], BOOLEAN))).toBe('formula_isReady()');
  });

  it('emits arguments', () => {
    expect(emitExpr(staticCall('f', [literal(DECIMAL, '1'), literal(DECIMAL, '2')], BOOLEAN)))
      .toBe('f(1, 2)');
  });

  it('refuses an invalid method name', () => {
    expect(() => staticCall('2bad', [], BOOLEAN)).toThrow(ApexTypeError);
  });
});

describe('ternary', () => {
  it('emits a conditional expression', () => {
    const e = ternary(
      methodCall(variable(listOf(sobjectType('Account')), 'rows'), 'isEmpty', [], BOOLEAN),
      literal(NULL, 'null'),
      methodCall(variable(listOf(sobjectType('Account')), 'rows'), 'get',
        [literal(INTEGER, '0')], sobjectType('Account')),
      sobjectType('Account')
    );
    expect(emitExpr(e)).toBe('rows.isEmpty() ? null : rows.get(0)');
  });

  it('refuses a non-Boolean condition — Apex has no truthiness', () => {
    expect(() => ternary(
      literal(DECIMAL, '1'), literal(DECIMAL, '1'), literal(DECIMAL, '2'), DECIMAL
    )).toThrow(ApexTypeError);
  });

  it('refuses a branch the result type cannot hold', () => {
    expect(() => ternary(
      literal(BOOLEAN, 'true'), literal(STRING, "'x'"), literal(DECIMAL, '1'), DECIMAL
    )).toThrow(ApexTypeError);
  });

  it('accepts null in either branch', () => {
    const e = ternary(
      literal(BOOLEAN, 'true'), literal(NULL, 'null'),
      variable(sobjectType('Account'), 'a'), sobjectType('Account')
    );
    expect(emitExpr(e)).toBe('true ? null : a');
  });

  it('parenthesises an infix operand so the emitted text re-parses as the tree', () => {
    // `?:` binds looser than every operator below it, so an infix condition
    // emitted bare would swallow the branches.
    const e = ternary(
      equality(variable(ID, 'a'), '==', literal(ID, 'null')),
      literal(DECIMAL, '1'), literal(DECIMAL, '2'), DECIMAL
    );
    expect(emitExpr(e)).toBe('(a == null) ? 1 : 2');
  });

  it('parenthesises itself when used as an operand of an infix node', () => {
    const t = ternary(literal(BOOLEAN, 'true'), literal(DECIMAL, '1'), literal(DECIMAL, '2'), DECIMAL);
    expect(emitExpr(equality(t, '==', literal(DECIMAL, '1'))))
      .toBe('(true ? 1 : 2) == 1');
  });
});
