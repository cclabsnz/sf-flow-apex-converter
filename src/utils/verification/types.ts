export interface FlowGraph {
  nodes: Map<string, FlowNode>;
  edges: Map<string, FlowEdge[]>;
}

export interface FlowNode {
  id: string;
  type: string;
  metadata: any;
  inputRefs: string[];
  outputRefs: string[];
}

export interface FlowEdge {
  from: string;
  to: string;
  condition?: string;
}

export interface FlowState {
  name: string;
  type: string;
  transitions: FlowStateTransition[];
  validations: FlowStateValidation[];
}

export interface FlowStateTransition {
  toState: string;
  condition: string;
  actions: FlowAction[];
}

export interface FlowStateValidation {
  type: 'precondition' | 'postcondition' | 'invariant';
  condition: string;
  message: string;
}

export interface FlowAction {
  type: string;
  operation: string;
  inputs: Record<string, any>;
  outputs: Record<string, any>;
}

export interface FlowTestScenario {
  name: string;
  description: string;
  setup: FlowTestSetup;
  inputs: Record<string, any>;
  expectedState: FlowExpectedState;
}

export interface FlowTestSetup {
  sObjects: SObjectSetup[];
  customSetup?: string;
}

export interface SObjectSetup {
  objectType: string;
  records: Record<string, any>[];
}

export interface FlowExpectedState {
  outputs: Record<string, any>;
  dmlOperations: ExpectedDMLOperation[];
  errors?: string[];
}

export interface ExpectedDMLOperation {
  operation: 'insert' | 'update' | 'delete' | 'upsert';
  sObject: string;
  records: Record<string, any>[];
}

export interface ApexClassStructure {
  className: string;
  annotations: string[];
  innerClasses: ApexInnerClass[];
  methods: ApexMethod[];
  properties: ApexProperty[];
}

export interface ApexInnerClass {
  name: string;
  properties: ApexProperty[];
  methods: ApexMethod[];
}

export interface ApexMethod {
  name: string;
  returnType: string;
  parameters: ApexParameter[];
  body: string;
  annotations: string[];
  access: string;
}

export interface ApexParameter {
  name: string;
  type: string;
}

export interface ApexProperty {
  name: string;
  type: string;
  access: string;
  annotations: string[];
}
