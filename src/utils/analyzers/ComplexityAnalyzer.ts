import { FlowMetadata } from '../interfaces/SubflowTypes.js';
import { Logger } from '../Logger.js';

export class ComplexityAnalyzer {
  private countElements(elements: any): number {
    return Array.isArray(elements) ? elements.length : 1;
  }

  calculateComplexity(metadata: FlowMetadata, isSubflow: boolean = false): number {
    let complexity = 1;

    // Add complexity for decisions with higher weight for nested decisions
    if (metadata.decisions) {
      const decisionWeight = isSubflow ? 3 : 2;
      complexity += this.countElements(metadata.decisions) * decisionWeight;
      Logger.debug('ComplexityAnalyzer', `Added decision complexity: ${this.countElements(metadata.decisions) * decisionWeight}`);
    }

    // Add complexity for loops with higher weight for nested loops
    if (metadata.loops) {
      const loopWeight = isSubflow ? 4 : 3;
      complexity += this.countElements(metadata.loops) * loopWeight;
      Logger.debug('ComplexityAnalyzer', `Added loop complexity: ${this.countElements(metadata.loops) * loopWeight}`);
    }

    // Add complexity for DML operations
    const dmlOps = (metadata.recordCreates ? this.countElements(metadata.recordCreates) : 0) +
                  (metadata.recordUpdates ? this.countElements(metadata.recordUpdates) : 0) +
                  (metadata.recordDeletes ? this.countElements(metadata.recordDeletes) : 0);
    complexity += dmlOps * 2;
    if (dmlOps > 0) {
      Logger.debug('ComplexityAnalyzer', `Added DML complexity: ${dmlOps * 2}`);
    }

    // Add complexity for SOQL queries
    const soqlQueries = (metadata.recordLookups ? this.countElements(metadata.recordLookups) : 0) +
                       (metadata.dynamicChoiceSets ? this.countElements(metadata.dynamicChoiceSets) : 0);
    complexity += soqlQueries * 2;
    if (soqlQueries > 0) {
      Logger.debug('ComplexityAnalyzer', `Added SOQL complexity: ${soqlQueries * 2}`);
    }

    // Add complexity for subflows
    if (metadata.subflows) {
      const subflowWeight = isSubflow ? 3 : 2;
      complexity += this.countElements(metadata.subflows) * subflowWeight;
      Logger.debug('ComplexityAnalyzer', `Added subflow complexity: ${this.countElements(metadata.subflows) * subflowWeight}`);
    }

    // Add complexity for formula elements
    if (metadata.formulas) {
      const formulas = Array.isArray(metadata.formulas) ? metadata.formulas : [metadata.formulas];
      let formulaComplexity = 0;
      formulas.forEach((formula: any) => {
        if (formula.expression?.[0]?.includes('.')) {
          formulaComplexity += 1; // Additional complexity for cross-object formulas
        }
      });
      complexity += formulaComplexity;
      if (formulaComplexity > 0) {
        Logger.debug('ComplexityAnalyzer', `Added formula complexity: ${formulaComplexity}`);
      }
    }

    Logger.info('ComplexityAnalyzer', `Total complexity score: ${complexity}`);
    return complexity;
  }
}