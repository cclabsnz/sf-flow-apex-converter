import * as fs from 'fs';
import * as path from 'path';
import * as xml2js from 'xml2js';
import { parseDeclarations } from './parseDeclarations.js';
import { parseElements } from './parseElements.js';
import { parseStart } from './parseStart.js';
import { FlowIR, UnsupportedConstruct } from './types.js';

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
  // Empty/whitespace-only XML parses to null rather than throwing, so `parsed.flow`
  // would throw a confusing TypeError deep inside — fail clearly instead, naming the file.
  if (parsed === null || parsed === undefined) {
    throw new Error(`"${flowName}" did not parse to a Flow: the XML is empty or has no content`);
  }
  const flowData = (parsed.flow ?? parsed) as Record<string, unknown>;

  const { nodes, unsupported } = parseElements(flowData);

  // scheduledPaths lives under <start>, not at Flow level, so parseElements never
  // sees it. It is deliberately out of scope for this milestone, but it must still
  // be recorded rather than silently disappear.
  const startRaw = flowData.start as Record<string, unknown> | undefined;
  if (startRaw?.scheduledpaths !== undefined) {
    const scheduledPathsUnsupported: UnsupportedConstruct = {
      kind: 'scheduledpaths',
      name: undefined,
      reason: 'Flow element type "scheduledpaths" is not modelled by the IR yet',
      sourceJson: JSON.stringify(startRaw.scheduledpaths),
    };
    unsupported.push(scheduledPathsUnsupported);
  }

  return {
    flowName,
    processType: String(flowData.processtype ?? 'Unknown'),
    runInMode: flowData.runinmode === undefined ? undefined : String(flowData.runinmode),
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
