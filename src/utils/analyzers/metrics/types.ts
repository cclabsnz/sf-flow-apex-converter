import { FlowElement, LoopMetrics, LoopContext } from '../../../types';

export interface FlowMetrics {
  elements: Map<string, FlowElement>;
  dmlOperations: number;
  soqlQueries: number;
  soqlSources: Set<string>;
  dmlSources: Set<string>;
  soqlInLoop: boolean;
  parameters: Map<string, any>;
  loops: LoopMetrics[];
  loopContexts: Map<string, LoopContext>;
}