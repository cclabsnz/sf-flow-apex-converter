import { ApexExpr } from './expr.js';
import { SoqlQuery } from './soql.js';
import { ApexType } from './types.js';

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
  return { stmt: 'declare', type, name, init };
}

export function assign(name: string, value: ApexExpr): ApexStmt {
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

export function queryInto(type: ApexType, name: string, query: SoqlQuery): ApexStmt {
  return { stmt: 'queryInto', type, name, query };
}

export function ifThen(condition: ApexExpr, body: ApexStmt[]): ApexStmt {
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
