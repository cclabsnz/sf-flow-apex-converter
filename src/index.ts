#!/usr/bin/env node

require('abort-controller/polyfill');
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { Org } from '@salesforce/core';
import { Logger, LogLevel } from './utils/Logger.js';
import { Connection } from 'jsforce';
import { FlowAnalyzer } from './utils/FlowAnalyzer.js';
import { ApexGenerator } from './utils/ApexGenerator.js';
import { SchemaManager } from './utils/SchemaManager.js';
import { SubflowManager } from './utils/SubflowManager.js';
import { MetadataParser } from './utils/parsers/MetadataParser.js';
import { SecurityAnalyzer } from './utils/analyzers/SecurityAnalyzer.js';
import { OrgMetadataFetcher } from './utils/fetchers/OrgMetadataFetcher.js';

const program = new Command();

// Read version from package.json
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));

program
  .name('sf-flow-apex-converter')
  .description('A CLI tool to convert Salesforce Flows to bulkified Apex classes')
  .version(packageJson.version)
  .arguments('<flow-path-or-name>')
  .option('--from-org', 'Fetch flow directly from a connected org')
  .option('--verbose', 'Write detailed analysis to file')
  .option('--show-logs', 'Show logs in console (default: logs written to file only)')
  .option('--deploy', 'Deploy generated Apex class to the org')
  .option('--test-only', 'Validate deployment without deploying')
  .option('--target-org <username>', 'Specify the target org (alias or username)')
  .option('--log-level <level>', 'Set the log level (debug, info, warn, error)', 'info')
  .option('--quiet', 'Disable all logging')
  .action(async (flowPathOrName, options) => {
    // Setup logger
    Logger.setLogLevel(options.logLevel?.toUpperCase() as LogLevel || LogLevel.INFO);
    Logger.enableLogs(!options.quiet);
    Logger.info('CLI', 'Starting...');

    try {
      let flowXml;
      let org;
      let conn;

      const getFlowXml = (flowName: string): string | undefined => {
        const possiblePaths = [
          path.join(process.cwd(), `force-app/main/default/flows/${flowName}.flow-meta.xml`),
          path.join(process.cwd(), `force-app/main/default/flows/${flowName}.flow`)
        ];
        for (const p of possiblePaths) {
          if (fs.existsSync(p)) {
            return fs.readFileSync(p, 'utf8');
          }
        }
        return undefined;
      };

      if (options.fromOrg) {
        Logger.info('CLI', 'Fetching flow from org...');
        const orgAlias = options.targetOrg;
        if (!orgAlias) {
          throw new Error('No target org specified. Use --target-org to specify an org.');
        }
        org = await Org.create({ aliasOrUsername: orgAlias });
        conn = org.getConnection() as any;
        const orgMetadataFetcher = new OrgMetadataFetcher(conn);
        const flowResult = await orgMetadataFetcher.fetchFlowFromOrg(flowPathOrName);
        flowXml = flowResult.Metadata;
        Logger.info('CLI', `Successfully fetched flow "${flowPathOrName}" from org.`);
      } else {
        const fullPath = path.join(process.cwd(), flowPathOrName);
        if (!fs.existsSync(fullPath) || !fs.lstatSync(fullPath).isFile()) {
          throw new Error(`File not found at: ${fullPath}`);
        }
        flowXml = fs.readFileSync(fullPath, 'utf-8');
        conn = new Connection({});
        Logger.info('CLI', `Successfully read flow from file: ${fullPath}`);
      }

      const schemaManager = new SchemaManager(conn);
      const subflowManager = new SubflowManager(conn, schemaManager, getFlowXml);
      const securityAnalyzer = new SecurityAnalyzer();
      const orgMetadataFetcher = new OrgMetadataFetcher(conn);
      const flowAnalyzer = new FlowAnalyzer(conn, schemaManager, subflowManager, securityAnalyzer, orgMetadataFetcher, getFlowXml);

      const parsedMetadata = await MetadataParser.parseMetadata(flowXml);
    const processType = Array.isArray(parsedMetadata.processType)
        ? parsedMetadata.processType[0]
        : (typeof parsedMetadata.processType === 'string'
          ? parsedMetadata.processType
          : 'Flow');

    const wrappedMetadata = {
        Metadata: parsedMetadata,
        definition: {
          DeveloperName: flowPathOrName.replace('.xml', '').replace('.flow-meta', ''),
          ProcessType: processType
        }
      };

      const analysis = await flowAnalyzer.analyzeFlowComprehensive(wrappedMetadata);

      // Import FlowOutputFormatter at the top
      const FlowOutputFormatter = require('./utils/output/FlowOutputFormatter.js').FlowOutputFormatter;
      const formatter = new FlowOutputFormatter();

      // Write detailed analysis to file
      if (options.verbose) {
        const analysisFile = path.join(process.cwd(), 'flow-analysis-details.json');
        fs.writeFileSync(analysisFile, JSON.stringify(analysis, null, 2));
        Logger.info('CLI', `Detailed analysis written to ${analysisFile}`);
      }

      // Display formatted analysis summary
      Logger.info('CLI', '\n=== Flow Analysis ===');
      Logger.info('CLI', formatter.formatBasicAnalysis(analysis));
      
      if (analysis.loops?.length > 0) {
formatter.formatLoopAnalysis(analysis).forEach((line: string) => Logger.info('CLI', line));
      }
      
formatter.formatRecommendations(analysis).forEach((line: string) => Logger.info('CLI', line));
      Logger.info('CLI', '\n===================');

      if (analysis.recommendations.length > 0) {
        Logger.info('CLI', 'Bulkification is required. Generating Apex class...');
        const apexClass = ApexGenerator.generateApex(analysis);

        Logger.info('CLI', '--- Generated Apex Class ---');
        Logger.info('CLI', apexClass);
        Logger.info('CLI', '--------------------------');

        if (options.deploy || options.testOnly) {
          if (!conn) {
             const orgAlias = options.targetOrg;
             if (!orgAlias) {
               throw new Error('No target org specified. Use --target-org to specify an org.');
             }
             org = await Org.create({ aliasOrUsername: orgAlias });
             conn = org.getConnection() as any;
          }
          const result = await ApexGenerator.deployApex(analysis, options.testOnly, options.targetOrg, conn);

          if(result.success) {
            Logger.info('CLI', 'Deployment successful.');
          } else {
            Logger.error('CLI', 'Deployment failed:');
            if(Array.isArray(result.errors)) {
              result.errors.forEach((err: any) => Logger.error('CLI', String(err)));
            } else {
              Logger.error('CLI', String(result.errors));
            }
          }
        }
      } else {
        Logger.info('CLI', 'Flow does not require bulkification. No Apex class generated.');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      Logger.error('CLI', `An error occurred: ${errorMessage}`);
      process.exit(1);
    }
  });

program.parse(process.argv);
