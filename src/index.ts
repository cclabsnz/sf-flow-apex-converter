#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { SimplifiedFlowAnalyzer } from './utils/SimplifiedFlowAnalyzer.js';
import { BulkifiedApexGenerator } from './utils/BulkifiedApexGenerator.js';
import { Logger, LogLevel } from './utils/Logger.js';

const program = new Command();

// Read version from package.json
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));

program
  .name('sf-flow-apex-converter')
  .description('Convert Salesforce Flows to bulkified Apex classes')
  .version(packageJson.version);

// Analyze command
program
  .command('analyze <flow-file>')
  .description('Analyze a flow for bulkification issues')
  .option('-v, --verbose', 'Show detailed analysis')
  .action(async (flowFile, options) => {
    Logger.setLogLevel(options.verbose ? LogLevel.DEBUG : LogLevel.INFO);
    Logger.enableLogs(true);
    
    if (!fs.existsSync(flowFile)) {
      console.error(`❌ Flow file not found: ${flowFile}`);
      process.exit(1);
    }
    
    try {
      const analyzer = new SimplifiedFlowAnalyzer();
      const results = await analyzer.analyzeSubflows(flowFile);
      
      console.log('\n📊 ANALYSIS RESULTS:');
      for (const [flowName, result] of results) {
        console.log(`\nFlow: ${flowName}`);
        console.log(`  Elements: ${result.elements.size}`);
        console.log(`  Loops: ${result.loops.size}`);
        console.log(`  Issues: ${result.bulkificationIssues.length}`);
        
        if (result.bulkificationIssues.length > 0) {
          console.log('\n  Issues found:');
          result.bulkificationIssues.forEach(issue => {
            console.log(`    ⚠️ ${issue}`);
          });
        }
      }
      
      // Save report
      const report = {
        timestamp: new Date().toISOString(),
        flows: Array.from(results.entries()).map(([name, result]) => ({
          name,
          issues: result.bulkificationIssues,
          requiresBulkification: result.requiresBulkification
        }))
      };
      
      fs.writeFileSync('flow-analysis-report.json', JSON.stringify(report, null, 2));
      console.log('\n📄 Report saved to: flow-analysis-report.json');
      
    } catch (error) {
      console.error('❌ Analysis failed:', error);
      process.exit(1);
    }
  });

// Bulkify command
program
  .command('bulkify <flow-file>')
  .description('Convert a flow to bulkified Apex')
  .option('-o, --output <dir>', 'Output directory', './generated-apex')
  .option('-v, --verbose', 'Show detailed output')
  .option('--no-test', 'Skip test class generation')
  .action(async (flowFile, options) => {
    Logger.setLogLevel(options.verbose ? LogLevel.DEBUG : LogLevel.INFO);
    Logger.enableLogs(true);
    
    if (!fs.existsSync(flowFile)) {
      console.error(`❌ Flow file not found: ${flowFile}`);
      process.exit(1);
    }
    
    try {
      console.log('🚀 Starting flow bulkification...\n');
      
      // Analyze
      const analyzer = new SimplifiedFlowAnalyzer();
      const analysisResults = await analyzer.analyzeSubflows(flowFile);
      
      // Get the primary flow (first one analyzed is always the main flow)
      const primaryFlowName = Array.from(analysisResults.keys())[0];
      const primaryFlow = analysisResults.get(primaryFlowName);
      
      if (!primaryFlow) {
        throw new Error('Failed to analyze flow');
      }
      
      console.log(`✅ Analysis complete: ${primaryFlow.bulkificationIssues.length} issues found`);
      
      if (primaryFlow.bulkificationIssues.length === 0) {
        console.log('✅ Flow is already optimized!');
        return;
      }
      
      // Generate Apex
      const generator = new BulkifiedApexGenerator();
      const result = generator.generateApex(analysisResults, primaryFlowName);
      
      // Create output directory
      const outputDir = path.resolve(options.output);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      // Write files
      const apexPath = path.join(outputDir, `${result.className}.cls`);
      fs.writeFileSync(apexPath, result.apexCode);
      
      const metaContent = `<?xml version="1.0" encoding="UTF-8"?>
<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>59.0</apiVersion>
    <status>Active</status>
</ApexClass>`;
      fs.writeFileSync(`${apexPath}-meta.xml`, metaContent);
      
      if (options.test !== false) {
        const testPath = path.join(outputDir, `${result.className}_Test.cls`);
        fs.writeFileSync(testPath, result.testCode);
        fs.writeFileSync(`${testPath}-meta.xml`, metaContent);
      }
      
      console.log(`\n✅ Generated files in: ${outputDir}`);
      console.log('\n📋 Recommendations:');
      result.recommendations.forEach(rec => console.log(`  ${rec}`));
      
    } catch (error) {
      console.error('❌ Bulkification failed:', error);
      process.exit(1);
    }
  });

// Default action - show help
if (process.argv.length <= 2) {
  program.help();
}

program.parse();