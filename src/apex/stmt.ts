import { ApexExpr, requireBoolean, stringLiteral } from './expr.js';
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
  | { stmt: 'ifThen'; condition: ApexExpr; body: ApexStmt[]; elseBody: ApexStmt[] }
  | { stmt: 'forEach'; itemType: ApexType; item: string; collection: string; body: ApexStmt[] }
  | { stmt: 'dmlBulk'; operation: DmlOperation; collection: string }
  | { stmt: 'memberWrite'; target: string; member: string; value: ApexExpr }
  | { stmt: 'invoke'; call: ApexExpr }
  | { stmt: 'throwStmt'; message: ApexExpr }
  | { stmt: 'tryCatch'; body: ApexStmt[]; exceptionName: string; handler: ApexStmt[] }
  | { stmt: 'returnStmt'; value: ApexExpr | null };

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

export function ifThen(
  condition: ApexExpr,
  body: ApexStmt[],
  elseBody: ApexStmt[] = []
): ApexStmt {
  // `if (5)` is not C. The compiler is explicit: "Condition expression must be
  // of type Boolean: Integer".
  requireBoolean(condition, 'An if condition');
  return { stmt: 'ifThen', condition, body, elseBody };
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

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;

function requireIdentifier(value: string, what: string): void {
  if (!IDENTIFIER.test(value)) {
    throw new ApexTypeError(`${what} '${value}' is not a valid Apex identifier.`);
  }
}

/**
 * `obj.Member = value;` for an Apex-defined type.
 *
 * Distinct from fieldWrite, which emits `record.put('F', v)` and is SObject-only.
 * Both names are validated rather than interpolated: passing a dotted string as
 * the target would otherwise emit `a.b.Member = v` with nothing checking it.
 */
export function memberWrite(target: string, member: string, value: ApexExpr): ApexStmt {
  requireIdentifier(target, 'A member-write target');
  requireIdentifier(member, 'A member name');
  if (isUntyped(value.type)) {
    throw new ApexTypeError(
      `Cannot write an untyped (Object) expression to '${target}.${member}'.`
    );
  }
  return { stmt: 'memberWrite', target, member, value };
}

/**
 * A method call used as a statement: `msgs.clear();`
 *
 * Restricted to method calls on purpose. Apex accepts only a call as an
 * expression-statement, and a general "any expression" statement would be a
 * hole through which `amount > 1000;` could be emitted.
 */
export function invoke(call: ApexExpr): ApexStmt {
  if (call.node !== 'methodCall' && call.node !== 'staticCall') {
    throw new ApexTypeError('Only a method call can be used as a statement.');
  }
  return { stmt: 'invoke', call };
}

/**
 * `throw new UnsupportedOperationException('...');`
 *
 * The one exception type generated code throws, so the constructor takes only
 * the message. The message goes through stringLiteral, so a quote in a Flow
 * formula cannot end the literal early.
 */
export function throwStmt(message: string): ApexStmt {
  return { stmt: 'throwStmt', message: stringLiteral(message) };
}

/**
 * `try { ... } catch (Exception e) { ... }` — the shape a Flow fault connector
 * lowers to. The exception name goes through the identifier guard so a fault
 * path cannot inject one.
 */
export function tryCatch(body: ApexStmt[], exceptionName: string, handler: ApexStmt[]): ApexStmt {
  requireIdentifier(exceptionName, 'An exception variable');
  return { stmt: 'tryCatch', body, exceptionName, handler };
}

/**
 * `return value;` / `return;` — the latter for a void method.
 *
 * Output declarations become fields on a returned inner Result class, which is
 * why this exists: nothing before this task ever needed to return a value.
 */
export function returnStmt(value: ApexExpr | null): ApexStmt {
  return { stmt: 'returnStmt', value };
}
