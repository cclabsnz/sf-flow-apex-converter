import { FlowElement } from '../../../types/elements';
import { LoopMetrics, LoopContext } from '../../interfaces/loops/LoopAnalysis.js';

export interface FlowMetrics {
  elements: Map<string, FlowElement>;
  dmlOperations: number;
  soqlQueries: number;
  soqlSources: Set<string>;
  dmlSources: Set<string>;
  soqlInLoop: boolean;
  parameters: Map<string, unknown>;
  loops: LoopMetrics[];
  loopContexts: Map<string, LoopContext>;
  bulkificationScore?: number;
}