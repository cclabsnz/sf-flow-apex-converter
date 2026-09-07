import * as fs from 'fs';
import * as path from 'path';
import * as xml2js from 'xml2js';
import { parseDeclarations } from './parseDeclarations.js';
import { parseElements } from './parseElements.js';
import { parseStart } from './parseStart.js';
import { FlowIR } from './types.js';

/**
 * Matches the options the existing analyzer uses, so both read identically shaped
 * data: tags lowercased, a single occurrence left unwrapped, attributes merged.
 */
const PARSER_OPTIONS: xml2js.ParserOptions = {
  explicitArray: false,
  mergeAttrs: true,
  normalizeTags: true,
};

export async function parseFlowXml(xmlContent: string, flowName: string): Promise<FlowIR> {
  const parsed = await new xml2js.Parser(PARSER_OPTIONS).parseStringPromise(xmlContent);
  const flowData = (parsed.flow ?? parsed) as Record<string, unknown>;

  const { nodes, unsupported } = parseElements(flowData);

  return {
    flowName,
    processType: String(flowData.processtype ?? 'Unknown'),
    start: parseStart(flowData),
    declarations: parseDeclarations(flowData),
    nodes,
    unsupported,
  };
}

export async function parseFlowFile(xmlPath: string): Promise<FlowIR> {
  const xmlContent = fs.readFileSync(xmlPath, 'utf-8');
  const flowName = path.basename(xmlPath).replace(/\.(flow-meta\.xml|xml)$/i, '');
  return parseFlowXml(xmlContent, flowName);
}
