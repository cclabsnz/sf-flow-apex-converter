import { FlowMetadata } from '../../types/elements';
import { FlowMetrics } from './metrics/types';
import { ElementCounter } from './metrics/ElementCounter.js';
import { LoopAnalyzer } from './loops/LoopAnalyzer.js';
import { OperationCounter } from './metrics/OperationCounter.js';
import { ParameterExtractor } from './metrics/ParameterExtractor.js';
import { XMLNode } from '../types/XMLNode';
import { BulkificationScorer } from './metrics/BulkificationScorer.js';

export class MetricsCalculator {
  static calculateMetrics(metadata: FlowMetadata | XMLNode): FlowMetrics {
    const flowMetadata = metadata as FlowMetadata;
    const elements = ElementCounter.countFlowElements(flowMetadata);
    
    const { 
      dmlOperations, 
      soqlQueries, 
      soqlSources, 
      dmlSources 
    } = OperationCounter.countOperations(flowMetadata);

    const parameters = ParameterExtractor.extractParameters(flowMetadata);
    const analyzer = new LoopAnalyzer();
    const { loopMetrics, loopContexts } = analyzer.analyze(flowMetadata);

    const bulkificationScore = BulkificationScorer.calculateScore({
      dmlOperations,
      soqlQueries,
      soqlInLoop: loopMetrics.some(loop => loop.containsSOQL),
      dmlInLoop: loopMetrics.some(loop => loop.containsDML),
      loopMetrics,
      loopContexts
    });

    return {
      elements,
      dmlOperations,
      soqlQueries,
      soqlSources,
      dmlSources,
      soqlInLoop: loopMetrics.some(loop => loop.containsSOQL),
      parameters,
      loops: loopMetrics,
      loopContexts,
      bulkificationScore
    };
  }
}