import { construct, variable } from '../../apex/expr.js';
import { ApexStmt, assign, collectInto, declare, forEach, ifThen } from '../../apex/stmt.js';
import { listOf, sobjectType } from '../../apex/types.js';
import { FlowNode } from '../../ir/types.js';
import { LowerContext, apexName, isFlowDeclared } from '../context.js';
import { lowerConditions } from '../condition.js';
import { UnsupportedConstructError } from '../value.js';

/**
 * A collection processor.
 *
 * Only FilterCollectionProcessor lowers. Sort needs a generated Comparator
 * implementation and Map needs an expression language for the projection —
 * both are real work that belongs in its own change rather than smuggled in
 * here, so they are refused by processorType.
 */
export function lowerCollectionProcessor(node: FlowNode, ctx: LowerContext): ApexStmt[] {
  const body = node.body;
  if (body?.kind !== 'collectionProcessor') {
    throw new UnsupportedConstructError(`${node.name} has no collection-processor body.`);
  }
  if (body.processorType !== 'FilterCollectionProcessor') {
    throw new UnsupportedConstructError(
      `Collection processor '${body.processorType ?? 'unknown'}' on ${node.name} ` +
        `is not lowered in this milestone.`
    );
  }
  // A filter with no conditions is plausible input (an admin clears every
  // row but leaves the element in place). lowerConditions already refuses an
  // empty list with UnsupportedConstructError, so nothing further is needed
  // here — this is not silently skipped, it fails loudly through that call.
  const sourceType = ctx.types.resolve(body.collection).type;
  const elementType = sourceType.kind === 'List' ? sourceType.of : sobjectType();
  const target = apexName(ctx, node.name);
  const item = apexName(ctx, body.assignNextValueToReference ?? `${node.name}_item`);
  const listType = listOf(elementType);

  // See isFlowDeclared. A name the Flow declares is declared once at the method's
  // top level; declaring it here as well is "Variable already defined", and
  // declaring it ONLY here block-scopes it when the element sits inside an if or
  // a for. The filtered list is rebuilt either way — the element genuinely
  // produces a fresh collection each time it runs.
  const output = isFlowDeclared(ctx, node.name)
    ? assign(target, construct(listType, []))
    : declare(listType, target, construct(listType, []));

  // A for-each header always DECLARES its iteration variable, so when the Flow
  // declares that name too the loop must iterate a separate, element-owned
  // identifier and copy each item across. Allocated through Scope, not apexName's
  // Flow-name cache: this identifier belongs to no Flow name.
  const declaredItem = isFlowDeclared(ctx, body.assignNextValueToReference);
  const cursor = declaredItem ? ctx.scope.allocate(`${item}_item`) : item;
  const copy: ApexStmt[] = declaredItem ? [assign(item, variable(elementType, cursor))] : [];

  return [
    output,
    forEach(elementType, cursor, apexName(ctx, body.collection), [
      ...copy,
      ifThen(lowerConditions(body.conditionLogic ?? 'and', body.conditions, ctx), [
        collectInto(target, item),
      ]),
    ]),
  ];
}
