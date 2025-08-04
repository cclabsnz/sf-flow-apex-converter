import { LoopContext } from '../../interfaces/loops/LoopAnalysis.js';
import { FlowMetrics } from './types.js';
import { FlowElementType } from '../../interfaces/FlowTypes.js';

interface ScoringInput {
  dmlOperations: number;
  soqlQueries: number;
  soqlInLoop: boolean;
  dmlInLoop: boolean;
  loopMetrics: FlowMetrics['loops'];
  loopContexts: Map<string, LoopContext>;
}

export class BulkificationScorer {
  private static readonly DML_WEIGHT = 30;
  private static readonly SOQL_WEIGHT = 30;
  private static readonly LOOP_WEIGHT = 40;

  static calculateScore(input: ScoringInput): number {
    let score = 100;

    // Penalize DML operations in loops heavily
    if (input.dmlInLoop) {
      score -= this.DML_WEIGHT;
    }

    // Penalize SOQL queries in loops heavily
    if (input.soqlInLoop) {
      score -= this.SOQL_WEIGHT;
    }

    // Analyze loop paths to find indirect operations through subflows
    let loopsWithIndirectOperations = 0;

    for (const [elementName, context] of input.loopContexts.entries()) {
      if (!context.path || !context.pathTypes) continue;

      // Check if this path leads to a subflow
      const hasSubflow = context.pathTypes.some(type => 
        type === FlowElementType.SUBFLOW || type === FlowElementType.ACTION_CALL
      );

      if (hasSubflow) {
        const loopIndex = context.pathTypes.findIndex(type => type === FlowElementType.LOOP);
        const subflowIndex = context.pathTypes.findIndex(type => 
          type === FlowElementType.SUBFLOW || type === FlowElementType.ACTION_CALL
        );

        // If the subflow is after a loop in the path, it's potentially problematic
        if (loopIndex !== -1 && subflowIndex !== -1 && loopIndex < subflowIndex) {
          loopsWithIndirectOperations++;
        }
      }
    }

    // Penalize loops with indirect operations through subflows
    if (loopsWithIndirectOperations > 0) {
      score -= Math.min(this.LOOP_WEIGHT, loopsWithIndirectOperations * 10);
    }

    // Ensure score stays between 0 and 100
    return Math.max(0, Math.min(100, score));
  }
}