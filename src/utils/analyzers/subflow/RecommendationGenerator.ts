import { SubflowDetails, ApexRecommendation, FlowElements } from '../../../types';

export class RecommendationGenerator {
  private static getSubflowGroupKey(subflow: SubflowDetails): string {
    const elements = subflow.elements;
    if (elements.get('recordLookups')?.size || 0 > 0) return 'DataAccess';
    if ((elements.get('recordCreates')?.size || 0) + 
        (elements.get('recordUpdates')?.size || 0) + 
        (elements.get('recordDeletes')?.size || 0) > 0) return 'DataModification';
    if (elements.get('decisions')?.size || 0 > 0) return 'BusinessLogic';
    return 'Utility';
  }

  private static generateClassName(groupType: string, subflowName: string): string {
    const baseName = subflowName.replace(/[^a-zA-Z0-9]/g, '');
    switch (groupType) {
      case 'DataAccess': return `${baseName}DataService`;
      case 'DataModification': return `${baseName}DataManager`;
      case 'BusinessLogic': return `${baseName}BusinessService`;
      default: return `${baseName}Processor`;
    }
  }

  static getApexRecommendation(
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

    if (cumulativeComplexity > complexityThreshold) {
      shouldSplit = true;
      reasons.push(`High cumulative complexity (${cumulativeComplexity} > ${complexityThreshold})`);
    }

    if (cumulativeDmlOps + cumulativeSoqlQueries > operationsThreshold) {
      shouldSplit = true;
      reasons.push(`High number of database operations (${cumulativeDmlOps + cumulativeSoqlQueries} > ${operationsThreshold})`);
    }

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
}