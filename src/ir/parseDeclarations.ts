import { FlowDeclaration } from './types.js';
import { readValue, toArray } from './parseValue.js';

const KINDS: Array<[string, FlowDeclaration['kind']]> = [
  ['variables', 'variable'],
  ['constants', 'constant'],
  ['formulas', 'formula'],
  ['texttemplates', 'textTemplate'],
];

/** Flow booleans arrive as the strings 'true'/'false'. */
function toBool(value: unknown): boolean {
  return String(value) === 'true';
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
