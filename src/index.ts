#!/usr/bin/env node

import '#abort-controller';
import { Connection } from 'jsforce';
import { SchemaManager } from './utils/SchemaManager.js';
import { SubflowManager } from './utils/SubflowManager.js';
import { FlowAnalyzer } from './utils/FlowAnalyzer.js';

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

Examples:
  sf-flow-apex-converter MyFlow
  sf-flow-apex-converter /path/to/MyFlow.flow-meta.xml
  sf-flow-apex-converter ./force-app/main/default/flows/MyFlow.flow-meta.xml
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
    console.error('Please provide a flow name');
    process.exit(1);
  }

  const flowName = args[0];
  
  try {
    // TODO: Add proper authentication
    const conn = new Connection({
      // Add connection details
    });

    const schemaManager = new SchemaManager(conn);
    const subflowManager = new SubflowManager(conn, schemaManager);
    const flowAnalyzer = new FlowAnalyzer(conn, schemaManager, subflowManager);

    const flowMetadata = await conn.tooling.query(`SELECT Id, Metadata FROM Flow WHERE DeveloperName = '${flowName}' AND Status = 'Active'`);
    if (flowMetadata.records.length === 0) {
      throw new Error(`Flow ${flowName} not found or not active`);
    }

    const analysis = await flowAnalyzer.analyzeFlowComprehensive(flowMetadata.records[0]);
    console.log(JSON.stringify(analysis, null, 2));

  } catch (error) {
    const err = error as Error;
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();