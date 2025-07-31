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

export type FlowMetricsMap = Map<string, FlowElement>;

export interface ElementCondition extends FlowCondition {}

export interface ElementRef extends FlowConnector {}
