export enum FlowElementType {
  RECORD_CREATE = 'recordCreates',
  RECORD_UPDATE = 'recordUpdates',
  RECORD_DELETE = 'recordDeletes',
  RECORD_LOOKUP = 'recordLookups',
  RECORD_ROLLBACK = 'recordRollbacks',
  ASSIGNMENT = 'assignments',
  DECISION = 'decisions',
  LOOP = 'loops',
  SUBFLOW = 'subflows',
  SCREEN = 'screens'
}

export interface FlowElement {
  type: FlowElementType;
  name: string;
  properties: Record<string, unknown>;
  connectors: FlowConnector[];
  isInLoop?: boolean;
  loopContext?: string;
}

export interface FlowConnector {
  targetReference: string;
  conditionLogic?: string;
  conditions?: FlowCondition[];
}

export interface FlowCondition {
  leftValueReference: string;
  operator: string;
  rightValue?: {
    stringValue?: string;
    numberValue?: number;
    booleanValue?: boolean;
  };
}

export interface ElementRef {
  targetReference: string;
  conditionLogic?: string;
  conditions?: FlowCondition[];
}

export interface FlowBaseType {
  type?: string[];
  name?: string[];
  flowName?: string[];
  object?: string[];
  collectionReference?: string[];
  iterationVariable?: string[];
  iterationOrder?: string[];
  targetReference?: string[];
  fields?: Array<{
    name: string[];
  }>;
  connector?: Array<{
    targetReference?: string[];
  }>;
  [key: string]: unknown[] | undefined;
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
  fields?: Array<{
    name: string[];
  }>;
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
  processType?: string[];
  sharingRules?: FlowBaseType[];
  objectPermissions?: FlowBaseType[];
  fieldPermissions?: FlowBaseType[];
  customPermissions?: FlowBaseType[];
}

export interface FlowVersion {
  version: string;
  status: string;
  lastModified: string;
}

export interface AnalysisVersion extends FlowVersion {}

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
  size: number;
  get(key: string): { size: number } | undefined;
  set(key: string, value: number): void;
}