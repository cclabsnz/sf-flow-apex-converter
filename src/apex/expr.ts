import { ApexTypeError } from './errors.js';
import { ApexType, BOOLEAN, isComparable, isUntyped, renderType } from './types.js';

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
  | { node: 'methodCall'; type: ApexType; target: ApexExpr; method: string; args: ApexExpr[] };

/** A literal, already rendered as Apex source (quotes included for strings). */
export function literal(type: ApexType, text: string): ApexExpr {
  return { node: 'literal', type, text };
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
  return { node: 'comparison', type: BOOLEAN, op, left, right };
}

/** `==` and `!=` — any two typed values. */
export function equality(left: ApexExpr, op: EqualityOperator, right: ApexExpr): ApexExpr {
  requireOperand(left, `the left operand of '${op}'`);
  requireOperand(right, `the right operand of '${op}'`);
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
  for (const o of operands) {
    if (o.type.kind !== 'Boolean') {
      throw new ApexTypeError(`'${op}' needs Boolean operands; got ${renderType(o.type)}.`);
    }
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
