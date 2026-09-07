import { FlowConditionIR, FlowValue } from './types.js';

/** xml2js gives one object for a single occurrence and an array for many. */
export function toArray(value: unknown): Record<string, unknown>[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]) as Record<string, unknown>[];
}

/**
 * Read a Flow value container. Every variant Flow can express is handled; an
 * unrecognised container yields kind 'none' rather than a guess.
 */
export function readValue(container: unknown): FlowValue {
  if (!container || typeof container !== 'object') return { kind: 'none' };
  const c = container as Record<string, unknown>;
  if (c.stringvalue !== undefined) return { kind: 'string', raw: String(c.stringvalue) };
  if (c.numbervalue !== undefined) return { kind: 'number', raw: String(c.numbervalue) };
  if (c.booleanvalue !== undefined) return { kind: 'boolean', raw: String(c.booleanvalue) };
  if (c.datevalue !== undefined) return { kind: 'date', raw: String(c.datevalue) };
  if (c.datetimevalue !== undefined) return { kind: 'datetime', raw: String(c.datetimevalue) };
  if (c.elementreference !== undefined) return { kind: 'reference', raw: String(c.elementreference) };
  if (c.apexvalue !== undefined) return { kind: 'apex', raw: String(c.apexvalue) };
  if (c.sobjectvalue !== undefined) return { kind: 'sobject', raw: String(c.sobjectvalue) };
  if (c.formulaexpression !== undefined) return { kind: 'formula', raw: String(c.formulaexpression) };
  if (c.setupreference !== undefined) return { kind: 'setupReference', raw: String(c.setupreference) };
  return { kind: 'none' };
}

/**
 * A Flow condition. Both `leftValueReference` (decisions) and `field` (record filters)
 * name the left-hand side, so both are accepted.
 */
export function parseCondition(raw: Record<string, unknown>): FlowConditionIR {
  const left = raw.leftvaluereference ?? raw.field;
  return {
    left: left === undefined ? '' : String(left),
    operator: raw.operator === undefined ? '' : String(raw.operator),
    right: readValue(raw.rightvalue ?? raw.value),
  };
}
