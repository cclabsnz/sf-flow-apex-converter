import { OperationSummary } from './FlowAnalysisTypes.js';

export interface FlowVersion {
  version: string;
  status: string;
  lastModified: string;
}

export interface DataFlow {
  inputs: Map<string, string>;
  outputs: Map<string, string>;
}

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
  metadata?: FlowMetadata;
  analysis?: {
    elements: FlowElements;
    dmlOperations: number;
    soqlQueries: number;
    complexity: number;
    nestedSubflows: SubflowReference[];
  };
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

export interface FlowElementMetadata {
  name?: string[];
  type?: string[];
  flowName?: string[];
  value?: string[];
  dataType?: string[];
  processMetadataValues?: Array<Record<string, unknown>>;
  inputAssignments?: Array<Record<string, unknown>>;
  outputAssignments?: Array<Record<string, unknown>>;
  expression?: string[];
  elements?: Array<Record<string, unknown>>;
  subflow?: Record<string, unknown> | string[] | string;
}

export interface FlowBaseType {
  type?: string[];
  name?: string[];
  flowName?: string[];
  object?: string[];
  [key: string]: unknown;
}

export interface FlowMetadata {
  [key: string]: unknown;
  name?: string[];
  flow?: {
    subflows?: FlowBaseType[];
    [key: string]: unknown;
  };
  steps?: FlowBaseType[];
  nodes?: FlowBaseType[];
  recordCreates?: FlowBaseType[];
  recordUpdates?: FlowBaseType[];
  recordDeletes?: FlowBaseType[];
  recordLookups?: FlowBaseType[];
  decisions?: FlowBaseType[];
  loops?: FlowBaseType[];
  assignments?: FlowBaseType[];
  subflows?: FlowBaseType[];
  actionCalls?: FlowBaseType[];
  dynamicChoiceSets?: FlowBaseType[];
  formulas?: FlowBaseType[];
  variables?: FlowBaseType[];
  trigger?: FlowBaseType[];
  processMetadataValues?: FlowBaseType[];
  _flowVersion: FlowVersion;
  runInMode?: string[];
}