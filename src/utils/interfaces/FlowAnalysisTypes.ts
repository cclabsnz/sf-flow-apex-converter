import { SecurityContext } from './SecurityTypes.js';
import { FlowElement, LoopMetrics, LoopContext } from './FlowTypes.js';

export interface FlowAnalysisBase {
  flowName: string;
  processType: string;
  totalElements: number;
  dmlOperations: number;
  soqlQueries: number;
  bulkificationScore: number;
  elements: Map<string, FlowElement>;
  recommendations: Array<{ shouldSplit: boolean; reason: string; suggestedClasses: Array<string>; }>;
  apiVersion: string;
  subflows: Array<SubflowAnalysis>;
  operationSummary: OperationSummary;
  shouldBulkify?: boolean;
  bulkificationReason?: string;
  loops: Array<LoopMetrics>;
  loopContexts: Map<string, LoopContext>;
}

export interface ComprehensiveFlowAnalysis extends FlowAnalysisBase {
  name: string;
  objectDependencies: Set<string>;
  securityContext: SecurityContext;
}

export interface SubflowAnalysis extends FlowAnalysisBase {
  totalElementsWithSubflows: number;
  cumulativeDmlOperations: number;
  cumulativeSoqlQueries: number;
  parentFlow?: string;
  depth: number;
}

export interface OperationSummary {
  totalOperations: {
    dml: {
      total: number;
      inLoop: number;
    };
    soql: {
      total: number;
      inLoop: number;
    };
  };
  dmlOperations: OperationSource[];
  soqlQueries: OperationSource[];
}

export interface OperationSource {
  sourceFlow: string;
  count: number;
  inLoop: boolean;
  sources: string[];
}
