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
  if (c.apexvalue !== undefined) return { kind: 'apex', raw: String(c.apexvalue) };
  if (c.sobjectvalue !== undefined) return { kind: 'sobject', raw: String(c.sobjectvalue) };
  if (c.formulaexpression !== undefined) return { kind: 'formula', raw: String(c.formulaexpression) };
  if (c.setupreference !== undefined) return { kind: 'setupReference', raw: String(c.setupreference) };
  return { kind: 'none' };
}

export function parseDeclarations(flowData: Record<string, unknown>): FlowDeclaration[] {
  const out: FlowDeclaration[] = [];

  for (const [tag, kind] of KINDS) {
    for (const raw of toArray(flowData[tag])) {
      const name = String(raw.name ?? '');
      if (name === '') continue; // e.g. an empty <variables/> — nothing was declared

      // FlowTextTemplate has no <expression> and no <dataType> in the Flow metadata
      // schema; its body is <text>, and it always evaluates to a String.
      const isTextTemplate = kind === 'textTemplate';
      const expressionSource = isTextTemplate ? raw.text : raw.expression;

      out.push({
        name,
        kind,
        dataType: isTextTemplate ? 'String' : String(raw.datatype ?? 'Object'),
        isCollection: toBool(raw.iscollection),
        isInput: toBool(raw.isinput),
        isOutput: toBool(raw.isoutput),
        expression: expressionSource === undefined ? undefined : String(expressionSource),
        value: readValue(raw.value),
        objectType: raw.objecttype === undefined ? undefined : String(raw.objecttype),
        apexClass: raw.apexclass === undefined ? undefined : String(raw.apexclass),
        sourceJson: JSON.stringify(raw),
      });
    }
  }

  return out;
}
