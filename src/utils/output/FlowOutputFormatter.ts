import { ComprehensiveFlowAnalysis } from '../interfaces/FlowAnalysisTypes.js';

export class FlowOutputFormatter {
  formatBasicAnalysis(analysis: ComprehensiveFlowAnalysis): string {
    return JSON.stringify({
      flowName: analysis.flowName,
      processType: analysis.processType,
      totalElements: analysis.totalElements,
      dmlOperations: analysis.dmlOperations,
      soqlQueries: analysis.soqlQueries,
      bulkificationScore: analysis.bulkificationScore
    }, null, 2);
  }

  formatLoopAnalysis(analysis: ComprehensiveFlowAnalysis): string[] {
    const output: string[] = [];
    
    if (analysis.loops && analysis.loops.length > 0) {
      output.push('\nLoop Analysis:');
      analysis.loops.forEach(loop => {
        output.push(`\nLoop processing ${loop.loopVariables.inputCollection}:`);
        
        if (loop.containsDML) {
          output.push(`  - Contains ${loop.nestedElements.dml} DML operation(s) - Should be moved outside loop`);
        }
        if (loop.containsSOQL) {
          output.push(`  - Contains ${loop.nestedElements.soql} SOQL queries - Should be consolidated before loop`);
        }
        if (loop.containsSubflows) {
          output.push(`  - Contains ${loop.nestedElements.subflows} subflow call(s) - Consider bulkifying`);
        }
        if (loop.nestedElements.other > 0) {
          output.push(`  - Contains ${loop.nestedElements.other} other operation(s)`);
        }
      });
    }

    return output;
  }

  formatRecommendations(analysis: ComprehensiveFlowAnalysis): string[] {
    const output: string[] = [];
    
    if (analysis.recommendations.length > 0) {
      output.push('\nRecommendations:');
      analysis.recommendations.forEach(rec => output.push(` - ${rec}`));
    }

    return output;
  }
}