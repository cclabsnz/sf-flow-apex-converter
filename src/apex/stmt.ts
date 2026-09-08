import { ApexExpr, requireBoolean } from './expr.js';
import { SoqlQuery } from './soql.js';
import { ApexTypeError } from './errors.js';
import { ApexType, isAssignable, isUntyped, renderType, sameName } from './types.js';

export type DmlOperation = 'insert' | 'update' | 'delete';

export type ApexStmt =
  | { stmt: 'declare'; type: ApexType; name: string; init: ApexExpr | null }
  | { stmt: 'assign'; name: string; value: ApexExpr }
  | { stmt: 'fieldWrite'; record: string; field: string; value: ApexExpr }
  | { stmt: 'collectInto'; collection: string; record: string }
  | { stmt: 'queryInto'; type: ApexType; name: string; query: SoqlQuery }
  | { stmt: 'ifThen'; condition: ApexExpr; body: ApexStmt[] }
  | { stmt: 'forEach'; itemType: ApexType; item: string; collection: string; body: ApexStmt[] }
  | { stmt: 'dmlBulk'; operation: DmlOperation; collection: string };

export function declare(type: ApexType, name: string, init: ApexExpr | null): ApexStmt {
  if (init !== null && !isAssignable(type, init.type)) {
    throw new ApexTypeError(
      `Cannot assign ${renderType(init.type)} to ${renderType(type)} in the declaration ` +
        `of '${name}'. Apex rejects this outright at compile time.`
    );
  }
  return { stmt: 'declare', type, name, init };
}

export function assign(name: string, value: ApexExpr): ApexStmt {
  if (isUntyped(value.type)) {
    throw new ApexTypeError(
      `Cannot assign an untyped (Object) expression to '${name}'. ` +
        `record.get() returns Object; resolve the type first.`
    );
  }
  return { stmt: 'assign', name, value };
}

/** `record.put('Field__c', value);` — the write the old generator dropped. */
export function fieldWrite(record: string, field: string, value: ApexExpr): ApexStmt {
  return { stmt: 'fieldWrite', record, field, value };
}

/**
 * Add a record to a collection for later DML.
 *
 * There is deliberately no statement for DML on a single record. The only way to
 * write to the database is dmlBulk over a collection, so a per-iteration
 * insert/update — the anti-pattern this whole tool exists to remove — cannot be
 * represented in the tree at all.
 */
export function collectInto(collection: string, record: string): ApexStmt {
  return { stmt: 'collectInto', collection, record };
}

/**
 * `List<Account> accts = [SELECT ...];`
 *
 * Unlike the other statements, this one holds both the target type and the query,
 * so it can check them against each other. soql() already exists to stop a query
 * naming the wrong object (DEFECT 3); letting the variable say List<Contact> while
 * the query says FROM Account reopens the same door one step later.
 */
export function queryInto(type: ApexType, name: string, query: SoqlQuery): ApexStmt {
  if (type.kind !== 'List' || type.of.kind !== 'SObject') {
    throw new ApexTypeError(
      `A query result is a List of SObject; '${name}' was declared ` +
        `${renderType(type)}, which Apex cannot assign a query to.`
    );
  }
  if (type.of.name !== undefined && !sameName(type.of.name, query.object)) {
    throw new ApexTypeError(
      `'${name}' is a List<${type.of.name}> but the query selects FROM ${query.object}.`
    );
  }
  return { stmt: 'queryInto', type, name, query };
}

export function ifThen(condition: ApexExpr, body: ApexStmt[]): ApexStmt {
  // `if (5)` is not C. The compiler is explicit: "Condition expression must be
  // of type Boolean: Integer".
  requireBoolean(condition, 'An if condition');
  return { stmt: 'ifThen', condition, body };
}

export function forEach(
  itemType: ApexType,
  item: string,
  collection: string,
  body: ApexStmt[]
): ApexStmt {
  return { stmt: 'forEach', itemType, item, collection, body };
}

export function dmlBulk(operation: DmlOperation, collection: string): ApexStmt {
  return { stmt: 'dmlBulk', operation, collection };
}
