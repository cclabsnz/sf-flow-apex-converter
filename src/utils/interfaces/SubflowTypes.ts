import { FlowBaseType, FlowMetadata, FlowVersion } from '../../types/elements';
import { FlowElementsImpl } from '../analyzers/FlowElementsImpl';

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
  metadata?: FlowMetadata;
  analysis?: {
    elements: FlowElementsImpl;
    dmlOperations: number;
    soqlQueries: number;
    complexity: number;
    nestedSubflows: SubflowReference[];
  };
}

export interface SubflowDetails {
  name: string;
  elements: FlowElementsImpl;
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
  object?: string[];
  records?: string[];
  [key: string]: unknown;
}

export type { FlowBaseType, FlowMetadata, FlowVersion };