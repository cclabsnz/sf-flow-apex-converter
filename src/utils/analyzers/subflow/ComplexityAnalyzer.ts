import { FlowMetadata } from '../../interfaces/types.js';
import { ElementCounter } from './ElementCounter.js';

export class ComplexityAnalyzer {
  static calculateComplexity(metadata: FlowMetadata, isSubflow: boolean = false): number {
    let complexity = 1;

    // Add complexity for decisions with higher weight for nested decisions
    if (metadata.decisions) {
      const decisionWeight = isSubflow ? 3 : 2;
      complexity += ElementCounter.countElements(metadata.decisions) * decisionWeight;
    }

    // Add complexity for loops with higher weight for nested loops
    if (metadata.loops) {
      const loopWeight = isSubflow ? 4 : 3;
      complexity += ElementCounter.countElements(metadata.loops) * loopWeight;
    }

    // Add complexity for DML operations
    const dmlOps = (metadata.recordCreates ? ElementCounter.countElements(metadata.recordCreates) : 0) +
                  (metadata.recordUpdates ? ElementCounter.countElements(metadata.recordUpdates) : 0) +
                  (metadata.recordDeletes ? ElementCounter.countElements(metadata.recordDeletes) : 0);
    complexity += dmlOps * 2;

    // Add complexity for SOQL queries
    const soqlQueries = (metadata.recordLookups ? ElementCounter.countElements(metadata.recordLookups) : 0) +
                       (metadata.dynamicChoiceSets ? ElementCounter.countElements(metadata.dynamicChoiceSets) : 0);
    complexity += soqlQueries * 2;

    // Add complexity for subflows
    if (metadata.subflows) {
      complexity += ElementCounter.countElements(metadata.subflows) * (isSubflow ? 3 : 2);
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
}