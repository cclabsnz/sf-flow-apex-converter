import { construct } from '../../apex/expr.js';
import { ApexStmt, collectInto, declare, forEach, ifThen } from '../../apex/stmt.js';
import { listOf, sobjectType } from '../../apex/types.js';
import { FlowNode } from '../../ir/types.js';
import { LowerContext, apexName } from '../context.js';
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

  return [
    declare(listOf(elementType), target, construct(listOf(elementType), [])),
    forEach(elementType, item, apexName(ctx, body.collection), [
      ifThen(lowerConditions(body.conditionLogic ?? 'and', body.conditions, ctx), [
        collectInto(target, item),
      ]),
    ]),
  ];
}
