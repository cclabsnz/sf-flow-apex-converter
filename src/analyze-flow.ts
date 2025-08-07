#!/usr/bin/env node

import { SimplifiedFlowAnalyzer } from './utils/SimplifiedFlowAnalyzer.js';
import { Logger, LogLevel } from './utils/Logger.js';
import * as fs from 'fs';
import * as path from 'path';

async function analyzeFlow(flowPath: string) {
  console.log('='.repeat(80));
  console.log('SALESFORCE FLOW BULKIFICATION ANALYZER');
  console.log('='.repeat(80));
  
  // Set logger to INFO level
  Logger.setLogLevel(LogLevel.INFO);
  Logger.enableLogs(true);
  
  if (!fs.existsSync(flowPath)) {
    console.error(`❌ Flow file not found: ${flowPath}`);
    process.exit(1);
  }
  
  const analyzer = new SimplifiedFlowAnalyzer();
  
  try {
    // Analyze the main flow and all its subflows
    const results = await analyzer.analyzeSubflows(flowPath);
    
    console.log('\n' + '='.repeat(80));
    console.log('ANALYSIS SUMMARY');
    console.log('='.repeat(80));
    
    let totalIssues = 0;
    let needsBulkification = false;
    
    for (const [flowName, result] of results) {
      console.log(`\n📋 Flow: ${flowName}`);
      console.log(`   Elements: ${result.elements.size}`);
      console.log(`   Loops: ${result.loops.size}`);
      console.log(`   Subflows: ${result.subflows.length}`);
      console.log(`   Issues: ${result.bulkificationIssues.length}`);
      
      totalIssues += result.bulkificationIssues.length;
      if (result.requiresBulkification) {
        needsBulkification = true;
      }
    }
    
    console.log('\n' + '-'.repeat(80));
    
    if (needsBulkification) {
      console.log('⚠️  BULKIFICATION REQUIRED');
      console.log(`\n📊 Total Issues Found: ${totalIssues}`);
      console.log('\n🔧 Next Steps:');
      console.log('   1. Move all SOQL queries outside of loops');
      console.log('   2. Consolidate DML operations after loops');
      console.log('   3. Review Apex actions for bulk safety');
      console.log('   4. Consider refactoring subflows called in loops');
    } else {
      console.log('✅ Flow is already bulkified - No issues found!');
    }
    
    // Write detailed report
    const reportPath = path.join(process.cwd(), 'flow-analysis-report.json');
    const report = {
      timestamp: new Date().toISOString(),
      flows: Array.from(results.entries()).map(([name, result]) => ({
        name,
        ...result,
        elements: Array.from(result.elements.values()),
        loops: Array.from(result.loops.values()).map(loop => ({
          ...loop,
          elementsInLoop: Array.from(loop.elementsInLoop)
        }))
      }))
    };
    
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📄 Detailed report saved to: ${reportPath}`);
    
  } catch (error) {
    console.error('❌ Analysis failed:', error);
    process.exit(1);
  }
}

// Main execution
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log('Usage: npm run analyze <path-to-flow.xml>');
  console.log('Example: npm run analyze exampleflow.xml');
  process.exit(1);
}

analyzeFlow(args[0]);