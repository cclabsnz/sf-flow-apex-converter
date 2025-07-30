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

async function main() {
  const args = process.argv.slice(2);
  
  const HELP_TEXT = `
Salesforce Flow to Apex Converter

Usage:
  sf-flow-apex-converter <flowName>
  sf-flow-apex-converter [options]

Options:
  -v, --version     Show version number
  -h, --help        Show help information

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
  
  try {
    // Check if input is a file path
    if (input.endsWith('.flow-meta.xml')) {
      const filePath = path.resolve(input);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Flow file not found: ${filePath}`);
      }
      flowContent = fs.readFileSync(filePath, 'utf8');
      const parsed = await parseStringPromise(flowContent);
      flowMetadata = {
        records: [{
          Metadata: flowContent,
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