import { Connection } from 'jsforce';
import { Logger } from './Logger.js';
import { SchemaManager } from './SchemaManager.js';
import { SubflowParser } from './SubflowParser.js';
import { SubflowAnalyzer } from './analyzers/SubflowAnalyzer.js';
import { SubflowAnalysis, SubflowDetails } from './interfaces/SubflowTypes.js';

export class SubflowManager {
  private subflowCache = new Map<string, SubflowAnalysis>();
  private static readonly MAX_RECURSION_DEPTH = 10;
  private parser: SubflowParser;
  private analyzer: SubflowAnalyzer;

  constructor(
    private connection: Connection,
    private schemaManager: SchemaManager
  ) {
    this.parser = new SubflowParser(connection);
    this.analyzer = new SubflowAnalyzer();
  }

  private formatFlowAnalysis(analysis: SubflowAnalysis, indent: string = ''): string {
    const lines: string[] = [];
    
    // Flow header
    lines.push(`${indent}Flow: ${analysis.flowName}`);
    lines.push(`${indent}Version: ${analysis.version.version} (${analysis.version.status})`);
    lines.push(`${indent}Last Modified: ${analysis.version.lastModified}`);
    lines.push('');

    // Elements breakdown
    lines.push(`${indent}Elements:`);
    lines.push(`${indent}  Direct elements: ${analysis.elements.total}`);
    lines.push(`${indent}  Total (with subflows): ${analysis.totalElementsWithSubflows}`);
    lines.push(`${indent}  Breakdown:`);
    Object.entries(analysis.elements)
      .filter(([key]) => key !== 'total')
      .filter(([_, value]) => value && value > 0)
      .forEach(([key, value]) => {
        lines.push(`${indent}    ${key}: ${value}`);
      });
    lines.push('');

    // SOQL Analysis
    if (analysis.soqlQueries > 0) {
      lines.push(`${indent}SOQL Analysis:`);
      lines.push(`${indent}  Direct Queries: ${analysis.soqlQueries}`);
      lines.push(`${indent}  Cumulative Queries: ${analysis.cumulativeSoqlQueries}`);
      lines.push(`${indent}  Sources:`);
      analysis.soqlSources.forEach(source => {
        lines.push(`${indent}    - ${source}`);
      });
      lines.push('');
    }

    // DML Operations
    if (analysis.dmlOperations > 0) {
      lines.push(`${indent}DML Operations:`);
      lines.push(`${indent}  Direct Operations: ${analysis.dmlOperations}`);
      lines.push(`${indent}  Cumulative Operations: ${analysis.cumulativeDmlOperations}`);
      lines.push('');
    }

    // Subflows
    if (analysis.subflows && analysis.subflows.length > 0) {
      lines.push(`${indent}Subflows (${analysis.subflows.length}):`);
      analysis.subflows.forEach(subflow => {
        lines.push(`${indent}  ${subflow.name}:`);
        lines.push(`${indent}    Version: ${subflow.version.version}`);
        lines.push(`${indent}    Elements: ${subflow.elements.total}`);
        if (subflow.references.some(ref => ref.isInLoop)) {
          lines.push(`${indent}    Called in Loop: Yes`);
        }
        if (subflow.references.length > 0) {
          const ref = subflow.references[0];
          if (ref.inputAssignments?.length) {
            lines.push(`${indent}    Input Parameters: ${ref.inputAssignments.length}`);
          }
          if (ref.outputAssignments?.length) {
            lines.push(`${indent}    Output Parameters: ${ref.outputAssignments.length}`);
          }
        }
      });
      lines.push('');
    }

    // Complexity Analysis
    lines.push(`${indent}Complexity Analysis:`);
    lines.push(`${indent}  Direct Complexity: ${analysis.complexity}`);
    lines.push(`${indent}  Cumulative Complexity: ${analysis.cumulativeComplexity}`);
    lines.push('');

    // Bulkification
    lines.push(`${indent}Bulkification:`);
    lines.push(`${indent}  Required: ${analysis.shouldBulkify}`);
    lines.push(`${indent}  Reason: ${analysis.bulkificationReason}`);
    lines.push('');

    // Apex Recommendation
    lines.push(`${indent}Apex Conversion Recommendation:`);
    lines.push(`${indent}  Should Split: ${analysis.apexRecommendation.shouldSplit}`);
    lines.push(`${indent}  Reason: ${analysis.apexRecommendation.reason}`);
    if (analysis.apexRecommendation.suggestedClasses.length > 0) {
      lines.push(`${indent}  Suggested Classes:`);
      analysis.apexRecommendation.suggestedClasses.forEach(className => {
        lines.push(`${indent}    - ${className}`);
      });
    }

    return lines.join('\n');
  }

  async analyzeSubflow(subflowName: string, depth: number = 0): Promise<SubflowAnalysis> {
    if (depth >= SubflowManager.MAX_RECURSION_DEPTH) {
      Logger.warn('SubflowManager', `Maximum recursion depth reached for subflow: ${subflowName}`);
      return {
        flowName: subflowName,
        shouldBulkify: true,
        bulkificationReason: 'Maximum recursion depth reached',
        complexity: 1,
        cumulativeComplexity: 1,
        dmlOperations: 0,
        cumulativeDmlOperations: 0,
        soqlQueries: 0,
        cumulativeSoqlQueries: 0,
        parameters: new Map(),
        version: { version: '0', status: 'Unknown', lastModified: new Date().toISOString() },
        soqlSources: [],
        elements: { total: 0 },
        subflows: [],
        totalElementsWithSubflows: 0,
        apexRecommendation: {
          shouldSplit: false,
          reason: 'Max recursion depth reached',
          suggestedClasses: ['MainFlowProcessor']
        }
      };
    }

    console.log(`\nAnalyzing flow: ${subflowName}...`);
    
    if (this.subflowCache.has(subflowName)) {
      Logger.debug('SubflowManager', `Using cached analysis for subflow: ${subflowName}`);
      const analysis = this.subflowCache.get(subflowName)!;
      console.log(this.formatFlowAnalysis(analysis));
      return analysis;
    }

    try {
      Logger.debug('SubflowManager', `Fetching metadata for subflow: ${subflowName}`);
      const metadata = await this.parser.getSubflowMetadata(subflowName);
      const analysis = await this.analyzer.analyzeMetadata(metadata, depth);
      
      this.subflowCache.set(subflowName, analysis);
      console.log(this.formatFlowAnalysis(analysis));
      return analysis;
      
    } catch (error) {
      const err = error as Error;
      Logger.error('SubflowManager', `Failed to analyze subflow ${subflowName}`, err);
      throw new Error(`Failed to analyze subflow ${subflowName}: ${err.message}`);
    }
  }
}