import { Connection } from 'jsforce';
import { parseStringPromise } from 'xml2js';
import { SchemaManager } from './SchemaManager.js';
import { Logger } from './Logger.js';

export interface SubflowAnalysis {
  flowName: string;
  shouldBulkify: boolean;
  bulkificationReason: string;
  complexity: number;
  dmlOperations: number;
  soqlQueries: number;
  parameters: Map<string, any>;
}

export class SubflowManager {
  private subflowCache = new Map<string, SubflowAnalysis>();

  constructor(
    private connection: Connection,
    private schemaManager: SchemaManager
  ) {}

  async analyzeSubflow(subflowName: string): Promise<SubflowAnalysis> {
    Logger.info('SubflowManager', `Starting analysis of subflow: ${subflowName}`);
    if (this.subflowCache.has(subflowName)) {
      Logger.debug('SubflowManager', `Using cached analysis for subflow: ${subflowName}`);
      return this.subflowCache.get(subflowName)!;
    }

    try {
      Logger.debug('SubflowManager', `Fetching metadata for subflow: ${subflowName}`);
      const metadata = await this.getSubflowMetadata(subflowName);
      const analysis = await this.analyzeSubflowMetadata(metadata);
      
      this.subflowCache.set(subflowName, analysis);
      Logger.info('SubflowManager', `Analysis complete for subflow: ${subflowName}`, {
        dmlOperations: analysis.dmlOperations,
        soqlQueries: analysis.soqlQueries,
        complexity: analysis.complexity,
        shouldBulkify: analysis.shouldBulkify
      });
      return analysis;
      
    } catch (error) {
      const err = error as Error;
      Logger.error('SubflowManager', `Failed to analyze subflow ${subflowName}`, err);
      throw new Error(`Failed to analyze subflow ${subflowName}: ${err.message}`);
    }
  }

  private async getSubflowMetadata(subflowName: string): Promise<any> {
    const query = `SELECT Id, Metadata FROM Flow WHERE DeveloperName = '${subflowName}' AND Status = 'Active'`;
    
    const result = await this.connection.tooling.query(query);
    if (result.records.length === 0) {
      throw new Error(`Subflow ${subflowName} not found or not active`);
    }

    const metadata = await parseStringPromise(result.records[0].Metadata);
    return metadata.Flow || metadata;
  }

  private async analyzeSubflowMetadata(metadata: any): Promise<SubflowAnalysis> {
    let dmlOperations = 0;
    let soqlQueries = 0;
    let complexity = 0;
    const parameters = new Map<string, any>();

    // Count operations
    if (metadata.recordCreates) dmlOperations += this.countElements(metadata.recordCreates);
    if (metadata.recordUpdates) dmlOperations += this.countElements(metadata.recordUpdates);
    if (metadata.recordDeletes) dmlOperations += this.countElements(metadata.recordDeletes);
    if (metadata.recordLookups) soqlQueries += this.countElements(metadata.recordLookups);

    // Calculate complexity
    complexity = this.calculateComplexity(metadata);

    // Extract parameters
    if (metadata.variables) {
      const variables = Array.isArray(metadata.variables) ? metadata.variables : [metadata.variables];
      variables.forEach((variable: any) => {
        if (variable.isInput?.[0] === 'true' || variable.isOutput?.[0] === 'true') {
          parameters.set(variable.name[0], {
            dataType: variable.dataType?.[0],
            isInput: variable.isInput?.[0] === 'true',
            isOutput: variable.isOutput?.[0] === 'true',
            isCollection: variable.isCollection?.[0] === 'true'
          });
        }
      });
    }

    const shouldBulkify = this.shouldBulkifySubflow(dmlOperations, soqlQueries, complexity, metadata);

    return {
      flowName: metadata.name?.[0] || 'Unknown',
      shouldBulkify,
      bulkificationReason: this.getBulkificationReason(dmlOperations, soqlQueries, complexity, metadata),
      complexity,
      dmlOperations,
      soqlQueries,
      parameters
    };
  }

  private countElements(elements: any): number {
    return Array.isArray(elements) ? elements.length : 1;
  }

  private calculateComplexity(metadata: any): number {
    let complexity = 1;

    // Add complexity for decisions
    if (metadata.decisions) {
      complexity += this.countElements(metadata.decisions) * 2;
    }

    // Add complexity for loops
    if (metadata.loops) {
      complexity += this.countElements(metadata.loops) * 3;
    }

    // Add complexity for subflows
    if (metadata.subflows) {
      complexity += this.countElements(metadata.subflows) * 2;
    }

    return complexity;
  }

  private shouldBulkifySubflow(
    dmlOps: number, 
    soqlQueries: number, 
    complexity: number,
    metadata: any
  ): boolean {
    // Always bulkify if has DML or SOQL
    if (dmlOps > 0 || soqlQueries > 0) return true;
    
    // Bulkify if complex
    if (complexity > 5) return true;
    
    // Bulkify if has loops
    if (metadata.loops) return true;
    
    return false;
  }

  private getBulkificationReason(
    dmlOps: number,
    soqlQueries: number,
    complexity: number,
    metadata: any
  ): string {
    const reasons: string[] = [];
    
    if (dmlOps > 0) reasons.push(`Contains ${dmlOps} DML operation(s)`);
    if (soqlQueries > 0) reasons.push(`Contains ${soqlQueries} SOQL queries`);
    if (complexity > 5) reasons.push(`High complexity score: ${complexity}`);
    if (metadata.loops) reasons.push('Contains loops');
    
    return reasons.length > 0 
      ? reasons.join(', ')
      : 'Simple subflow - bulkification not required';
  }
}