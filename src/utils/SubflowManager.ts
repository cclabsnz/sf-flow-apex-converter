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

  private async analyzeApexAction(actionRef: string): Promise<boolean> {
    try {
      const query = `SELECT Id, Body FROM ApexClass WHERE Name = '${actionRef}'`;
      const result = await this.connection.tooling.query(query);
      
      if (result.records.length > 0) {
        const apexBody = result.records[0].Body;
        // Check for SOQL patterns in Apex
        return apexBody.includes('[SELECT') || 
               apexBody.includes('Database.query') ||
               apexBody.includes('.getAll()') ||
               apexBody.includes('.find');
      }
      return false;
    } catch (error) {
      Logger.warn('SubflowManager', `Failed to analyze Apex class ${actionRef}`, error);
      return false;
    }
  }

  private async analyzeSubflowMetadata(metadata: any): Promise<SubflowAnalysis> {
    let dmlOperations = 0;
    let soqlQueries = 0;
    let complexity = 0;
    let soqlInLoop = false;
    const parameters = new Map<string, any>();

    // Count operations
    if (metadata.recordCreates) dmlOperations += this.countElements(metadata.recordCreates);
    if (metadata.recordUpdates) dmlOperations += this.countElements(metadata.recordUpdates);
    if (metadata.recordDeletes) dmlOperations += this.countElements(metadata.recordDeletes);

    // Record Lookups (Get Records)
    if (metadata.recordLookups) {
      const lookups = Array.isArray(metadata.recordLookups) ? metadata.recordLookups : [metadata.recordLookups];
      soqlQueries += lookups.length;
      
      // Check for operations in loops
      if (metadata.loops) {
        const loops = Array.isArray(metadata.loops) ? metadata.loops : [metadata.loops];
        for (const loop of loops) {
          if (loop.elements) {
            const elements = Array.isArray(loop.elements) ? loop.elements : [loop.elements];
            for (const element of elements) {
              // Check Record Lookups
              if (element.recordLookup || element.type?.[0] === 'Record_Lookup') {
                soqlInLoop = true;
                break;
              }
              
              // Check Apex Actions
              if (element.actionCall || element.type?.[0] === 'ActionCall') {
                const actionRef = element.actionCall?.[0]?.actionName?.[0] || element.actionName?.[0];
                if (actionRef && await this.analyzeApexAction(actionRef.replace('apex_', ''))) {
                  soqlInLoop = true;
                  soqlQueries++;
                  break;
                }
              }
              
              // Check Subflows
              if (element.subflow || element.type?.[0] === 'Subflow') {
                const subflowRef = element.subflow?.[0]?.flowName?.[0] || element.flowName?.[0];
                if (subflowRef) {
                  try {
                    const subflowAnalysis = await this.analyzeSubflow(subflowRef);
                    if (subflowAnalysis.soqlQueries > 0) {
                      soqlInLoop = true;
                      soqlQueries += subflowAnalysis.soqlQueries;
                      break;
                    }
                  } catch (error) {
                    Logger.warn('SubflowManager', `Failed to analyze nested subflow ${subflowRef}`, error);
                  }
                }
              }
            }
          }
        }
      }
    }

    // Dynamic Choice Sets
    if (metadata.dynamicChoiceSets) {
      const choiceSets = Array.isArray(metadata.dynamicChoiceSets) ? metadata.dynamicChoiceSets : [metadata.dynamicChoiceSets];
      soqlQueries += choiceSets.length;
    }

    // Record-Triggered Flow
    if (metadata.trigger && metadata.trigger[0]?.type?.[0] === 'RecordAfterSave') {
      soqlQueries++; // Count implicit query for the triggering record
    }

    // Formula Elements with Cross-Object References
    if (metadata.formulas) {
      const formulas = Array.isArray(metadata.formulas) ? metadata.formulas : [metadata.formulas];
      for (const formula of formulas) {
        if (formula.expression?.[0]?.includes('.')) {
          soqlQueries++; // Count cross-object reference queries
        }
      }
    }

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

    const shouldBulkify = this.shouldBulkifySubflow(dmlOperations, soqlQueries, complexity, metadata, soqlInLoop);

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
    metadata: any,
    soqlInLoop: boolean
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
    metadata: any,
    soqlInLoop: boolean
  ): string {
    const reasons: string[] = [];
    
    if (dmlOps > 0) reasons.push(`Contains ${dmlOps} DML operation(s)`);
    if (soqlQueries > 0) {
      let soqlMessage = `Contains ${soqlQueries} SOQL queries`;
      if (soqlInLoop) {
        soqlMessage += ' (detected in: loop recordLookups';
        if (metadata.loops) {
          const loops = Array.isArray(metadata.loops) ? metadata.loops : [metadata.loops];
          for (const loop of loops) {
            if (loop.elements) {
              const elements = Array.isArray(loop.elements) ? loop.elements : [loop.elements];
              for (const element of elements) {
                if (element.actionCall || element.type?.[0] === 'ActionCall') {
                  soqlMessage += ', Apex actions';
                  break;
                }
                if (element.subflow || element.type?.[0] === 'Subflow') {
                  soqlMessage += ', subflows';
                  break;
                }
              }
            }
          }
        }
        soqlMessage += ')';
      }
      reasons.push(soqlMessage);
    }
    if (complexity > 5) reasons.push(`High complexity score: ${complexity}`);
    if (metadata.loops) reasons.push('Contains loops');
    
    return reasons.length > 0 
      ? reasons.join(', ')
      : 'Simple subflow - bulkification not required';
  }
}