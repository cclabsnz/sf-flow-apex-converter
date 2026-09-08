import {
  ApexExpr, comparison, equality, logical, methodCall, nullTest,
} from '../apex/expr.js';
import { BOOLEAN, sobjectType } from '../apex/types.js';
import { FlowConditionIR } from '../ir/types.js';
import { LowerContext } from './context.js';
import { UnsupportedConstructError, lowerReference, lowerValue } from './value.js';

export type LogicNode =
  | { kind: 'index'; index: number }
  | { kind: 'and' | 'or'; children: LogicNode[] };

/**
 * Parse `conditionLogic`.
 *
 * `and` and `or` are the simple forms. The third form is an expression over
 * 1-based condition indices — `1 AND (2 OR 3)` — which exampleflow.xml uses,
 * so this parser is required rather than optional. AND binds tighter than OR,
 * matching both Flow and Apex.
 */
export function parseConditionLogic(logic: string, count: number): LogicNode {
  const simple = logic.trim().toLowerCase();
  if (simple === 'and' || simple === 'or') {
    const children: LogicNode[] = [];
    for (let i = 0; i < count; i += 1) children.push({ kind: 'index', index: i });
    // A single condition collapses to its own node, matching the custom-form
    // parser below — otherwise lowerConditions would wrap one operand in a
    // logical() node and the emitter would add a redundant pair of parens.
    return children.length === 1 ? children[0] : { kind: simple, children };
  }

  const tokens = logic.match(/\d+|AND|OR|\(|\)/gi) ?? [];
  let at = 0;
  const peek = (): string | undefined => tokens[at];
  const take = (): string | undefined => tokens[at++];

  const parsePrimary = (): LogicNode => {
    const token = take();
    if (token === undefined) {
      throw new UnsupportedConstructError(`Condition logic '${logic}' ends unexpectedly.`);
    }
    if (token === '(') {
      const inner = parseOr();
      if (take() !== ')') {
        throw new UnsupportedConstructError(`Condition logic '${logic}' has an unclosed bracket.`);
      }
      return inner;
    }
    if (!/^\d+$/.test(token)) {
      throw new UnsupportedConstructError(`Condition logic '${logic}' has an unexpected '${token}'.`);
    }
    const index = Number(token) - 1;
    if (index < 0 || index >= count) {
      throw new UnsupportedConstructError(
        `Condition logic '${logic}' refers to condition ${token}, but there are ${count}.`
      );
    }
    return { kind: 'index', index };
  };

  const parseAnd = (): LogicNode => {
    const children = [parsePrimary()];
    while (peek()?.toUpperCase() === 'AND') {
      take();
      children.push(parsePrimary());
    }
    return children.length === 1 ? children[0] : { kind: 'and', children };
  };

  const parseOr = (): LogicNode => {
    const children = [parseAnd()];
    while (peek()?.toUpperCase() === 'OR') {
      take();
      children.push(parseAnd());
    }
    return children.length === 1 ? children[0] : { kind: 'or', children };
  };

  const tree = parseOr();
  if (at !== tokens.length) {
    throw new UnsupportedConstructError(`Condition logic '${logic}' has trailing input.`);
  }
  return tree;
}

/** True when a Flow boolean-valued right-hand side says `true`. */
function saysTrue(condition: FlowConditionIR): boolean {
  return condition.right.raw !== 'false';
}

export function lowerCondition(condition: FlowConditionIR, ctx: LowerContext): ApexExpr {
  const left = lowerReference(condition.left, ctx);

  switch (condition.operator) {
    case 'EqualTo':
      return equality(left, '==', lowerValue(condition.right, ctx));
    case 'NotEqualTo':
      return equality(left, '!=', lowerValue(condition.right, ctx));
    case 'GreaterThan':
      return comparison(left, '>', lowerValue(condition.right, ctx));
    case 'GreaterThanOrEqualTo':
      return comparison(left, '>=', lowerValue(condition.right, ctx));
    case 'LessThan':
      return comparison(left, '<', lowerValue(condition.right, ctx));
    case 'LessThanOrEqualTo':
      return comparison(left, '<=', lowerValue(condition.right, ctx));
    case 'IsNull':
      // `IsNull true` means "is null"; `IsNull false` means "is not null".
      return nullTest(left, !saysTrue(condition));
    case 'IsBlank':
      // The AST has no unary NOT. Apex supplies isNotBlank, so the negation is
      // a different method rather than a wrapper.
      return methodCall(
        variableOfString(),
        saysTrue(condition) ? 'isBlank' : 'isNotBlank',
        [left],
        BOOLEAN
      );
    case 'Contains':
      return methodCall(left, 'contains', [lowerValue(condition.right, ctx)], BOOLEAN);
    case 'StartsWith':
      return methodCall(left, 'startsWith', [lowerValue(condition.right, ctx)], BOOLEAN);
    case 'EndsWith':
      return methodCall(left, 'endsWith', [lowerValue(condition.right, ctx)], BOOLEAN);
    default:
      throw new UnsupportedConstructError(
        `Flow condition operator '${condition.operator}' has no Apex mapping in this milestone.`
      );
  }
}

/** The `String` class as a call target, for `String.isBlank(x)`. */
function variableOfString(): ApexExpr {
  return { node: 'variable', type: sobjectType('String'), name: 'String' };
}

export function lowerConditions(
  logic: string,
  conditions: FlowConditionIR[],
  ctx: LowerContext
): ApexExpr {
  if (conditions.length === 0) {
    throw new UnsupportedConstructError('A condition list cannot be empty.');
  }
  const lowered = conditions.map((c) => lowerCondition(c, ctx));
  const build = (node: LogicNode): ApexExpr => {
    if (node.kind === 'index') return lowered[node.index];
    return logical(node.kind === 'and' ? '&&' : '||', node.children.map(build));
  };
  const tree = parseConditionLogic(logic, conditions.length);
  return build(tree);
}
