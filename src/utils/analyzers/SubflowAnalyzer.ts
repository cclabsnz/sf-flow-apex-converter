import { Logger } from '../Logger.js';
import { FlowMetadata, SubflowAnalysis, SubflowDetails } from '../interfaces/SubflowTypes.js';
import { ComplexityAnalyzer } from './ComplexityAnalyzer.js';
import { MetricsCalculator } from './MetricsCalculator.js';
import { ApexRecommender } from './ApexRecommender.js';

export class SubflowAnalyzer {
  private complexityAnalyzer: ComplexityAnalyzer;
  private metricsCalculator: MetricsCalculator;
  private apexRecommender: ApexRecommender;

  constructor() {
    this.complexityAnalyzer = new ComplexityAnalyzer();
    this.metricsCalculator = new MetricsCalculator();
    this.apexRecommender = new ApexRecommender();
  }

  async analyzeMetadata(
    metadata: FlowMetadata,
    depth: number = 0,
    flowName: string = 'Unknown'
  ): Promise<SubflowAnalysis> {
    Logger.info('SubflowAnalyzer', `Analyzing flow ${flowName} version ${metadata._flowVersion.version}`, {
      status: metadata._flowVersion.status,
      lastModified: metadata._flowVersion.lastModified
    });

    // Calculate complexity
    const complexity = this.complexityAnalyzer.calculateComplexity(metadata);
    let cumulativeComplexity = complexity;

    // Calculate metrics
    const metrics = this.metricsCalculator.calculateMetrics(metadata);
    let cumulativeDmlOperations = metrics.dmlOperations;
    let cumulativeSoqlQueries = metrics.soqlQueries;

    const shouldBulkify = this.shouldBulkifySubflow(
      metrics.dmlOperations,
      metrics.soqlQueries,
      complexity,
      metadata,
      metrics.soqlInLoop
    );

    // Calculate apex class split recommendation
    const apexRecommendation = this.apexRecommender.getRecommendation(
      cumulativeComplexity,
      cumulativeDmlOperations,
      cumulativeSoqlQueries,
      [],  // TODO: Pass actual subflows when available
      new Set<string>()
    );

    return {
      flowName,
      shouldBulkify,
      bulkificationReason: this.getBulkificationReason(
        metrics.dmlOperations,
        metrics.soqlQueries,
        complexity,
        metadata,
        metrics.soqlInLoop
      ),
      complexity,
      cumulativeComplexity,
      dmlOperations: metrics.dmlOperations,
      cumulativeDmlOperations,
      soqlQueries: metrics.soqlQueries,
      cumulativeSoqlQueries,
      parameters: metrics.parameters,
      version: metadata._flowVersion,
      soqlSources: Array.from(metrics.soqlSources),
      elements: metrics.elements,
      subflows: [],  // TODO: Pass actual subflows when available
      totalElementsWithSubflows: metrics.elements.total,
      apexRecommendation
    };
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
        soqlMessage += ' (in loop context)';
      }
      reasons.push(soqlMessage);
    }
    if (complexity > 5) reasons.push(`High complexity score: ${complexity}`);
    if (metadata.loops) reasons.push('Contains loops');
    
    return reasons.length > 0 
      ? reasons.join(', ')
      : 'Simple subflow - bulkification not required';
  }
}