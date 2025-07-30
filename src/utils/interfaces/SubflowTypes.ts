export interface FlowElements {
  recordLookups?: number;
  recordCreates?: number;
  recordUpdates?: number;
  recordDeletes?: number;
  decisions?: number;
  loops?: number;
  assignments?: number;
  subflows?: number;
  actionCalls?: number;
  total: number;
  [key: string]: number | undefined;
}

export interface FlowVersion {
  number: string;
  status: string;
  lastModified: string;
}

export interface DataFlow {
  inputs: Map<string, string>;
  outputs: Map<string, string>;
}

export interface SubflowReference {
  name: string;
  version?: string;
  inputAssignments?: Array<{
    name: string;
    value: string;
    dataType: string;
  }>;
  outputAssignments?: Array<{
    name: string;
    value: string;
    dataType: string;
  }>;
  isInLoop: boolean;
  parentElement?: string;
}

export interface SubflowDetails {
  name: string;
  elements: FlowElements;
  version: FlowVersion;
  references: SubflowReference[];
  dataFlow: DataFlow;
}

export interface ApexRecommendation {
  shouldSplit: boolean;
  reason: string;
  suggestedClasses: string[];
}

export interface SubflowAnalysis {
  flowName: string;
  shouldBulkify: boolean;
  bulkificationReason: string;
  complexity: number;
  cumulativeComplexity: number;
  dmlOperations: number;
  cumulativeDmlOperations: number;
  soqlQueries: number;
  cumulativeSoqlQueries: number;
  parameters: Map<string, any>;
  version: FlowVersion;
  soqlSources: string[];
  elements: FlowElements;
  subflows: SubflowDetails[];
  totalElementsWithSubflows: number;
  apexRecommendation: ApexRecommendation;
}

export interface FlowMetadata {
  name?: string[];
  recordCreates?: any[];
  recordUpdates?: any[];
  recordDeletes?: any[];
  recordLookups?: any[];
  decisions?: any[];
  loops?: any[];
  assignments?: any[];
  subflows?: any[];
  actionCalls?: any[];
  dynamicChoiceSets?: any[];
  formulas?: any[];
  variables?: any[];
  trigger?: any[];
  processMetadataValues?: any[];
  _flowVersion: FlowVersion;
}