import { FlowDeclaration, FlowValue } from './types.js';

const KINDS: Array<[string, FlowDeclaration['kind']]> = [
  ['variables', 'variable'],
  ['constants', 'constant'],
  ['formulas', 'formula'],
  ['texttemplates', 'textTemplate'],
];

/** xml2js gives one object for a single occurrence and an array for many. */
function toArray(value: unknown): Record<string, unknown>[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]) as Record<string, unknown>[];
}

/** Flow booleans arrive as the strings 'true'/'false'. */
function toBool(value: unknown): boolean {
  return String(value) === 'true';
}

function readValue(container: unknown): FlowValue {
  if (!container || typeof container !== 'object') return { kind: 'none' };
  const c = container as Record<string, unknown>;
  if (c.stringvalue !== undefined) return { kind: 'string', raw: String(c.stringvalue) };
  if (c.numbervalue !== undefined) return { kind: 'number', raw: String(c.numbervalue) };
  if (c.booleanvalue !== undefined) return { kind: 'boolean', raw: String(c.booleanvalue) };
  if (c.datevalue !== undefined) return { kind: 'date', raw: String(c.datevalue) };
  if (c.datetimevalue !== undefined) return { kind: 'datetime', raw: String(c.datetimevalue) };
  if (c.elementreference !== undefined) return { kind: 'reference', raw: String(c.elementreference) };
  return { kind: 'none' };
}

export function parseDeclarations(flowData: Record<string, unknown>): FlowDeclaration[] {
  const out: FlowDeclaration[] = [];

  for (const [tag, kind] of KINDS) {
    for (const raw of toArray(flowData[tag])) {
      out.push({
        name: String(raw.name ?? ''),
        kind,
        dataType: String(raw.datatype ?? 'Object'),
        isCollection: toBool(raw.iscollection),
        isInput: toBool(raw.isinput),
        isOutput: toBool(raw.isoutput),
        expression: raw.expression === undefined ? undefined : String(raw.expression),
        value: readValue(raw.value),
        sourceXml: JSON.stringify(raw),
      });
    }
  }

  return out;
}
