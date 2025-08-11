#!/usr/bin/env node

import { SimplifiedFlowAnalyzer } from './utils/SimplifiedFlowAnalyzer.js';
import { BulkifiedApexGenerator } from './utils/BulkifiedApexGenerator.js';
import { Logger, LogLevel } from './utils/Logger.js';
import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { version } from '../package.json';

const program = new Command();

program
  .name('flow-bulkifier')
  .description('Analyze and convert Salesforce Flows to bulkified Apex')
  .version(version)
  .argument('<flow-file>', 'Path to the Flow XML file')
  .option('-o, --output <dir>', 'Output directory for generated Apex', './generated-apex')
  .option('-v, --verbose', 'Show detailed analysis')
  .option('--no-test', 'Skip test class generation')
  .action(async (flowFile, options) => {
    
    console.log('🚀 SALESFORCE FLOW BULKIFICATION TOOL');
    console.log('=' .repeat(80));
    
    // Configure logger
    Logger.setLogLevel(options.verbose ? LogLevel.DEBUG : LogLevel.INFO);
    Logger.enableLogs(true);
    
    if (!fs.existsSync(flowFile)) {
      console.error(`❌ Flow file not found: ${flowFile}`);
      process.exit(1);
    }
    
    try {
      // Step 1: Analyze the flow
      console.log('\n📊 STEP 1: Analyzing Flow Structure...');
      const analyzer = new SimplifiedFlowAnalyzer();
      const analysisResults = await analyzer.analyzeSubflows(flowFile);
      
      // Get the primary flow name (without extension)
      const primaryFlowName = path.basename(flowFile)
        .replace(/\.flow-meta\.xml$/, '')
        .replace(/\.flow\.xml$/, '')
        .replace(/\.xml$/, '');
      
      // Try to find the flow in results
      let primaryFlow = analysisResults.get(primaryFlowName);
      
      // If not found, try the first result (since it's the main flow)
      if (!primaryFlow && analysisResults.size > 0) {
        const firstKey = Array.from(analysisResults.keys())[0];
        primaryFlow = analysisResults.get(firstKey);
        console.log(`   Using flow: ${firstKey}`);
      }
      
      if (!primaryFlow) {
        throw new Error('Failed to analyze primary flow');
      }
      
      // Display analysis summary
      console.log(`\n✅ Analysis Complete:`);
      console.log(`   • Total Flows Analyzed: ${analysisResults.size}`);
      console.log(`   • Elements: ${primaryFlow.elements.size}`);
      console.log(`   • Loops: ${primaryFlow.loops.size}`);
      console.log(`   • Subflows: ${primaryFlow.subflows.length}`);
      console.log(`   • Issues Found: ${primaryFlow.bulkificationIssues.length}`);
      
      if (primaryFlow.bulkificationIssues.length === 0) {
        console.log('\n✅ Flow is already optimized - no bulkification needed!');
        process.exit(0);
      }
      
      // Step 2: Generate Apex
      console.log('\n🔧 STEP 2: Generating Bulkified Apex...');
      const generator = new BulkifiedApexGenerator();
      const result = generator.generateApex(analysisResults, primaryFlowName);
      
      // Step 3: Write files
      console.log('\n💾 STEP 3: Writing Generated Files...');
      
      // Create output directory
      const outputDir = path.resolve(options.output);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      // Write Apex class
      const apexPath = path.join(outputDir, `${result.className}.cls`);
      fs.writeFileSync(apexPath, result.apexCode);
      console.log(`   ✅ Apex Class: ${apexPath}`);
      
      // Write Apex meta file
      const metaContent = `<?xml version="1.0" encoding="UTF-8"?>
<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>59.0</apiVersion>
    <status>Active</status>
</ApexClass>`;
      fs.writeFileSync(`${apexPath}-meta.xml`, metaContent);
      
      // Write test class if requested
      if (options.test !== false) {
        const testPath = path.join(outputDir, `${result.className}_Test.cls`);
        fs.writeFileSync(testPath, result.testCode);
        fs.writeFileSync(`${testPath}-meta.xml`, metaContent);
        console.log(`   ✅ Test Class: ${testPath}`);
      }
      
      // Write analysis report
      const reportPath = path.join(outputDir, 'analysis-report.json');
      const report = {
        timestamp: new Date().toISOString(),
        originalFlow: flowFile,
        generatedClass: result.className,
        issues: primaryFlow.bulkificationIssues,
        recommendations: result.recommendations,
        analysisDetails: Array.from(analysisResults.entries()).map(([name, flow]) => ({
          flowName: name,
          elements: flow.elements.size,
          loops: Array.from(flow.loops.keys()),
          subflows: flow.subflows.map(s => s.flowName),
          issues: flow.bulkificationIssues
        }))
      };
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.log(`   ✅ Analysis Report: ${reportPath}`);
      
      // Display recommendations
      console.log('\n📋 RECOMMENDATIONS:');
      result.recommendations.forEach(rec => {
        console.log(`   ${rec}`);
      });
      
      // Next steps
      console.log('\n🎯 NEXT STEPS:');
      console.log('   1. Review the generated Apex code and customize as needed');
      console.log('   2. Deploy to Salesforce using: sfdx force:source:deploy -p ' + outputDir);
      console.log('   3. Run tests to ensure functionality');
      console.log('   4. Monitor performance and governor limits');
      
      console.log('\n✨ Bulkification complete!');
      
    } catch (error) {
      console.error('\n❌ Error:', error);
      process.exit(1);
    }
  });

program.parse();