export enum FlowElementType {
  START = 'start',
  TRIGGER = 'trigger',
  ASSIGNMENT = 'assignments',
  DECISION = 'decisions',
  RECORD_CREATE = 'recordCreates',
  RECORD_UPDATE = 'recordUpdates',
  RECORD_DELETE = 'recordDeletes',
  RECORD_LOOKUP = 'recordLookups',
  RECORD_ROLLBACK = 'recordRollbacks',
  LOOP = 'loops',
  SUBFLOW = 'subflows',
  SCREEN = 'screens'
}

export interface FlowElement {
  id: string;
  name: string;
  type: FlowElementType;
  object?: string;
  flowName?: string;
  conditions?: any[];
  properties?: Record<string, unknown>;
  connectors?: FlowConnector[];
  inputReferences?: string[];
  outputReference?: string;
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

export type FlowMetricsMap = Map<string, FlowElement>;

export interface ElementCondition extends FlowCondition {}

export interface ElementRef extends FlowConnector {}

export interface LoopMetrics {
  totalLoops: number;
  itemsProcessed: string[];
  containsDML: boolean;
  containsSOQL: boolean;
  containsSubflows: boolean;
  nestedElements: {
    dml: number;
    soql: number;
    subflows: number;
    other: number;
  };
  loopVariables: {
    inputCollection: string;
    currentItem: string;
    iterationOrder: 'Asc' | 'Desc';
  };
}

export interface LoopContext {
  isInLoop: boolean;
  loopReferenceName?: string;
  parentLoopNames?: string[];
  depth: number;
}
