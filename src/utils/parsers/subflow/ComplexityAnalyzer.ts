import { FlowMetadata } from '../../interfaces/SubflowTypes.js';
import { ElementCounter } from './ElementCounter.js';

export class ComplexityAnalyzer {
  static calculateComplexity(metadata: FlowMetadata): number {
    let complexity = 1;

    // Add complexity for decisions
    if (metadata.decisions) {
      complexity += (Array.isArray(metadata.decisions) ? metadata.decisions.length : 1) * 2;
    }

    // Add complexity for loops
    if (metadata.loops) {
      complexity += (Array.isArray(metadata.loops) ? metadata.loops.length : 1) * 3;
    }

    // Add complexity for DML
    complexity += ElementCounter.countDMLOperations(metadata) * 2;

    // Add complexity for SOQL
    complexity += ElementCounter.countSOQLQueries(metadata) * 2;

    // Add complexity for subflows
    if (metadata.subflows) {
      complexity += (Array.isArray(metadata.subflows) ? metadata.subflows.length : 1) * 2;
    }

    return complexity;
  }
}