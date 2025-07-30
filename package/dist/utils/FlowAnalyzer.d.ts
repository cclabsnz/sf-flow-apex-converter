import { Connection } from 'jsforce';
import { SchemaManager } from './SchemaManager.js';
import { SubflowManager } from './SubflowManager.js';
export declare enum FlowElementType {
    RECORD_CREATE = "recordCreates",
    RECORD_UPDATE = "recordUpdates",
    RECORD_DELETE = "recordDeletes",
    RECORD_LOOKUP = "recordLookups",
    RECORD_ROLLBACK = "recordRollbacks",
    ASSIGNMENT = "assignments",
    DECISION = "decisions",
    LOOP = "loops",
    SUBFLOW = "subflows",
    SCREEN = "screens"
}
export interface FlowElement {
    type: FlowElementType;
    name: string;
    properties: Record<string, any>;
    connectors: FlowConnector[];
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
export interface ComprehensiveFlowAnalysis {
    flowName: string;
    processType: string;
    totalElements: number;
    dmlOperations: number;
    soqlQueries: number;
    bulkificationScore: number;
    elements: Map<string, FlowElement>;
    objectDependencies: Set<string>;
    recommendations: string[];
}
export declare class FlowAnalyzer {
    private connection;
    private schemaManager;
    private subflowManager;
    constructor(connection: Connection, schemaManager: SchemaManager, subflowManager: SubflowManager);
    analyzeFlowComprehensive(flowMetadata: any): Promise<ComprehensiveFlowAnalysis>;
    private parseAllElements;
    private parseProperties;
    private parseConnectors;
    private parseConditions;
    private calculateMetrics;
    private hasNestedOperation;
    private generateRecommendations;
}
