import { Connection } from 'jsforce';
import { parseStringPromise } from 'xml2js';
import { SchemaManager } from './SchemaManager.js';
import { Logger } from './Logger.js';

interface FlowElements {
  recordLookups?: number;
  recordCreates?: number;
  recordUpdates?: number;
  recordDeletes?: number;
  decisions?: number;
  loops?: number;
  assignments?: number;
  subflows?: number;
  actionCalls?: number;
  total: number;
  [key: string]: number | undefined;
}

interface SubflowDetails {
  name: string;
  elements: FlowElements;
  version: {
    number: string;
    status: string;
    lastModified: string;
  };
}

export interface SubflowAnalysis {
  flowName: string;
  shouldBulkify: boolean;
  bulkificationReason: string;
  complexity: number;
  cumulativeComplexity: number;
  dmlOperations: number;
  cumulativeDmlOperations: number;
  soqlQueries: number;
  cumulativeSoqlQueries: number;
  parameters: Map<string, any>;
  version: {
    number: string;
    status: string;
    lastModified: string;
  };
  soqlSources: string[];
  elements: FlowElements;
  subflows: SubflowDetails[];
  totalElementsWithSubflows: number;
  apexRecommendation: {
    shouldSplit: boolean;
    reason: string;
    suggestedClasses: string[];
  };
}

export class SubflowManager {
  private subflowCache = new Map<string, SubflowAnalysis>();
  private static readonly MAX_RECURSION_DEPTH = 10;
  private recursionDepth = new Map<string, number>();

  constructor(
    private connection: Connection,
    private schemaManager: SchemaManager
  ) {}

  private formatFlowAnalysis(analysis: SubflowAnalysis, indent: string = ''): string {
    const lines: string[] = [];
    
    // Flow header
    lines.push(`${indent}Flow: ${analysis.flowName}`);
    lines.push(`${indent}Version: ${analysis.version.number} (${analysis.version.status})`);
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
      lines.push(`${indent}  Total Queries: ${analysis.soqlQueries}`);
      lines.push(`${indent}  Sources:`);
      analysis.soqlSources.forEach(source => {
        lines.push(`${indent}    - ${source}`);
      });
      lines.push('');
    }

    // DML Operations
    if (analysis.dmlOperations > 0) {
      lines.push(`${indent}DML Operations: ${analysis.dmlOperations}`);
      lines.push('');
    }

    // Subflows
    if (analysis.subflows && analysis.subflows.length > 0) {
      lines.push(`${indent}Subflows (${analysis.subflows.length}):`);
      analysis.subflows.forEach(subflow => {
        lines.push(`${indent}  ${subflow.name}:`);
        lines.push(`${indent}    Version: ${subflow.version.number}`);
        lines.push(`${indent}    Elements: ${subflow.elements.total}`);
      });
      lines.push('');
    }

    // Bulkification
    lines.push(`${indent}Bulkification:`);
    lines.push(`${indent}  Required: ${analysis.shouldBulkify}`);
    lines.push(`${indent}  Reason: ${analysis.bulkificationReason}`);
    lines.push(`${indent}  Complexity Score: ${analysis.complexity}`);

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
        dmlOperations: 0,
        soqlQueries: 0,
        parameters: new Map(),
        version: { number: '0', status: 'Unknown', lastModified: new Date().toISOString() },
        soqlSources: [],
        elements: { total: 0 },
        subflows: [],
        totalElementsWithSubflows: 0
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
      const metadata = await this.getSubflowMetadata(subflowName);
      const analysis = await this.analyzeSubflowMetadata(metadata);
      
      this.subflowCache.set(subflowName, analysis);
      
      // Print detailed analysis
      console.log(this.formatFlowAnalysis(analysis));
      
      return analysis;
      
    } catch (error) {
      const err = error as Error;
      Logger.error('SubflowManager', `Failed to analyze subflow ${subflowName}`, err);
      throw new Error(`Failed to analyze subflow ${subflowName}: ${err.message}`);
    }
  }

  private async getSubflowMetadata(subflowName: string): Promise<any> {
    const query = `SELECT Id, Metadata, VersionNumber, Status, LastModifiedDate FROM Flow WHERE DeveloperName = '${subflowName}' AND Status = 'Active'`;
    
    Logger.debug('SubflowManager', `Fetching metadata for flow: ${subflowName}`, { query });
    const result = await this.connection.tooling.query(query);
    
    if (result.records.length === 0) {
      Logger.warn('SubflowManager', `Flow ${subflowName} not found or not active`);
      throw new Error(`Subflow ${subflowName} not found or not active`);
    }

    const flow = result.records[0];
    Logger.info('SubflowManager', `Found flow: ${subflowName}`, {
      version: flow.VersionNumber,
      status: flow.Status,
      lastModified: flow.LastModifiedDate
    });

    const metadata = await parseStringPromise(flow.Metadata);
    return {
      ...metadata.Flow || metadata,
      _flowVersion: {
        version: flow.VersionNumber,
        status: flow.Status,
        lastModified: flow.LastModifiedDate
      }
    };
  }

  private async analyzeApexAction(actionRef: string): Promise<{hasSOQL: boolean; details?: string}> {
    try {
      const query = `SELECT Id, Body, Name, LastModifiedDate FROM ApexClass WHERE Name = '${actionRef}'`;
      Logger.debug('SubflowManager', `Analyzing Apex class: ${actionRef}`, { query });
      
      const result = await this.connection.tooling.query(query);
      if (result.records.length === 0) {
        Logger.warn('SubflowManager', `Apex class not found: ${actionRef}`);
        return { hasSOQL: false };
      }

      const apexClass = result.records[0];
      Logger.info('SubflowManager', `Found Apex class: ${actionRef}`, {
        lastModified: apexClass.LastModifiedDate
      });

      const soqlPatterns = [
        { pattern: '[SELECT', type: 'SOQL Query' },
        { pattern: 'Database.query', type: 'Dynamic SOQL' },
        { pattern: '.getAll()', type: 'getAll Query' },
        { pattern: '.find', type: 'find Query' }
      ];

      const foundPatterns = soqlPatterns
        .filter(p => apexClass.Body.includes(p.pattern))
        .map(p => p.type);

      if (foundPatterns.length > 0) {
        const details = `Found ${foundPatterns.join(', ')}`;
        Logger.info('SubflowManager', `${actionRef} contains SOQL operations`, { details });
        return { hasSOQL: true, details };
      }

      Logger.debug('SubflowManager', `No SOQL operations found in ${actionRef}`);
      return { hasSOQL: false };
    } catch (error) {
      Logger.warn('SubflowManager', `Failed to analyze Apex class ${actionRef}`, error);
      return { hasSOQL: false };
    }
  }

  private countFlowElements(metadata: any): FlowElements {
    const elements: FlowElements = { total: 0 };
    
    const elementTypes = [
      { key: 'recordLookups', name: 'Record Lookups' },
      { key: 'recordCreates', name: 'Record Creates' },
      { key: 'recordUpdates', name: 'Record Updates' },
      { key: 'recordDeletes', name: 'Record Deletes' },
      { key: 'decisions', name: 'Decisions' },
      { key: 'loops', name: 'Loops' },
      { key: 'assignments', name: 'Assignments' },
      { key: 'actionCalls', name: 'Apex Actions' },
      { key: 'subflows', name: 'Subflows' }
    ];

    for (const type of elementTypes) {
      if (metadata[type.key]) {
        const count = this.countElements(metadata[type.key]);
        elements[type.key] = count;
        elements.total += count;
        Logger.debug('SubflowManager', `Found ${count} ${type.name}`);
      }
    }

    return elements;
  }

  private async analyzeSubflowMetadata(metadata: any): Promise<SubflowAnalysis> {
    let dmlOperations = 0;
    let soqlQueries = 0;
    let complexity = 0;
    let cumulativeComplexity = 0;
    let cumulativeDmlOperations = 0;
    let cumulativeSoqlQueries = 0;
    let soqlInLoop = false;
    const parameters = new Map<string, any>();
    const soqlSources = new Set<string>();
    const flowVersion = metadata._flowVersion;
    const subflowDetails: SubflowDetails[] = [];
    let totalElementsWithSubflows = 0;
    const processedSubflows = new Set<string>();

    Logger.info('SubflowManager', `Analyzing flow version ${flowVersion.version}`, {
      status: flowVersion.status,
      lastModified: flowVersion.lastModified
    });

    // Count operations
    if (metadata.recordCreates) dmlOperations += this.countElements(metadata.recordCreates);
    if (metadata.recordUpdates) dmlOperations += this.countElements(metadata.recordUpdates);
    if (metadata.recordDeletes) dmlOperations += this.countElements(metadata.recordDeletes);

    // Record Lookups (Get Records)
    if (metadata.recordLookups) {
      const lookups = Array.isArray(metadata.recordLookups) ? metadata.recordLookups : [metadata.recordLookups];
      soqlQueries += lookups.length;
      soqlSources.add('Record Lookups');
      
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
                if (actionRef) {
                  const apexAnalysis = await this.analyzeApexAction(actionRef.replace('apex_', ''));
                  if (apexAnalysis.hasSOQL) {
                    soqlInLoop = true;
                    soqlQueries++;
                    soqlSources.add(`Apex Action: ${actionRef} (${apexAnalysis.details})`);
                    break;
                  }
                }
              }
              
              // Check Subflows
              if (element.subflow || element.type?.[0] === 'Subflow' || element.type === 'Subflow' || (element.type && Array.isArray(element.type) && element.type.includes('Subflow'))) {
                const subflowRef = element.subflow?.[0]?.flowName?.[0] || element.flowName?.[0] || element.subflow?.flowName?.[0] || (element.subflow && typeof element.subflow === 'string' ? element.subflow : null);
                if (subflowRef) {
                  try {
                    const subflowAnalysis = await this.analyzeSubflow(subflowRef, depth + 1);
                    if (subflowAnalysis.soqlQueries > 0) {
                      soqlInLoop = true;
                      soqlQueries += subflowAnalysis.soqlQueries;
                    soqlSources.add(`Subflow: ${subflowRef}`);
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
      soqlSources.add('Dynamic Choice Sets');
    }

    // Record-Triggered Flow
    if (metadata.trigger && metadata.trigger[0]?.type?.[0] === 'RecordAfterSave') {
      soqlQueries++; // Count implicit query for the triggering record
      soqlSources.add('Record-Triggered Flow');
    }

    // Formula Elements with Cross-Object References
    if (metadata.formulas) {
      const formulas = Array.isArray(metadata.formulas) ? metadata.formulas : [metadata.formulas];
      for (const formula of formulas) {
        if (formula.expression?.[0]?.includes('.')) {
          soqlQueries++; // Count cross-object reference queries
          soqlSources.add('Cross-Object Formula References');
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

    // Count elements in current flow
    const elements = this.countFlowElements(metadata);
    totalElementsWithSubflows = elements.total;

    // Process all subflows and detect if they're in loops
    if (metadata.loops) {
      const loops = Array.isArray(metadata.loops) ? metadata.loops : [metadata.loops];
      for (const loop of loops) {
        if (loop.elements) {
          const elements = Array.isArray(loop.elements) ? loop.elements : [loop.elements];
          for (const element of elements) {
            if (element.subflow || element.type?.[0] === 'Subflow') {
              const subflowRef = element.subflow?.[0]?.flowName?.[0] || element.flowName?.[0];
              if (subflowRef) {
                try {
                  const subflowAnalysis = await this.analyzeSubflow(subflowRef);
                  subflowDetails.push({
                    name: subflowRef,
                    elements: subflowAnalysis.elements,
                    version: subflowAnalysis.version
                  });
                  totalElementsWithSubflows += subflowAnalysis.elements.total;

                  // Check if this subflow has SOQL
                  if (subflowAnalysis.soqlQueries > 0) {
                    soqlInLoop = true;
                    soqlQueries += subflowAnalysis.soqlQueries;
                    soqlSources.add(`Subflow in Loop: ${subflowRef} (contains ${subflowAnalysis.soqlQueries} SOQL queries)`);
                  }

                  // Check if this subflow has nested subflows with SOQL
                  if (subflowAnalysis.subflows.length > 0) {
                    for (const nestedSubflow of subflowAnalysis.subflows) {
                      soqlSources.add(`Nested Subflow in Loop: ${nestedSubflow.name}`);
                    }
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

    // Process subflows not in loops
    if (metadata.subflows) {
      const allSubflows = Array.isArray(metadata.subflows) ? metadata.subflows : [metadata.subflows];
      for (const subflow of allSubflows) {
        const subflowRef = subflow.flowName?.[0];
        if (subflowRef) {
          try {
            const subflowAnalysis = await this.analyzeSubflow(subflowRef);
            
            // Check if this subflow is already analyzed (was in a loop)
            if (!subflowDetails.some(sf => sf.name === subflowRef)) {
              subflowDetails.push({
                name: subflowRef,
                elements: subflowAnalysis.elements,
                version: subflowAnalysis.version
              });
              totalElementsWithSubflows += subflowAnalysis.elements.total;
            }

            // Add SOQL info if found
            if (subflowAnalysis.soqlQueries > 0) {
              soqlQueries += subflowAnalysis.soqlQueries;
              soqlSources.add(`Subflow: ${subflowRef} (contains ${subflowAnalysis.soqlQueries} SOQL queries)`);
            }
          } catch (error) {
            Logger.warn('SubflowManager', `Failed to analyze subflow ${subflowRef}`, error);
          }
        }
      }
    }

    // Calculate apex class split recommendation
    const apexRecommendation = this.getApexRecommendation(
      cumulativeComplexity,
      cumulativeDmlOperations,
      cumulativeSoqlQueries,
      subflowDetails,
      processedSubflows
    );

    const analysis = {
      flowName: metadata.name?.[0] || 'Unknown',
      shouldBulkify,
      bulkificationReason: this.getBulkificationReason(dmlOperations, soqlQueries, complexity, metadata, soqlInLoop),
      complexity,
      cumulativeComplexity,
      dmlOperations,
      cumulativeDmlOperations,
      soqlQueries,
      cumulativeSoqlQueries,
      parameters,
      version: {
        number: flowVersion.version,
        status: flowVersion.status,
        lastModified: flowVersion.lastModified
      },
      soqlSources: Array.from(soqlSources),
      elements,
      subflows: subflowDetails,
      totalElementsWithSubflows,
      apexRecommendation
    };

    Logger.info('SubflowManager', `Analysis complete for flow: ${analysis.flowName}`, {
      version: analysis.version,
      elements: {
        direct: elements.total,
        withSubflows: totalElementsWithSubflows,
        breakdown: elements
      },
      subflows: subflowDetails.map(sf => ({
        name: sf.name,
        elements: sf.elements.total,
        version: sf.version.number
      })),
      soqlQueries: analysis.soqlQueries,
      soqlSources: analysis.soqlSources,
      dmlOperations: analysis.dmlOperations,
      complexity: analysis.complexity,
      shouldBulkify: analysis.shouldBulkify
    });

    return analysis;
  }

  private countElements(elements: any): number {
    return Array.isArray(elements) ? elements.length : 1;
  }

  private calculateComplexity(metadata: any, isSubflow: boolean = false): number {
    let complexity = 1;

    // Add complexity for decisions with higher weight for nested decisions
    if (metadata.decisions) {
      const decisionWeight = isSubflow ? 3 : 2;
      complexity += this.countElements(metadata.decisions) * decisionWeight;
    }

    // Add complexity for loops with higher weight for nested loops
    if (metadata.loops) {
      const loopWeight = isSubflow ? 4 : 3;
      complexity += this.countElements(metadata.loops) * loopWeight;
    }

    // Add complexity for DML operations
    const dmlOps = (metadata.recordCreates ? this.countElements(metadata.recordCreates) : 0) +
                  (metadata.recordUpdates ? this.countElements(metadata.recordUpdates) : 0) +
                  (metadata.recordDeletes ? this.countElements(metadata.recordDeletes) : 0);
    complexity += dmlOps * 2;

    // Add complexity for SOQL queries
    const soqlQueries = (metadata.recordLookups ? this.countElements(metadata.recordLookups) : 0) +
                       (metadata.dynamicChoiceSets ? this.countElements(metadata.dynamicChoiceSets) : 0);
    complexity += soqlQueries * 2;

    // Add complexity for subflows
    if (metadata.subflows) {
      complexity += this.countElements(metadata.subflows) * (isSubflow ? 3 : 2);
    }

    // Add complexity for formula elements
    if (metadata.formulas) {
      const formulas = Array.isArray(metadata.formulas) ? metadata.formulas : [metadata.formulas];
      formulas.forEach((formula: any) => {
        if (formula.expression?.[0]?.includes('.')) {
          complexity += 1; // Additional complexity for cross-object formulas
        }
      });
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

  private getApexRecommendation(
    cumulativeComplexity: number,
    cumulativeDmlOps: number,
    cumulativeSoqlQueries: number,
    subflows: SubflowDetails[],
    processedSubflows: Set<string>
  ): { shouldSplit: boolean; reason: string; suggestedClasses: string[] } {
    const complexityThreshold = 15;
    const operationsThreshold = 5;
    const suggestedClasses: string[] = [];
    let shouldSplit = false;
    let reasons: string[] = [];

    // Check complexity threshold
    if (cumulativeComplexity > complexityThreshold) {
      shouldSplit = true;
      reasons.push(`High cumulative complexity (${cumulativeComplexity} > ${complexityThreshold})`);
    }

    // Check operations threshold
    if (cumulativeDmlOps + cumulativeSoqlQueries > operationsThreshold) {
      shouldSplit = true;
      reasons.push(`High number of database operations (${cumulativeDmlOps + cumulativeSoqlQueries} > ${operationsThreshold})`);
    }

    // Analyze subflow patterns
    const subflowGroups = new Map<string, SubflowDetails[]>();
    subflows.forEach(sf => {
      if (!processedSubflows.has(sf.name)) {
        const key = this.getSubflowGroupKey(sf);
        if (!subflowGroups.has(key)) {
          subflowGroups.set(key, []);
        }
        subflowGroups.get(key)!.push(sf);
      }
    });

    // Suggest class splits based on subflow groups
    subflowGroups.forEach((group, key) => {
      if (group.length > 0) {
        const className = this.generateClassName(key, group[0].name);
        suggestedClasses.push(className);
      }
    });

    if (suggestedClasses.length === 0) {
      suggestedClasses.push('MainFlowProcessor');
    }

    return {
      shouldSplit,
      reason: reasons.join(', ') || 'Simple flow structure - single class recommended',
      suggestedClasses
    };
  }

  private getSubflowGroupKey(subflow: SubflowDetails): string {
    const elements = subflow.elements;
    if (elements.recordLookups && elements.recordLookups > 0) return 'DataAccess';
    if ((elements.recordCreates || 0) + (elements.recordUpdates || 0) + (elements.recordDeletes || 0) > 0) return 'DataModification';
    if (elements.decisions && elements.decisions > 0) return 'BusinessLogic';
    return 'Utility';
  }

  private generateClassName(groupType: string, subflowName: string): string {
    const baseName = subflowName.replace(/[^a-zA-Z0-9]/g, '');
    switch (groupType) {
      case 'DataAccess': return `${baseName}DataService`;
      case 'DataModification': return `${baseName}DataManager`;
      case 'BusinessLogic': return `${baseName}BusinessService`;
      default: return `${baseName}Processor`;
    }
  }
}