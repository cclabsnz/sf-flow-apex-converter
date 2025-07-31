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
    flowName: string = 'Unknown',
    loopInfo?: { isInLoop: boolean; loopContext: string }
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
      metrics.soqlInLoop || (loopInfo?.isInLoop ?? false)
    );

    // Calculate apex class split recommendation
    const apexRecommendation = this.apexRecommender.getRecommendation(
      cumulativeComplexity,
      cumulativeDmlOperations,
      cumulativeSoqlQueries,
      [],  // TODO: Pass actual subflows when available
      new Set<string>()
    );

    // Initialize operation summary
    // Initialize operation summary with this flow's operations
    const operationSummary = {
      dmlOperations: [{
        sourceFlow: flowName,
        count: metrics.dmlOperations,
        sources: Array.from(metrics.dmlSources),
        inLoop: loopInfo?.isInLoop ?? false
      }],
      soqlQueries: [{
        sourceFlow: flowName,
        count: metrics.soqlQueries,
        sources: Array.from(metrics.soqlSources),
        inLoop: metrics.soqlInLoop || (loopInfo?.isInLoop ?? false)
      }],
      totalOperations: {
        dml: {
          total: metrics.dmlOperations,
          inLoop: loopInfo?.isInLoop ? metrics.dmlOperations : 0
        },
        soql: {
          total: metrics.soqlQueries,
          inLoop: (metrics.soqlInLoop || loopInfo?.isInLoop) ? metrics.soqlQueries : 0
        }
      }
    };

    const analysis: SubflowAnalysis = {
      processType: 'Flow',
      recommendations: [],
      apiVersion: metadata._flowVersion?.version || '1.0',
      bulkificationScore: 100,
      totalElements: metrics.elements.total,
      flowName,
      shouldBulkify,
      bulkificationReason: this.getBulkificationReason(
        metrics.dmlOperations,
        metrics.soqlQueries,
        complexity,
        metadata,
        metrics.soqlInLoop || (loopInfo?.isInLoop ?? false)
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
      dmlSources: Array.from(metrics.dmlSources),
      isInLoop: loopInfo?.isInLoop ?? false,
      loopContext: loopInfo?.loopContext,
      elements: metrics.elements,
      subflows: [],  // TODO: Pass actual subflows when available
      totalElementsWithSubflows: metrics.elements.total,
      operationSummary,
      apexRecommendation
    };
    return analysis;
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