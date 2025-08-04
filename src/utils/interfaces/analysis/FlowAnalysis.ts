import { FlowElement, FlowVersion } from '../../../types/elements';
import { SecurityContext } from '../security/SecurityContext.js';
import { LoopMetrics, LoopContext } from '../loops/LoopAnalysis.js';
import { ApexRecommendation } from '../SubflowTypes.js';
import { FlowElementType } from '../FlowTypes.js';

export interface OperationSource {
  sourceFlow: string;
  count: number;
  inLoop: boolean;
  sources: string[];
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

export interface SubflowInfo {
  isInLoop: boolean;
  loopReferenceName: string;
  path?: string[];
  pathTypes?: FlowElementType[];
  depth: number;
}

export interface FlowAnalysisBase {
  flowName: string;
  processType: string;
  totalElements: number;
  dmlOperations: number;
  soqlQueries: number;
  bulkificationScore: number;
  elements: Map<string, FlowElement>;
  recommendations: ApexRecommendation[];
  apiVersion: string;
  subflows: SubflowAnalysis[];
  operationSummary: OperationSummary;
  shouldBulkify?: boolean;
  bulkificationReason?: string;
  loops: LoopMetrics[];
  loopContexts: Map<string, LoopContext>;
  complexity?: number;
  cumulativeComplexity?: number;
  version?: FlowVersion;
  soqlSources?: string[];
  dmlSources?: string[];
  isInLoop?: boolean;
  parameters?: Map<string, unknown>;
  totalElementsWithSubflows?: number;
  cumulativeDmlOperations?: number;
  cumulativeSoqlQueries?: number;
  parentFlow?: string;
  depth?: number;
}

export interface ComprehensiveFlowAnalysis extends FlowAnalysisBase {
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