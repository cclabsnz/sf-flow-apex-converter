#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { SimplifiedFlowAnalyzer } from './utils/SimplifiedFlowAnalyzer.js';
import { BulkifiedApexGenerator } from './utils/BulkifiedApexGenerator.js';
import { Logger, LogLevel } from './utils/Logger.js';
import { LoweringRefusal } from './lower/context.js';
import { lowerFlow } from './lower/lowerFlow.js';
import { UnsupportedConstructError } from './lower/value.js';

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

// IR command
program
  .command('ir <flow-file>')
  .description('Report what the intermediate representation understands about a Flow')
  .option('--json', 'Emit the coverage summary as JSON')
  .action(async (flowFile: string, options: { json?: boolean }) => {
    if (!fs.existsSync(flowFile)) {
      console.error(`❌ Flow file not found: ${flowFile}`);
      process.exit(1);
    }

    try {
      const { parseFlowFile } = await import('./ir/parseFlow.js');
      const { summariseCoverage } = await import('./ir/coverage.js');

      const ir = await parseFlowFile(flowFile);
      const summary = summariseCoverage(ir);

      if (options.json) {
        console.log(JSON.stringify(summary, null, 2));
        return;
      }

      console.log(`\nFlow: ${summary.flowName}`);
      console.log(`  Elements understood:  ${summary.nodeCount}`);
      console.log(`  Typed bodies:         ${summary.typedBodies} of ${summary.nodeCount}`);
      console.log(`  Declarations read:    ${summary.declarationCount}`);
      if (summary.unsupported.length === 0) {
        console.log(`  Nothing unsupported.\n`);
        return;
      }
      console.log(`  Not modelled (${summary.unsupported.length}):`);
      for (const u of summary.unsupported) {
        console.log(`    ${u.kind}/${u.name ?? '?'} — ${u.reason}`);
      }
      console.log('');
    } catch (error) {
      console.error('❌ IR parsing failed:', error);
      process.exit(1);
    }
  });

// Convert command
program
  .command('convert <flow-file>')
  .description('Convert a Flow to an Apex class (not yet bulkified)')
  .option('-o, --output <dir>', 'directory to write the class into', '.')
  .action(async (flowFile: string, options: { output: string }) => {
    try {
      const { parseFlowFile } = await import('./ir/parseFlow.js');

      const ir = await parseFlowFile(flowFile);
      const { source, manifest } = lowerFlow(ir);
      const classPath = path.join(options.output, `${manifest.className}.cls`);
      const metaPath = `${classPath}-meta.xml`;
      const manifestPath = path.join(options.output, `${manifest.className}-manifest.json`);

      fs.writeFileSync(classPath, `${source}\n`);
      fs.writeFileSync(metaPath,
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">\n' +
        '    <apiVersion>58.0</apiVersion>\n' +
        '    <status>Active</status>\n' +
        '</ApexClass>\n');
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

      console.log(`Wrote ${classPath}`);
      if (manifest.guesses.length > 0) {
        console.log(`  ${manifest.guesses.length} field type(s) guessed from naming`);
      }
      if (manifest.stubs.length > 0) {
        console.log(`  ${manifest.stubs.length} construct(s) stubbed — the class compiles but throws if reached`);
      }
    } catch (error) {
      if (error instanceof LoweringRefusal) {
        // No .cls is written. Half a class whose control flow was guessed is
        // worse than none.
        console.error('Cannot convert this Flow:');
        for (const p of error.problems) console.error(`  - ${p}`);
        process.exitCode = 1;
        return;
      }
      if (error instanceof UnsupportedConstructError) {
        // Distinct from LoweringRefusal (a whole-graph structural failure):
        // this is one construct — e.g. a subflow reference this converter
        // cannot represent — but from the CLI's perspective the outcome is
        // identical. No .cls is written either way.
        console.error('Cannot convert this Flow:');
        console.error(`  - ${error.message}`);
        process.exitCode = 1;
        return;
      }
      throw error;
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