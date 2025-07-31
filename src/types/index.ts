export * from './analysis';
export * from './elements';
export * from './loops';
export * from './security';

// Re-export types with specific names
export { FlowElements } from './elements';
export { FlowElement } from './elements';
export { FlowMetadata } from './elements';

// Additional utility types
export type FlowMetricsMap = Map<string, import('./elements').FlowElement>;

export interface SubflowDetails {
  name: string;
  elements: import('./elements').FlowElements;
  version: import('./elements').FlowVersion;
  references: SubflowReference[];
  dataFlow: {
    inputs: Map<string, string>;
    outputs: Map<string, string>;
  };
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
  metadata?: import('./elements').FlowMetadata;
  analysis?: {
    elements: import('./elements').FlowElements;
    dmlOperations: number;
    soqlQueries: number;
    complexity: number;
    nestedSubflows: SubflowReference[];
  };
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