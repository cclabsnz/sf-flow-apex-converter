#!/usr/bin/env node

// @ts-ignore
require('abort-controller/polyfill');
import { Connection } from 'jsforce';
import { SchemaManager } from './utils/SchemaManager.js';
import { SubflowManager } from './utils/SubflowManager.js';
import { FlowAnalyzer } from './utils/FlowAnalyzer.js';
import * as fs from 'fs';
import * as path from 'path';
import { parseStringPromise } from 'xml2js';
import { Logger, LogLevel } from './utils/Logger.js';

async function main() {
  let args = process.argv.slice(2);
  
  const HELP_TEXT = `
Salesforce Flow to Apex Converter

Usage:
  sf-flow-apex-converter <flowName>
  sf-flow-apex-converter [options]

Options:
  -v, --version     Show version number
  -h, --help        Show help information
  --log-level      Set log level (debug, info, warn, error)
  --quiet          Disable logging

Arguments:
  flowName          The Flow API Name (not the label) from your Salesforce org
                    This is the DeveloperName field in Salesforce, found in the
                    URL when editing the flow or in Setup > Flows list view.

Examples:
  # Using Flow API Name from Salesforce org:
  sf-flow-apex-converter MyFlow_API_Name

  # Using local flow file with absolute path:
  sf-flow-apex-converter /path/to/MyFlow.flow-meta.xml

  # Using local flow file with relative path:
  sf-flow-apex-converter ./force-app/main/default/flows/MyFlow.flow-meta.xml

Note: When specifying a flow from your org, use the Flow API Name (DeveloperName),
      not the Flow Label. The API Name can be found in Setup > Flows or in the
      URL when editing the flow (/builder/flowBuilder.app?flowId=301XXXXX).
`;

  if (args[0] === '--help' || args[0] === '-h') {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  if (args[0] === '--version' || args[0] === '-v') {
    const { version } = require('../package.json');
    console.log(`v${version}`);
    process.exit(0);
  }

  if (args.length === 0) {
    console.error('Please provide a flow name or path');
    process.exit(1);
  }

  const input = args[0];
  let flowContent: string;
  let flowMetadata: any;
  
  // Handle logging options
  const logLevelArg = args.find((arg, i) => arg === '--log-level' && i + 1 < args.length);
  if (logLevelArg) {
    const levelIndex = args.indexOf(logLevelArg);
    const level = args[levelIndex + 1].toUpperCase();
    if (level in LogLevel) {
      Logger.setLogLevel(level as LogLevel);
      args.splice(levelIndex, 2); // Remove log level args
    }
  }

  if (args.includes('--quiet')) {
    Logger.enableLogs(false);
    args = args.filter(arg => arg !== '--quiet');
  }

  try {
    Logger.info('CLI', 'Starting flow analysis');
    // Check if input is a file path
    if (input.endsWith('.flow-meta.xml')) {
      const filePath = path.resolve(input);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Flow file not found: ${filePath}`);
      }
      flowContent = fs.readFileSync(filePath, 'utf8');
      let parsed;
      try {
        parsed = await parseStringPromise(flowContent);
        if (!parsed.Flow) {
          throw new Error('Invalid Flow XML: Missing <Flow> root element');
        }
      } catch (parseError) {
        throw new Error(`Failed to parse Flow XML: ${(parseError as Error).message}`);
      }
      flowMetadata = {
        records: [{
          Metadata: parsed.Flow,
          definition: {
            DeveloperName: path.basename(filePath, '.flow-meta.xml'),
            ProcessType: parsed.Flow?.processType?.[0] || 'Flow'
          }
        }]
      };
    } else {
      // Treat input as flow name
      // TODO: Add proper authentication
      const conn = new Connection({
        // Add connection details
      });

      const schemaManager = new SchemaManager(conn);
      const subflowManager = new SubflowManager(conn, schemaManager);
      const flowAnalyzer = new FlowAnalyzer(conn, schemaManager, subflowManager);

      flowMetadata = await conn.tooling.query(`SELECT Id, Metadata FROM Flow WHERE DeveloperName = '${input}' AND Status = 'Active'`);
      if (flowMetadata.records.length === 0) {
        throw new Error(`Flow ${input} not found or not active`);
      }
    }

    const conn = new Connection({});
    const schemaManager = new SchemaManager(conn);
    const subflowManager = new SubflowManager(conn, schemaManager);
    const flowAnalyzer = new FlowAnalyzer(conn, schemaManager, subflowManager);
    const analysis = await flowAnalyzer.analyzeFlowComprehensive(flowMetadata.records[0]);
    console.log(JSON.stringify(analysis, null, 2));

  } catch (error) {
    const err = error as Error;
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();