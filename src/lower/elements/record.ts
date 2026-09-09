import {
  ApexStmt, assign, collectInto, declare, dmlBulk, fieldWrite, queryAssign, queryInto,
} from '../../apex/stmt.js';
import { ApexTypeError } from '../../apex/errors.js';
import { SoqlSpec, soql } from '../../apex/soql.js';
import { construct, literal, methodCall, ternary, variable } from '../../apex/expr.js';
import {
  BOOLEAN, INTEGER, NULL, listOf, renderType, sameName, sobjectType,
} from '../../apex/types.js';
import { FlowNode, RecordBody } from '../../ir/types.js';
import { LowerContext, apexName, isFlowDeclared } from '../context.js';
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

  // The builder models exactly one WHERE term (SoqlSpec.whereIn is singular).
  // A second filter used to silently overwrite the first, widening the query
  // to a near-full-object scan with no error and no note. Refuse instead.
  if (body.filters.length > 1) {
    throw new UnsupportedConstructError(
      `${node.name} has ${body.filters.length} filters; this milestone's query builder ` +
        `models a single WHERE term. Refusing rather than dropping one silently.`
    );
  }

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
  const declared = body.outputReference ? ctx.types.resolve(body.outputReference) : undefined;

  // assignNullValuesIfNoRecordsFound: true means Flow nulls the output when the
  // lookup finds nothing; false means Flow leaves whatever was there. What this
  // lowering emits is fixed — null for a single record, an empty list for a
  // collection — so where that differs from the flag the difference is recorded
  // rather than dropped. The one exact match is "first record only" with the
  // flag set, which is precisely `rows.isEmpty() ? null : rows.get(0)`.
  const emitted = body.getFirstRecordOnly ? 'null' : 'an empty list';
  const flowWould = body.assignNullValuesIfNoRecordsFound
    ? 'null'
    : 'whatever value it already held';
  if (emitted !== flowWould) {
    ctx.notes.push({
      kind: 'note',
      detail:
        `${node.name} finding no records sets '${target}' to ${emitted}; the Flow ` +
        `(assignNullValuesIfNoRecordsFound=${body.assignNullValuesIfNoRecordsFound}) ` +
        `would leave ${flowWould}.`,
    });
  }

  // "Only the first record" is Flow Builder's DEFAULT Get Records configuration,
  // and the target is then a single SObject, not a List. Ignoring the flag emitted
  // `List<T> X = [...]`, so a later `{!X.Name}` lowered to `X.get('Name')` —
  // compiler-confirmed: "Method does not exist or incorrect signature:
  // void get(String) from the type List<Account>".
  if (body.getFirstRecordOnly) {
    // The Flow's own declaration and its own "first record only" flag disagree.
    // Picking a winner would be a guess about which the admin meant.
    if (declared?.provenance === 'declared' && declared.type.kind === 'List') {
      throw new UnsupportedConstructError(
        `${node.name} stores only the first record, but '${body.outputReference}' is declared ` +
          `a collection. The Flow contradicts itself; refusing rather than choosing one.`
      );
    }
    const singleType = declared?.provenance === 'declared'
      ? declared.type
      : sobjectType(object);
    // The declared type and the query's object are two independently-sourced
    // facts, and on the non-first-record path below queryInto checks them
    // against each other. This branch returns before queryInto is ever built,
    // so the same check has to run here — and assign() checks nothing but
    // untypedness. Without it a Flow declaring 'TheAccount' a Contact while the
    // lookup queries Account wrote a .cls at exit 0 that emitted
    // `TheAccount = TheAccount_rows.get(0);` off a List<Account>, which the
    // compiler rejects with "Illegal assignment from Account to Contact". The
    // same mismatch without getFirstRecordOnly already refuses; the two paths
    // must agree.
    if (declared?.provenance === 'declared') {
      if (singleType.kind !== 'SObject') {
        throw new ApexTypeError(
          `A query result is an SObject; '${target}' was declared ${renderType(singleType)}, ` +
            `which Apex cannot assign a record to.`
        );
      }
      if (singleType.name !== undefined && !sameName(singleType.name, object)) {
        throw new ApexTypeError(
          `'${target}' is a ${singleType.name} but the query selects FROM ${object}.`
        );
      }
    }
    // Flow reads one record, so the query reads one row. Identical semantics,
    // and it keeps the temp list off the heap for a large result set.
    spec.limit = 1;
    const listType = listOf(sobjectType(object));
    // Allocated through Scope, not apexName's Flow-name cache: this identifier
    // belongs to no Flow name, and a real element called `${target}_rows` must
    // not collide with it.
    const rows = ctx.scope.allocate(`${target}_rows`);
    // NOT `[SELECT ... LIMIT 1][0]`, which throws System.ListException on an
    // empty result. Flow leaves the variable null when nothing is found.
    const first = ternary(
      methodCall(variable(listType, rows), 'isEmpty', [], BOOLEAN),
      literal(NULL, 'null'),
      methodCall(variable(listType, rows), 'get', [literal(INTEGER, '0')], singleType),
      singleType
    );
    return [
      queryInto(listType, rows, soql(spec)),
      // See isFlowDeclared: a name the Flow declares is declared once at the
      // method's top level, so the element assigns rather than declares.
      isFlowDeclared(ctx, body.outputReference)
        ? assign(target, first)
        : declare(singleType, target, first),
    ];
  }

  // Use the Flow's own declared type when it has one, so queryInto's object check
  // compares two independently-sourced facts instead of one fact with itself —
  // deriving both sides from `object` made the mismatch check tautological.
  const targetType = declared?.provenance === 'declared'
    ? declared.type
    : listOf(sobjectType(object));
  const query = soql(spec);
  // Built unconditionally: queryInto is where the declared type and the query's
  // object are checked against each other, and that check must run even when the
  // emitted statement is the assigning form, which carries no type of its own.
  const declaring = queryInto(targetType, target, query);
  // See isFlowDeclared. queryInto DECLARES, which block-scopes the name when the
  // element sits inside an if or a for; queryAssign writes into the declaration
  // lowerFlow already emitted at the method's top level.
  return isFlowDeclared(ctx, body.outputReference) ? [queryAssign(target, query)] : [declaring];
}

function lowerDml(node: FlowNode, body: RecordBody, ctx: LowerContext): ApexStmt[] {
  const object = body.object ?? node.object;
  if (!object) {
    throw new UnsupportedConstructError(`${node.name} is a DML element with no object.`);
  }
  const operation = operationOf(node.kind) as 'insert' | 'update' | 'delete';

  // "Update every record matching these criteria" — this lowering reads only
  // inputAssignments and issues DML on a freshly constructed record, so filters
  // here select nothing and the DML lands on a record the Flow never chose.
  // Not one of the fields the review enumerated, but refusing filterLogic on a
  // DML element while dropping the very filters it describes would be
  // incoherent; see the report.
  if (body.filters.length > 0) {
    throw new UnsupportedConstructError(
      `${node.name} selects its records with ${body.filters.length} filter(s), which this ` +
        `milestone does not lower for a ${node.kind} element — it constructs a new record ` +
        `and writes inputAssignments onto it. Refusing rather than acting on the wrong record.`
    );
  }

  const record = apexName(ctx, node.name);
  // Allocated outside the Flow-name cache: a real Flow element genuinely named
  // `${node.name}_records` would otherwise resolve to the same identifier via
  // apexName's cache, producing a duplicate declaration with different types.
  // Scope.allocate guarantees uniqueness against every name already taken.
  const collection = ctx.scope.allocate(`${record}_records`);
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
 * Modelled RecordBody fields that carry meaning this milestone does not lower.
 *
 * Each of these is read from the Flow and would otherwise be dropped in silence —
 * they never reach `ir.unsupported`, precisely because the IR models them. Every
 * one below produces output that COMPILES and does the wrong thing, which the
 * acceptance gate (`sf project deploy validate`) cannot see, so each is refused
 * rather than noted.
 */
function refuseUnloweredRecordFields(node: FlowNode, body: RecordBody): void {
  if (body.outputAssignments.length > 0) {
    const targets = body.outputAssignments.map((o) => `${o.field} -> ${o.assignToReference}`);
    throw new UnsupportedConstructError(
      `${node.name} has ${body.outputAssignments.length} per-field outputAssignments ` +
        `(${targets.join(', ')}), which this milestone does not lower. Dropping them would ` +
        `leave those variables declared and never assigned, so every later read sees null.`
    );
  }
  if (body.assignRecordIdToReference) {
    throw new UnsupportedConstructError(
      `${node.name} assigns the record Id to '${body.assignRecordIdToReference}', which this ` +
        `milestone does not lower. Dropping it would leave that variable null wherever the ` +
        `Flow reads the new record's Id.`
    );
  }
  if (body.inputReference) {
    throw new UnsupportedConstructError(
      `${node.name} takes '${body.inputReference}' as its whole record input, which this ` +
        `milestone does not lower. It emits DML on a freshly constructed record instead, ` +
        `so dropping this would write an empty record rather than the Flow's.`
    );
  }
  // filterLogic only combines filters, so with fewer than two of them every value
  // ('and', 'or', '1') means the same thing and nothing is being dropped.
  const logic = body.filterLogic?.trim().toLowerCase();
  if (body.filters.length > 1 && logic !== undefined && logic !== 'and') {
    throw new UnsupportedConstructError(
      `${node.name} combines its filters with '${body.filterLogic}'; this milestone's query ` +
        `builder models a single ANDed WHERE term. Refusing rather than dropping the logic.`
    );
  }
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
  refuseUnloweredRecordFields(node, body);
  return operationOf(node.kind) === 'query'
    ? lowerLookup(node, body, ctx)
    : lowerDml(node, body, ctx);
}
