import { SubflowDetails, ApexRecommendation } from '../interfaces/SubflowTypes.js';
import { Logger } from '../Logger.js';

export class ApexRecommender {
  private static readonly COMPLEXITY_THRESHOLD = 15;
  private static readonly OPERATIONS_THRESHOLD = 5;

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

  getRecommendation(
    cumulativeComplexity: number,
    cumulativeDmlOps: number,
    cumulativeSoqlQueries: number,
    subflows: SubflowDetails[],
    processedSubflows: Set<string>
  ): ApexRecommendation {
    const suggestedClasses: string[] = [];
    let shouldSplit = false;
    const reasons: string[] = [];

    // Check complexity threshold
    if (cumulativeComplexity > ApexRecommender.COMPLEXITY_THRESHOLD) {
      shouldSplit = true;
      reasons.push(`High cumulative complexity (${cumulativeComplexity} > ${ApexRecommender.COMPLEXITY_THRESHOLD})`);
      Logger.info('ApexRecommender', `Recommending split due to high complexity: ${cumulativeComplexity}`);
    }

    // Check operations threshold
    const totalOperations = cumulativeDmlOps + cumulativeSoqlQueries;
    if (totalOperations > ApexRecommender.OPERATIONS_THRESHOLD) {
      shouldSplit = true;
      reasons.push(`High number of database operations (${totalOperations} > ${ApexRecommender.OPERATIONS_THRESHOLD})`);
      Logger.info('ApexRecommender', `Recommending split due to high operation count: ${totalOperations}`);
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
        Logger.debug('ApexRecommender', `Suggesting class: ${className} for group: ${key}`);
      }
    });

    if (suggestedClasses.length === 0) {
      suggestedClasses.push('MainFlowProcessor');
    }

    Logger.info('ApexRecommender', 'Generated recommendation', {
      shouldSplit,
      reasons,
      suggestedClasses
    });

    return {
      shouldSplit,
      reason: reasons.join(', ') || 'Simple flow structure - single class recommended',
      suggestedClasses
    };
  }
}