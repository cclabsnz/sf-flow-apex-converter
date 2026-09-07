import { ApexTypeError } from './errors.js';

export interface SoqlSpec {
  object: string;
  fields: string[];
  /** Name of an Apex variable holding the Ids to bind. Never a literal list. */
  whereIdIn?: string;
  orderBy?: { field: string; direction?: 'ASC' | 'DESC' };
  limit?: number;
}

export interface SoqlQuery extends SoqlSpec {
  fields: string[];
}

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/;

function requireIdentifier(value: string, what: string): void {
  if (!IDENTIFIER.test(value)) {
    throw new ApexTypeError(`${what} '${value}' is not a valid SOQL identifier.`);
  }
}

/**
 * Build a query. The object is a required input with no default, which is the
 * structural answer to a generator that emitted `FROM Account` for every Flow:
 * there is no query to render until a caller has named the object.
 *
 * Identifiers are validated rather than escaped. A field name is not user prose;
 * anything that is not an identifier is a bug or an injection attempt, and both
 * deserve to fail loudly.
 */
export function soql(spec: SoqlSpec): SoqlQuery {
  if (!spec.object) {
    throw new ApexTypeError('A SOQL query needs an object; none was given.');
  }
  requireIdentifier(spec.object, 'SOQL object');

  if (spec.fields.length === 0) {
    throw new ApexTypeError(`A SOQL query on ${spec.object} needs at least one field.`);
  }
  for (const f of spec.fields) requireIdentifier(f, 'SOQL field');
  if (spec.orderBy) requireIdentifier(spec.orderBy.field, 'ORDER BY field');
  if (spec.whereIdIn) requireIdentifier(spec.whereIdIn, 'bind variable');

  const fields = spec.fields.includes('Id') ? [...spec.fields] : ['Id', ...spec.fields];
  return { ...spec, fields };
}

export function renderSoql(query: SoqlQuery): string {
  const parts = [`SELECT ${query.fields.join(', ')}`, `FROM ${query.object}`];
  if (query.whereIdIn) parts.push(`WHERE Id IN :${query.whereIdIn}`);
  // Spec decision: generated Apex targets 58.0+, so user mode is unconditional.
  parts.push('WITH USER_MODE');
  if (query.orderBy) {
    parts.push(`ORDER BY ${query.orderBy.field}${query.orderBy.direction ? ` ${query.orderBy.direction}` : ''}`);
  }
  if (query.limit !== undefined) parts.push(`LIMIT ${query.limit}`);
  return parts.join('\n');
}
