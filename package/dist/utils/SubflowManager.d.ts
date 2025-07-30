import { Connection } from 'jsforce';
import { SchemaManager } from './SchemaManager.js';
export interface SubflowAnalysis {
    flowName: string;
    shouldBulkify: boolean;
    bulkificationReason: string;
    complexity: number;
    dmlOperations: number;
    soqlQueries: number;
    parameters: Map<string, any>;
}
export declare class SubflowManager {
    private connection;
    private schemaManager;
    private subflowCache;
    constructor(connection: Connection, schemaManager: SchemaManager);
    analyzeSubflow(subflowName: string): Promise<SubflowAnalysis>;
    private getSubflowMetadata;
    private analyzeSubflowMetadata;
    private countElements;
    private calculateComplexity;
    private shouldBulkifySubflow;
    private getBulkificationReason;
}
