import { ApexStmt, collectInto, declare, dmlBulk, fieldWrite, queryInto } from '../../apex/stmt.js';
import { SoqlSpec, soql } from '../../apex/soql.js';
import { construct } from '../../apex/expr.js';
import { listOf, sobjectType } from '../../apex/types.js';
import { FlowNode, RecordBody } from '../../ir/types.js';
import { LowerContext, apexName } from '../context.js';
import { UnsupportedConstructError, lowerValue } from '../value.js';

/** The DML operation a record element performs, from its Flow element kind. */
function operationOf(kind: string): 'insert' | 'update' | 'delete' | 'query' {
  switch (kind) {
    case 'recordlookups':
      return 'query';
    case 'recordcreates':
      return 'insert';
    case 'recordupdates':
      return 'update';
    case 'recorddeletes':
      return 'delete';
    default:
      throw new UnsupportedConstructError(`'${kind}' is not a record element.`);
  }
}

function lowerLookup(node: FlowNode, body: RecordBody, ctx: LowerContext): ApexStmt[] {
  const object = body.object ?? node.object;
  if (!object) {
    throw new UnsupportedConstructError(`${node.name} is a lookup with no object.`);
  }

  const spec: SoqlSpec = {
    object,
    fields: body.queriedFields.length > 0 ? body.queriedFields : ['Id'],
  };
  if (body.sortField) {
    spec.orderBy = {
      field: body.sortField,
      direction: body.sortOrder?.toLowerCase() === 'desc' ? 'DESC' : 'ASC',
    };
  }
  if (body.limit !== undefined) spec.limit = body.limit;

  // Only an IN filter maps to a bind. Anything else needs a WHERE the builder
  // does not model yet, and is refused rather than dropped.
  for (const filter of body.filters) {
    if (filter.operator !== 'In') {
      throw new UnsupportedConstructError(
        `${node.name} filters with '${filter.operator}', which this milestone does not lower.`
      );
    }
    if (filter.right.kind !== 'reference' || !filter.right.raw) {
      throw new UnsupportedConstructError(`${node.name} has an IN filter with no bind variable.`);
    }
    spec.whereIn = { field: filter.left, bind: apexName(ctx, filter.right.raw) };
  }

  const target = apexName(ctx, body.outputReference ?? node.name);
  return [queryInto(listOf(sobjectType(object)), target, soql(spec))];
}

function lowerDml(node: FlowNode, body: RecordBody, ctx: LowerContext): ApexStmt[] {
  const object = body.object ?? node.object;
  if (!object) {
    throw new UnsupportedConstructError(`${node.name} is a DML element with no object.`);
  }
  const operation = operationOf(node.kind) as 'insert' | 'update' | 'delete';

  const record = apexName(ctx, node.name);
  const collection = apexName(ctx, `${node.name}_records`);
  const statements: ApexStmt[] = [
    declare(sobjectType(object), record, construct(sobjectType(object), [])),
    declare(listOf(sobjectType(object)), collection, construct(listOf(sobjectType(object)), [])),
  ];

  for (const write of body.inputAssignments) {
    statements.push(fieldWrite(record, write.field, lowerValue(write.value, ctx)));
  }
  statements.push(collectInto(collection, record));
  statements.push(dmlBulk(operation, collection));
  return statements;
}

/**
 * A record element.
 *
 * DML is collected into a list and issued once even though this milestone does
 * not bulkify: the AST has no per-record DML statement at all, so this is the
 * only representable shape. Hoisting the collection out of an enclosing loop is
 * BulkTransformer's job, not this one.
 */
export function lowerRecord(node: FlowNode, ctx: LowerContext): ApexStmt[] {
  const body = node.body;
  if (body?.kind !== 'record') {
    throw new UnsupportedConstructError(`${node.name} has no record body.`);
  }
  return operationOf(node.kind) === 'query'
    ? lowerLookup(node, body, ctx)
    : lowerDml(node, body, ctx);
}
