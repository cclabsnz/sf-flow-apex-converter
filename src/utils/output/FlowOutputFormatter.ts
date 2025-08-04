import { ComprehensiveFlowAnalysis } from '../interfaces/FlowAnalysisTypes.js';

export class FlowOutputFormatter {
  formatBasicAnalysis(analysis: ComprehensiveFlowAnalysis): string {
    const lines: string[] = [];
    lines.push(`Flow: ${analysis.flowName} (${analysis.processType})`);
    lines.push(`Total Elements: ${analysis.totalElements}`);
    lines.push(`Operations:`);
    lines.push(`  • DML: ${analysis.operationSummary.totalOperations.dml.total} (${analysis.operationSummary.totalOperations.dml.inLoop} in loops)`);
    lines.push(`  • SOQL: ${analysis.operationSummary.totalOperations.soql.total} (${analysis.operationSummary.totalOperations.soql.inLoop} in loops)`);
    if (analysis.subflows.length > 0) {
      lines.push(`Subflows: ${analysis.subflows.length} referenced`);
      analysis.subflows.forEach(subflow => {
        const ops = subflow.operationSummary?.totalOperations;
        if (ops) {
          lines.push(`  • ${subflow.flowName}:`);
          if (ops.dml.total > 0) {
            lines.push(`    - DML: ${ops.dml.total} (${ops.dml.inLoop} in loops)`);
          }
          if (ops.soql.total > 0) {
            lines.push(`    - SOQL: ${ops.soql.total} (${ops.soql.inLoop} in loops)`);
          }
        }
      });
    }
    lines.push(`Bulkification Score: ${analysis.bulkificationScore}`);
    return lines.join('\n');
  }

  formatLoopAnalysis(analysis: ComprehensiveFlowAnalysis): string[] {
    const output: string[] = [];
    
    if (analysis.loops && analysis.loops.length > 0) {
      output.push('\nLoop Analysis:');
      output.push(`Found ${analysis.loops.length} loop(s) in the flow:`);
      
      analysis.loops.forEach((loop, index) => {
        output.push(`\nLoop #${index + 1} - Processing ${loop.loopVariables.inputCollection}`);
        
        const issues: string[] = [];
        if (loop.containsDML) {
          issues.push(`${loop.nestedElements.dml} DML operations (should be moved outside)`);
        }
        if (loop.containsSOQL) {
          issues.push(`${loop.nestedElements.soql} SOQL queries (should be consolidated)`);
        }
        if (loop.containsSubflows) {
          issues.push(`${loop.nestedElements.subflows} subflow calls (needs bulkification)`);
        }
        
        if (issues.length > 0) {
          output.push('  Issues found:');
          issues.forEach(issue => output.push(`    • ${issue}`));
        } else {
          output.push('  No issues found');
        }
      });
    } else {
      output.push('\nNo loops found in the flow.');
    }

    return output;
  }

  formatRecommendations(analysis: ComprehensiveFlowAnalysis): string[] {
    const output: string[] = [];
    
    output.push('\nRecommendations:');
    if (analysis.recommendations.length > 0) {
      analysis.recommendations.forEach(rec => output.push(`  • ${rec}`));
    } else {
      output.push('  No recommendations needed.');
    }

    if (analysis.shouldBulkify) {
      output.push('\nBulkification Required:');
      output.push(`  Reason: ${analysis.bulkificationReason}`);
    }

    return output;
  }
}