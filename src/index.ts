#!/usr/bin/env node

// @ts-ignore
require('abort-controller/polyfill');
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { Org } from '@salesforce/core';
import { Logger } from './utils/Logger.js';
import { Connection } from 'jsforce';
import { FlowAnalyzer } from './utils/FlowAnalyzer.js';
import { ApexGenerator } from './utils/ApexGenerator.js';
import { SchemaManager } from './utils/SchemaManager.js';
import { SubflowManager } from './utils/SubflowManager.js';
import { MetadataParser } from './utils/parsers/MetadataParser.js';
import { SecurityAnalyzer } from './utils/analyzers/SecurityAnalyzer.js';
import { OrgMetadataFetcher } from './utils/fetchers/OrgMetadataFetcher.js';

const program = new Command();

program
  .name('sf-flow-apex-converter')
  .description('A CLI tool to convert Salesforce Flows to bulkified Apex classes')
  .version('1.0.42')
  .arguments('<flow-path-or-name>')
  .option('--from-org', 'Fetch flow directly from a connected org')
  .option('--verbose', 'Show detailed analysis and progress')
  .option('--deploy', 'Deploy generated Apex class to the org')
  .option('--test-only', 'Validate deployment without deploying')
  .option('--target-org <username>', 'Specify the target org (alias or username)')
  .option('--log-level <level>', 'Set the log level (debug, info, warn, error)', 'info')
  .option('--quiet', 'Disable logging')
  .action(async (flowPathOrName, options) => {
    const logger = new Logger(options.logLevel, options.quiet);
    logger.info('Starting...');

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
        logger.info('Fetching flow from org...');
        const orgAlias = options.targetOrg || (await Org.defaultUsername());
        if (!orgAlias) {
          throw new Error('No default org set. Use --target-org or set a default org.');
        }
        org = await Org.create({ aliasOrUsername: orgAlias });
        conn = org.getConnection();
        const orgMetadataFetcher = new OrgMetadataFetcher(conn);
        const flowResult = await orgMetadataFetcher.fetchFlowFromOrg(flowPathOrName);
        flowXml = flowResult.Metadata;
        logger.info(`Successfully fetched flow "${flowPathOrName}" from org.`);
      } else {
        const fullPath = path.join(process.cwd(), flowPathOrName);
        if (!fs.existsSync(fullPath) || !fs.lstatSync(fullPath).isFile()) {
          throw new Error(`File not found at: ${fullPath}`);
        }
        flowXml = fs.readFileSync(fullPath, 'utf-8');
        conn = new Connection({});
        logger.info(`Successfully read flow from file: ${fullPath}`);
      }

      const schemaManager = new SchemaManager(conn);
      const subflowManager = new SubflowManager(conn, schemaManager, getFlowXml);
      const securityAnalyzer = new SecurityAnalyzer();
      const orgMetadataFetcher = new OrgMetadataFetcher(conn);
      const flowAnalyzer = new FlowAnalyzer(conn, schemaManager, subflowManager, securityAnalyzer, orgMetadataFetcher, getFlowXml);

      const parsedMetadata = await MetadataParser.parseMetadata(flowXml);
      const wrappedMetadata = {
        Metadata: parsedMetadata,
        definition: {
          DeveloperName: flowPathOrName,
          ProcessType: parsedMetadata.processType?.[0] || 'Flow'
        }
      };

      const analysis = await flowAnalyzer.analyzeFlowComprehensive(wrappedMetadata);

      if (options.verbose) {
        logger.info('--- Flow Analysis ---');
        logger.info(JSON.stringify(analysis, null, 2));
        logger.info('---------------------');
      }

      if (analysis.recommendations.length > 0) {
        logger.info('Bulkification is required. Generating Apex class...');
        const apexClass = ApexGenerator.generateApex(analysis);

        logger.info('--- Generated Apex Class ---');
        logger.info(apexClass);
        logger.info('--------------------------');

        if (options.deploy || options.testOnly) {
          if (!conn) {
             const orgAlias = options.targetOrg || (await Org.defaultUsername());
             if (!orgAlias) {
               throw new Error('No default org set. Use --target-org or set a default org.');
             }
             org = await Org.create({ aliasOrUsername: orgAlias });
             conn = org.getConnection();
          }
          const result = await ApexGenerator.deployApex(analysis, options.testOnly, options.targetOrg, conn);

          if(result.success) {
            logger.info('Deployment successful.');
          } else {
            logger.error('Deployment failed:');
            if(Array.isArray(result.errors)) {
              result.errors.forEach(error => logger.error(error));
            } else {
              logger.error(result.errors);
            }
          }
        }
      } else {
        logger.info('Flow does not require bulkification. No Apex class generated.');
      }
    } catch (error) {
      logger.error(`An error occurred: ${error.message}`);
      process.exit(1);
    }
  });

program.parse(process.argv);
