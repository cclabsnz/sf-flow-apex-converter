import { Logger } from './Logger.js';
import {
  FlowElements,
  FlowMetadata,
  SubflowAnalysis,
  SubflowDetails,
  ApexRecommendation
} from './interfaces/SubflowTypes.js';

export class SubflowAnalyzer {
  private countElements(elements: any): number {
    return Array.isArray(elements) ? elements.length : 1;
  }

  private countFlowElements(metadata: FlowMetadata): FlowElements {
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
        Logger.debug('SubflowAnalyzer', `Found ${count} ${type.name}`);
      }
    }

    return elements;
  }

  private calculateComplexity(metadata: FlowMetadata, isSubflow: boolean = false): number {
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
    metadata: FlowMetadata,
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
    metadata: FlowMetadata,
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
  ): ApexRecommendation {
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

  async analyzeMetadata(
    metadata: FlowMetadata,
    depth: number = 0
  ): Promise<SubflowAnalysis> {
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

    Logger.info('SubflowAnalyzer', `Analyzing flow version ${flowVersion.version}`, {
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
    cumulativeComplexity = complexity;
    cumulativeDmlOperations = dmlOperations;
    cumulativeSoqlQueries = soqlQueries;

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

    // Calculate apex class split recommendation
    const apexRecommendation = this.getApexRecommendation(
      cumulativeComplexity,
      cumulativeDmlOperations,
      cumulativeSoqlQueries,
      subflowDetails,
      processedSubflows
    );

    const elements = this.countFlowElements(metadata);
    totalElementsWithSubflows = elements.total;

    return {
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
      version: flowVersion,
      soqlSources: Array.from(soqlSources),
      elements,
      subflows: subflowDetails,
      totalElementsWithSubflows,
      apexRecommendation
    };
  }
}