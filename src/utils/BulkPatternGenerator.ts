import { ComprehensiveFlowAnalysis } from '../types';
import { FlowElementType } from '../types/elements';
import { BulkOperation, QueryOperation, DMLOperation } from './types/BulkOperationTypes';
import { QueryGenerator } from './generators/QueryGenerator';
import { DMLGenerator } from './generators/DMLGenerator';
import { VariableGenerator } from './generators/VariableGenerator';

export class BulkPatternGenerator {
  private operations = new Map<string, QueryOperation | DMLOperation>();
  private idVariables = new Set<string>();
  private recordCollections = new Map<string, string>();

  generateBulkCode(analysis: ComprehensiveFlowAnalysis): string {
    this.analyzeOperations(analysis);
    
    const code: string[] = [];
    code.push(VariableGenerator.generateVariableDeclarations(this.operations, this.recordCollections, this.idVariables));
    
    // Split operations into query and DML operations
    const queryOps = new Map<string, QueryOperation>();
    const dmlOps = new Map<string, DMLOperation>();
    
    for (const [key, op] of this.operations.entries()) {
      if (op.type === 'QUERY') {
        queryOps.set(key, op as QueryOperation);
      } else {
        dmlOps.set(key, op as DMLOperation);
      }
    }
    
    code.push(QueryGenerator.generateQueries(queryOps, this.recordCollections, this.idVariables));
    code.push(DMLGenerator.generateDMLOperations(dmlOps));
    
    return code.join('\n\n');
  }

  private analyzeOperations(analysis: ComprehensiveFlowAnalysis): void {
    analysis.elements.forEach(flowElement => {
      switch (flowElement.type) {
        case FlowElementType.RECORD_LOOKUP:
          const queryOp = QueryGenerator.analyzeQueryOperation(
            flowElement, 
            this.generateOperationKey.bind(this),
            this.idVariables
          );
          if (queryOp) {
            this.operations.set(queryOp.key, queryOp.operation);
          }
          break;
        case FlowElementType.RECORD_CREATE:
        case FlowElementType.RECORD_UPDATE:
        case FlowElementType.RECORD_DELETE:
          const dmlOp = DMLGenerator.analyzeDMLOperation(
            flowElement, 
            this.generateOperationKey.bind(this)
          );
          if (dmlOp) {
            this.operations.set(dmlOp.key, dmlOp.operation);
          }
          break;
      }
    });

    // Split operations for consolidation
    const queryOps = new Map<string, QueryOperation>();
    const dmlOps = new Map<string, DMLOperation>();
    
    for (const [key, op] of this.operations.entries()) {
      if (op.type === 'QUERY') {
        queryOps.set(key, op as QueryOperation);
      } else {
        dmlOps.set(key, op as DMLOperation);
      }
    }

    QueryGenerator.consolidateQueries(queryOps, this.generateOperationKey.bind(this));
    DMLGenerator.optimizeDMLOperations(dmlOps, this.generateOperationKey.bind(this));

    // Update main operations map
    this.operations.clear();
    for (const [key, op] of queryOps.entries()) {
      this.operations.set(key, op);
    }
    for (const [key, op] of dmlOps.entries()) {
      this.operations.set(key, op);
    }
  }

  private generateOperationKey(
    type: string,
    objectType?: string,
    fields?: string[],
    conditions?: string[],
    operation?: string[]
  ): string {
    return [
      type,
      objectType,
      fields ? fields.sort().join(',') : undefined,
      conditions ? conditions.sort().join(',') : undefined,
      operation ? operation.join(',') : undefined
    ].filter(Boolean).join('_');
  }
}