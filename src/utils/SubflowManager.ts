import { Connection } from 'jsforce';
import { Logger } from './Logger.js';
import { SchemaManager } from './SchemaManager.js';
import { SubflowParser } from './parsers/SubflowParser.js';
import { SubflowAnalyzer } from './analyzers/SubflowAnalyzer.js';
import { SubflowAnalysis } from './interfaces/analysis/FlowAnalysis.js';
import { FlowElement, FlowMetadata } from './interfaces/types.js';

export class SubflowManager {
  private subflowCache = new Map<string, SubflowAnalysis>();
  private static readonly MAX_RECURSION_DEPTH = 10;
  private parser: SubflowParser;
  private analyzer: SubflowAnalyzer;

  constructor(
    private connection: Connection | null,
    private schemaManager: SchemaManager,
    private getFlowXml?: (flowName: string) => string | undefined
  ) {
    this.parser = new SubflowParser(getFlowXml ? null : connection);
    this.analyzer = new SubflowAnalyzer();
  }

  private formatFlowAnalysis(analysis: SubflowAnalysis, indent: string = ''): string {
    const lines: string[] = [];
    
    lines.push(`${indent}Flow: ${analysis.flowName}`);
    const version = analysis.version || { version: 'Unknown', status: 'Unknown', lastModified: 'Unknown' };
    lines.push(`${indent}Version: ${version.version} (${version.status})`);
    lines.push(`${indent}Last Modified: ${version.lastModified}`);
    lines.push('');

    lines.push(`${indent}Elements:`);
    lines.push(`${indent}  Direct elements: ${analysis.elements.size}`);
    lines.push(`${indent}  Total (with subflows): ${analysis.totalElementsWithSubflows}`);
    lines.push(`${indent}  Breakdown:`);
    analysis.elements.forEach((value, key) => {
      lines.push(`${indent}    ${key}: ${value.type}`);
    });
    lines.push('');

    if (analysis.soqlQueries > 0) {
      lines.push(`${indent}SOQL Analysis:`);
      lines.push(`${indent}  Direct Queries: ${analysis.soqlQueries}`);
      lines.push(`${indent}  Cumulative Queries: ${analysis.cumulativeSoqlQueries}`);
      lines.push(`${indent}  Sources:`);
      (analysis.soqlSources || []).forEach(source => {
        lines.push(`${indent}    - ${source}`);
      });
      lines.push('');
    }

    if (analysis.dmlOperations > 0) {
      lines.push(`${indent}DML Operations:`);
      lines.push(`${indent}  Direct Operations: ${analysis.dmlOperations}`);
      lines.push(`${indent}  Cumulative Operations: ${analysis.cumulativeDmlOperations}`);
      lines.push('');
    }

    if (analysis.subflows.length > 0) {
      lines.push(`${indent}Subflows (${analysis.subflows.length}):`);
      analysis.subflows.forEach(subflow => {
        lines.push(`${indent}  ${subflow.flowName}:`);
        if (subflow.version) {
          lines.push(`${indent}    Version: ${subflow.version.version}`);
        }
        lines.push(`${indent}    Elements: ${subflow.elements.size}`);
      });
      lines.push('');
    }

    lines.push(`${indent}Complexity Analysis:`);
    lines.push(`${indent}  Direct Complexity: ${analysis.complexity}`);
    lines.push(`${indent}  Cumulative Complexity: ${analysis.cumulativeComplexity}`);
    lines.push('');

    lines.push(`${indent}Bulkification:`);
    lines.push(`${indent}  Required: ${analysis.shouldBulkify}`);
    lines.push(`${indent}  Reason: ${analysis.bulkificationReason}`);
    lines.push('');

    lines.push(`${indent}Apex Conversion Recommendation:`);
    const recommendationText = analysis.recommendations.map(rec => rec.reason).join(', ') || 'No recommendations';
    lines.push(`${indent}  Recommendations: ${recommendationText}`);
    const classes = analysis.recommendations.flatMap(rec => rec.suggestedClasses);
    if (classes.length > 0) {
      lines.push(`${indent}  Suggested Classes:`);
      classes.forEach(className => {
        lines.push(`${indent}    - ${className}`);
      });
    }

    return lines.join('\n');
  }

  async analyzeSubflow(
    subflowName: string, 
    depth: number = 0, 
    xml?: string, 
    flowName?: string,
    loopInfo?: { isInLoop: boolean; loopContext: string }
  ): Promise<SubflowAnalysis> {
    if (!xml && this.getFlowXml) {
      xml = this.getFlowXml(subflowName);
    }
    if (depth >= SubflowManager.MAX_RECURSION_DEPTH) {
      Logger.warn('SubflowManager', `Maximum recursion depth reached for subflow: ${subflowName}`);
      return {
        depth: 0,
        loops: [],
        loopContexts: new Map(),
        processType: 'Flow',
        apiVersion: '1.0',
        bulkificationScore: 100,
        totalElements: 0,
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
        elements: new Map<string, FlowElement>(),
        subflows: [],
        totalElementsWithSubflows: 0,
        operationSummary: {
          dmlOperations: [],
          soqlQueries: [],
          totalOperations: {
            dml: { total: 0, inLoop: 0 },
            soql: { total: 0, inLoop: 0 }
          }
        },
        recommendations: [{
          shouldSplit: false,
          reason: 'Max recursion depth reached',
          suggestedClasses: ['MainFlowProcessor']
        }]
      };
    }
    
    if (this.subflowCache.has(subflowName)) {
      Logger.debug('SubflowManager', `Using cached analysis for subflow: ${subflowName}`);
      return this.subflowCache.get(subflowName)!;
    }

    try {
      Logger.debug('SubflowManager', `Fetching metadata for subflow: ${subflowName}`);
      const parsedMetadata = await this.parser.getSubflowMetadata(subflowName, false, xml);
      const analysis = await this.analyzer.analyzeMetadata(
        parsedMetadata,
        depth,
        flowName || subflowName,
        loopInfo
      );
      
      this.subflowCache.set(subflowName, analysis);
      return analysis;
      
    } catch (error) {
      const err = error as Error;
      Logger.error('SubflowManager', `Failed to analyze subflow ${subflowName}`, err);
      throw new Error(`Failed to analyze subflow ${subflowName}: ${err.message}`);
    }
  }
}