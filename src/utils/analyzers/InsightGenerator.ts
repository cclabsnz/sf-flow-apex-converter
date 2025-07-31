import { ComprehensiveFlowAnalysis } from '../interfaces/FlowAnalysisTypes.js';
import { Logger } from '../Logger.js';

export interface FlowInsight {
  category: 'Performance' | 'Bulkification' | 'Architecture' | 'Security';
  severity: 'High' | 'Medium' | 'Low';
  issue: string;
  impact: string;
  recommendation: string;
}

export class InsightGenerator {
  generateInsights(analysis: ComprehensiveFlowAnalysis): FlowInsight[] {
    const insights: FlowInsight[] = [];
    
    // Analyze loops
    this.analyzeLoopStructure(analysis, insights);
    
    // Analyze subflows
    this.analyzeSubflowUsage(analysis, insights);
    
    // Analyze data operations
    this.analyzeDataOperations(analysis, insights);
    
    // Analyze collections
    this.analyzeCollectionProcessing(analysis, insights);
    
    return insights;
  }
  
  private analyzeLoopStructure(analysis: ComprehensiveFlowAnalysis, insights: FlowInsight[]): void {
    analysis.loops.forEach(loop => {
      // Check DML in loops
      if (loop.containsDML) {
        insights.push({
          category: 'Bulkification',
          severity: 'High',
          issue: `DML operations found inside loop processing ${loop.loopVariables.inputCollection}`,
          impact: 'May hit governor limits with large data sets and perform poorly',
          recommendation: 'Move DML operations outside the loop and use bulk operations'
        });
      }
      
      // Check SOQL in loops
      if (loop.containsSOQL) {
        insights.push({
          category: 'Performance',
          severity: 'High',
          issue: `SOQL queries found inside loop processing ${loop.loopVariables.inputCollection}`,
          impact: 'May hit SOQL governor limits and cause performance issues',
          recommendation: 'Move SOQL queries outside the loop and filter results in memory'
        });
      }
      
      // Check subflows in loops
      if (loop.containsSubflows) {
        insights.push({
          category: 'Architecture',
          severity: 'Medium',
          issue: `Subflow calls found inside loop processing ${loop.loopVariables.inputCollection}`,
          impact: 'Each subflow may contain its own queries and DML operations',
          recommendation: 'Consider consolidating subflow logic or processing in bulk'
        });
      }
    });
  }
  
  private analyzeSubflowUsage(analysis: ComprehensiveFlowAnalysis, insights: FlowInsight[]): void {
    if (analysis.subflows.length > 0) {
      let totalOperations = 0;
      let operationsInLoop = 0;
      
      analysis.subflows.forEach(subflow => {
        totalOperations += subflow.dmlOperations + subflow.soqlQueries;
        if (subflow.isInLoop) {
          operationsInLoop += subflow.dmlOperations + subflow.soqlQueries;
        }
      });
      
      if (operationsInLoop > 0) {
        insights.push({
          category: 'Performance',
          severity: 'High',
          issue: `${operationsInLoop} database operations found in subflows within loops`,
          impact: 'Nested database operations in loops can quickly hit governor limits',
          recommendation: 'Restructure to perform all database operations in bulk outside of loops'
        });
      }
    }
  }
  
  private analyzeDataOperations(analysis: ComprehensiveFlowAnalysis, insights: FlowInsight[]): void {
    const { dml, soql } = analysis.operationSummary.totalOperations;
    
    if (dml.inLoop > 0) {
      insights.push({
        category: 'Bulkification',
        severity: 'High',
        issue: `${dml.inLoop} DML operations found inside loops`,
        impact: 'Individual DML operations in loops will hit governor limits',
        recommendation: 'Collect records to modify and perform single bulk DML outside loops'
      });
    }
    
    if (soql.inLoop > 0) {
      insights.push({
        category: 'Performance',
        severity: 'High',
        issue: `${soql.inLoop} SOQL queries found inside loops`,
        impact: 'Individual queries in loops will hit SOQL governor limits',
        recommendation: 'Query all required records once before loop processing'
      });
    }
  }
  
  private analyzeCollectionProcessing(analysis: ComprehensiveFlowAnalysis, insights: FlowInsight[]): void {
    analysis.loops.forEach(loop => {
      const totalNested = loop.nestedElements.dml + loop.nestedElements.soql + 
                         loop.nestedElements.subflows + loop.nestedElements.other;
      
      if (totalNested > 5) {
        insights.push({
          category: 'Architecture',
          severity: 'Medium',
          issue: `Complex loop processing found with ${totalNested} nested operations`,
          impact: 'Complex loops are harder to maintain and more likely to hit limits',
          recommendation: 'Break down complex loop logic into smaller, focused operations'
        });
      }
    });
  }
}