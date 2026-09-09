import { ApexTypeError } from './errors.js';
import { ApexType, BOOLEAN, STRING, isAssignable, isComparable, isUntyped, renderType } from './types.js';

export type OrderingOperator = '<' | '>' | '<=' | '>=';
export type EqualityOperator = '==' | '!=';
export type LogicalOperator = '&&' | '||';

export type ApexExpr =
  | { node: 'literal'; type: ApexType; text: string }
  | { node: 'variable'; type: ApexType; name: string }
  | { node: 'fieldRead'; type: ApexType; record: string; field: string }
  | { node: 'comparison'; type: ApexType; op: OrderingOperator; left: ApexExpr; right: ApexExpr }
  | { node: 'equality'; type: ApexType; op: EqualityOperator; left: ApexExpr; right: ApexExpr }
  | { node: 'logical'; type: ApexType; op: LogicalOperator; operands: ApexExpr[] }
  | { node: 'nullTest'; type: ApexType; operand: ApexExpr; negated: boolean }
  | { node: 'methodCall'; type: ApexType; target: ApexExpr; method: string; args: ApexExpr[] }
  | { node: 'staticCall'; type: ApexType; name: string; args: ApexExpr[] }
  | { node: 'construct'; type: ApexType; args: ApexExpr[] }
  | {
      node: 'ternary';
      type: ApexType;
      condition: ApexExpr;
      whenTrue: ApexExpr;
      whenFalse: ApexExpr;
    };

/**
 * A single literal atom, already rendered as Apex source (quotes included for
 * strings): `1000`, `-2.5`, `'Funded'`, `true`, `null`.
 *
 * Restricted to one atom on purpose. Literal text is spliced in verbatim and is
 * the one expression the emitter never parenthesises, so a compound string here
 * silently defeats the precedence guarantee the rest of the module provides:
 * `logical('&&', [literal(BOOLEAN, 'a || b'), c])` emitted `a || b && c`, which
 * Apex reads as `a || (b && c)`. Build compound expressions from nodes instead.
 */
const ATOM = /^(?:-?\d+(?:\.\d+)?|'(?:[^'\\]|\\.)*'|null|true|false)$/i;

export function literal(type: ApexType, text: string): ApexExpr {
  if (!ATOM.test(text)) {
    throw new ApexTypeError(
      `literal() takes a single Apex atom, not ${JSON.stringify(text)}. ` +
        `Build compound expressions from nodes so the emitter can parenthesise them.`
    );
  }
  return { node: 'literal', type, text };
}

/**
 * A String literal built from a raw value, with Apex escaping applied.
 *
 * `literal()` takes text that is already Apex source; this is the constructor
 * for text that is not. Every Flow-derived string must come through here — a
 * value containing an apostrophe passed to `literal()` directly would end its
 * own literal and emit a syntax error.
 *
 * Backslash is escaped first. Doing quotes first would then double the
 * backslashes this step adds.
 */
export function stringLiteral(value: string): ApexExpr {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return literal(STRING, `'${escaped}'`);
}

export function variable(type: ApexType, name: string): ApexExpr {
  return { node: 'variable', type, name };
}

/**
 * A field read off an SObject, always cast to the type the caller resolved.
 *
 * Refusing OBJECT here is deliberate: an unresolved field type is the input to
 * every defect this module prevents. The caller must resolve the type — from a
 * describe, or from the Flow's own declaration — before it can build a read.
 */
export function fieldRead(record: string, field: string, type: ApexType): ApexExpr {
  if (isUntyped(type)) {
    throw new ApexTypeError(
      `Cannot build a field read for '${field}' with no resolved type. ` +
        `record.get() returns Object; resolve the field's type first.`
    );
  }
  return { node: 'fieldRead', type, record, field };
}

function requireOperand(e: ApexExpr, what: string): void {
  if (isUntyped(e.type)) {
    throw new ApexTypeError(`Cannot use an untyped (Object) expression as ${what}.`);
  }
}

/** Apex has no truthiness: conditions and logical operands must be Boolean. */
export function requireBoolean(e: ApexExpr, what: string): void {
  if (e.type.kind !== 'Boolean') {
    throw new ApexTypeError(`${what} must be Boolean; got ${renderType(e.type)}.`);
  }
}

/**
 * Both sides of a comparison must be compatible with each other, not merely
 * individually valid. Checking operands in isolation let `s < d` through for a
 * String and a Date — each is orderable alone, and the org rejects the pair with
 * "Comparison arguments must be compatible types".
 */
function requireCompatible(left: ApexExpr, right: ApexExpr, op: string): void {
  if (!isAssignable(left.type, right.type) && !isAssignable(right.type, left.type)) {
    throw new ApexTypeError(
      `Apex cannot compare ${renderType(left.type)} with ${renderType(right.type)} ` +
        `using '${op}'.`
    );
  }
}

const ORDERING_OPERATORS: readonly string[] = ['<', '>', '<=', '>='];

/** `<`, `>`, `<=`, `>=` — only over types Apex can order. */
export function comparison(left: ApexExpr, op: OrderingOperator, right: ApexExpr): ApexExpr {
  // Checked at runtime as well as in the type, because the type alone stops only
  // TypeScript callers. This used to be covered incidentally — `a contains 'x'`
  // was refused because String was (wrongly) not orderable, so the operand check
  // caught it. Making String orderable removed that accident, and the operator
  // itself is what DEFECT 2 was about, so it is now checked directly.
  if (!ORDERING_OPERATORS.includes(op)) {
    throw new ApexTypeError(
      `'${op}' is not an Apex ordering operator. Use one of ${ORDERING_OPERATORS.join(', ')}, ` +
        `or a method call such as contains().`
    );
  }
  requireOperand(left, `the left operand of '${op}'`);
  requireOperand(right, `the right operand of '${op}'`);
  for (const side of [left, right]) {
    if (!isComparable(side.type)) {
      throw new ApexTypeError(
        `Apex cannot order ${renderType(side.type)} with '${op}'. ` +
          `Use equality, or a method call such as compareTo.`
      );
    }
  }
  requireCompatible(left, right, op);
  return { node: 'comparison', type: BOOLEAN, op, left, right };
}

/** `==` and `!=` — any two typed values. */
export function equality(left: ApexExpr, op: EqualityOperator, right: ApexExpr): ApexExpr {
  requireOperand(left, `the left operand of '${op}'`);
  requireOperand(right, `the right operand of '${op}'`);
  requireCompatible(left, right, op);
  return { node: 'equality', type: BOOLEAN, op, left, right };
}

/**
 * `x == null` / `x != null`. Unary by construction: there is no right-hand slot,
 * so the `x == null 1000` shape a three-part template produced cannot be built.
 * An untyped operand is fine — null-testing an Object is valid Apex.
 */
export function nullTest(operand: ApexExpr, negated: boolean): ApexExpr {
  return { node: 'nullTest', type: BOOLEAN, operand, negated };
}

export function logical(op: LogicalOperator, operands: ApexExpr[]): ApexExpr {
  // Joining an empty list produced `if () { ... }`, a syntax error that reached
  // the emitter silently. A decision with no conditions must fail here instead.
  if (operands.length === 0) {
    throw new ApexTypeError(`'${op}' needs at least one operand; none were given.`);
  }
  for (const o of operands) {
    requireBoolean(o, `an operand of '${op}'`);
  }
  return { node: 'logical', type: BOOLEAN, op, operands };
}

/**
 * A method call. String membership tests live here rather than as operators,
 * so `a contains 'x'` — which is not Apex — has no way to be expressed.
 */
export function methodCall(
  target: ApexExpr,
  method: string,
  args: ApexExpr[],
  type: ApexType
): ApexExpr {
  return { node: 'methodCall', type, target, method, args };
}

/** `new Account()` / `new List<String>()`. */
export function construct(type: ApexType, args: ApexExpr[]): ApexExpr {
  return { node: 'construct', type, args };
}

/**
 * `condition ? whenTrue : whenFalse`, with an explicit result type.
 *
 * The narrowest node that can express "the first record, or null when there was
 * none" — the shape Flow's `getFirstRecordOnly` actually has. `[SELECT ...][0]`
 * throws on an empty result, and `LIMIT 1` alone does not make the variable null,
 * so a conditional is genuinely required rather than a convenience.
 *
 * The result type is a parameter, not inferred, because inference would have to
 * pick a winner when the two branches differ — and `null` on one side carries no
 * type at all. Both branches are checked against the declared type instead, so a
 * caller cannot produce `Decimal x = flag ? 'a' : 1;`.
 */
export function ternary(
  condition: ApexExpr,
  whenTrue: ApexExpr,
  whenFalse: ApexExpr,
  type: ApexType
): ApexExpr {
  requireBoolean(condition, "A conditional expression's condition");
  for (const [branch, which] of [[whenTrue, 'true'], [whenFalse, 'false']] as const) {
    if (!isAssignable(type, branch.type)) {
      throw new ApexTypeError(
        `The '${which}' branch of a conditional expression is ${renderType(branch.type)}, ` +
          `which Apex cannot assign to ${renderType(type)}.`
      );
    }
  }
  return { node: 'ternary', type, condition, whenTrue, whenFalse };
}

const METHOD_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * `name(args)` — a call with no target, for a static method on the class being
 * generated. methodCall always renders `target.name(...)`, which a same-class
 * static call has no target for.
 */
export function staticCall(name: string, args: ApexExpr[], type: ApexType): ApexExpr {
  if (!METHOD_NAME.test(name)) {
    throw new ApexTypeError(`'${name}' is not a valid Apex method name.`);
  }
  return { node: 'staticCall', type, name, args };
}
