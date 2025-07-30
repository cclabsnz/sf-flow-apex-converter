import { SchemaManager } from './SchemaManager.js';
import { SubflowManager } from './SubflowManager.js';
import { ComprehensiveFlowAnalysis } from './FlowAnalyzer.js';
export interface ApexGenerationConfig {
    className: string;
    flowAnalysis: ComprehensiveFlowAnalysis;
    bulkThreshold: number;
    preserveStructure: boolean;
}
export declare class ApexGenerator {
    private schemaManager;
    private subflowManager;
    constructor(schemaManager: SchemaManager, subflowManager: SubflowManager);
    generateBulkifiedClass(config: ApexGenerationConfig): Promise<string>;
    private registerHandlebarsHelpers;
    private buildContext;
    private generateCollectionVariables;
    private generateProcessingMethods;
    private generateElementMethod;
    private generateRecordCreateCode;
    private generateRecordUpdateCode;
    private generateRecordDeleteCode;
    private generateRecordLookupCode;
    private generateDecisionCode;
    private generateCondition;
    private mapOperator;
    private generateValueReference;
    private generateBulkOperations;
    private getMainClassTemplate;
}
