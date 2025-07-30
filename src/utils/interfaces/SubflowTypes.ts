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
  version: string;  // Use version instead of number to match FlowMetadata._flowVersion
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

export interface FlowElementMetadata {
  name?: string[];
  type?: string[];
  flowName?: string[];
  value?: string[];
  dataType?: string[];
  processMetadataValues?: any[];
  inputAssignments?: any[];
  outputAssignments?: any[];
  expression?: string[];
  elements?: any[];
  subflow?: any;  // Can be array, string, or object
}

export interface FlowMetadata {
  [key: string]: any;  // Add index signature
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