import { ComprehensiveFlowAnalysis, FlowElement, FlowElementType } from './FlowAnalyzer.js';
import { Logger } from './Logger.js';

interface BulkOperation {
  type: 'QUERY' | 'DML' | 'SUBFLOW';
  objectType?: string;
  operation?: string;
  fields?: string[];
  conditions?: string[];
  sortOrder?: string[];
  elements: FlowElement[];
}

export class BulkPatternGenerator {
  private operations: Map<string, BulkOperation> = new Map();
  private idVariables: Set<string> = new Set();
  private recordCollections: Map<string, string> = new Map();

  generateBulkCode(analysis: ComprehensiveFlowAnalysis): string {
    this.analyzeOperations(analysis);
    
    const code: string[] = [];
    code.push(this.generateVariableDeclarations());
    code.push(this.generateQueryOperations());
    code.push(this.generateDMLOperations());
    
    return code.join('\n\n');
  }

  private analyzeOperations(analysis: ComprehensiveFlowAnalysis): void {
    // Group similar operations for bulkification
    analysis.elements.forEach(element => {
      switch (element.type) {
        case FlowElementType.RECORD_LOOKUP:
          this.analyzeQueryOperation(element);
          break;
        case FlowElementType.RECORD_CREATE:
        case FlowElementType.RECORD_UPDATE:
        case FlowElementType.RECORD_DELETE:
          this.analyzeDMLOperation(element);
          break;
      }
    });

    // Optimize operations
    this.optimizeOperations();
  }

  private analyzeQueryOperation(element: FlowElement): void {
    const objectType = element.properties.object;
    const fields = element.properties.fields || [];
    const conditions = element.properties.conditions || [];

    const key = this.generateOperationKey('QUERY', objectType, fields, conditions);
    
    if (!this.operations.has(key)) {
      this.operations.set(key, {
        type: 'QUERY',
        objectType,
        fields,
        conditions,
        elements: []
      });
    }
    
    this.operations.get(key)!.elements.push(element);
    
    // Track ID variables for relationship mapping
    if (element.properties.outputReference) {
      this.idVariables.add(element.properties.outputReference);
    }
  }

  private analyzeDMLOperation(element: FlowElement): void {
    const objectType = element.properties.object;
    const operation = element.type.toString();
    const fields = element.properties.fields || [];

    const key = this.generateOperationKey('DML', objectType, fields, [], [operation]);
    
    if (!this.operations.has(key)) {
      this.operations.set(key, {
        type: 'DML',
        objectType,
        operation,
        fields,
        elements: []
      });
    }
    
    this.operations.get(key)!.elements.push(element);
  }

  private optimizeOperations(): void {
    // Combine related queries
    this.consolidateQueries();
    
    // Optimize DML operations
    this.optimizeDMLOperations();
  }

  private consolidateQueries(): void {
    const queryOps = Array.from(this.operations.values())
      .filter(op => op.type === 'QUERY');
    
    // Group by object type
    const byObject = new Map<string, BulkOperation[]>();
    queryOps.forEach(op => {
      if (!byObject.has(op.objectType!)) {
        byObject.set(op.objectType!, []);
      }
      byObject.get(op.objectType!)!.push(op);
    });

    // Consolidate queries on same object
    byObject.forEach((ops, objectType) => {
      if (ops.length > 1) {
        const consolidated: BulkOperation = {
          type: 'QUERY',
          objectType,
          fields: new Set(ops.flatMap(op => op.fields || [])),
          conditions: new Set(ops.flatMap(op => op.conditions || [])),
          elements: ops.flatMap(op => op.elements)
        };

        // Remove individual operations
        ops.forEach(op => {
          const key = this.generateOperationKey('QUERY', op.objectType, op.fields, op.conditions);
          this.operations.delete(key);
        });

        // Add consolidated operation
        const newKey = this.generateOperationKey('QUERY', objectType, Array.from(consolidated.fields), Array.from(consolidated.conditions));
        this.operations.set(newKey, consolidated);
      }
    });
  }

  private optimizeDMLOperations(): void {
    const dmlOps = Array.from(this.operations.values())
      .filter(op => op.type === 'DML');
    
    // Group by object and operation type
    const byObjectAndOp = new Map<string, BulkOperation[]>();
    dmlOps.forEach(op => {
      const key = `${op.objectType}_${op.operation}`;
      if (!byObjectAndOp.has(key)) {
        byObjectAndOp.set(key, []);
      }
      byObjectAndOp.get(key)!.push(op);
    });

    // Consolidate DML operations
    byObjectAndOp.forEach((ops, key) => {
      if (ops.length > 1) {
        const [objectType, operation] = key.split('_');
        const consolidated: BulkOperation = {
          type: 'DML',
          objectType,
          operation,
          fields: new Set(ops.flatMap(op => op.fields || [])),
          elements: ops.flatMap(op => op.elements)
        };

        // Remove individual operations
        ops.forEach(op => {
          const opKey = this.generateOperationKey('DML', op.objectType, op.fields, [], [op.operation!]);
          this.operations.delete(opKey);
        });

        // Add consolidated operation
        const newKey = this.generateOperationKey('DML', objectType, Array.from(consolidated.fields), [], [operation]);
        this.operations.set(newKey, consolidated);
      }
    });
  }

  private generateVariableDeclarations(): string {
    const declarations: string[] = [];
    
    // Collection variables for each object type
    this.operations.forEach(op => {
      if (op.type === 'QUERY') {
        const varName = `${op.objectType.toLowerCase()}List`;
        declarations.push(`List<${op.objectType}> ${varName} = new List<${op.objectType}>();`);
        this.recordCollections.set(op.objectType!, varName);
      }
    });

    // Map variables for ID relationships
    if (this.idVariables.size > 0) {
      declarations.push('Map<Id, SObject> recordsById = new Map<Id, SObject>();');
    }

    return declarations.join('\n');
  }

  private generateQueryOperations(): string {
    const queries: string[] = [];
    
    this.operations.forEach(op => {
      if (op.type === 'QUERY') {
        const fields = Array.from(new Set(['Id', ...(op.fields || [])]));
        const conditions = op.conditions || [];
        
        const query = `
        List<${op.objectType}> ${this.recordCollections.get(op.objectType!)} = [
            SELECT ${fields.join(', ')}
            FROM ${op.objectType}
            ${conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''}
            ${op.sortOrder ? 'ORDER BY ' + op.sortOrder.join(', ') : ''}
        ];`;
        
        queries.push(query);

        // Add to ID map if needed
        if (this.idVariables.size > 0) {
          queries.push(`recordsById.putAll(new Map<Id, SObject>(${this.recordCollections.get(op.objectType!)}));`);
        }
      }
    });

    return queries.join('\n\n');
  }

  private generateDMLOperations(): string {
    const dmlOps: string[] = [];
    
    this.operations.forEach(op => {
      if (op.type === 'DML') {
        const varName = `${op.objectType.toLowerCase()}ToProcess`;
        
        dmlOps.push(`List<${op.objectType}> ${varName} = new List<${op.objectType}>();`);
        
        // Build records list
        if (op.operation === 'RECORD_CREATE') {
          dmlOps.push(this.generateCreateOperation(op, varName));
        } else if (op.operation === 'RECORD_UPDATE') {
          dmlOps.push(this.generateUpdateOperation(op, varName));
        } else if (op.operation === 'RECORD_DELETE') {
          dmlOps.push(this.generateDeleteOperation(op, varName));
        }
        
        // Add governor limit check
        dmlOps.push(`
        if (${varName}.size() > 10000) {
            throw new FlowBulkificationException('DML operation would exceed governor limits');
        }`);
        
        // Execute DML with chunking if needed
        dmlOps.push(`
        if (!${varName}.isEmpty()) {
            // Process in chunks of 200 to avoid governor limits
            List<List<${op.objectType}>> chunks = new List<List<${op.objectType}>>();
            Integer chunkSize = 200;
            for (Integer i = 0; i < ${varName}.size(); i += chunkSize) {
                chunks.add(${varName}.subList(i, Math.min(i + chunkSize, ${varName}.size())));
            }
            
            for (List<${op.objectType}> chunk : chunks) {
                ${this.getDMLOperation(op.operation!)}(chunk);
            }
        }`);
      }
    });

    return dmlOps.join('\n\n');
  }

  private generateCreateOperation(op: BulkOperation, varName: string): string {
    return `
    for (FlowInputRecord record : flowRecords) {
        ${op.objectType} newRecord = new ${op.objectType}();
        ${op.fields!.map(field => `newRecord.${field} = record.get('${field}');`).join('\n        ')}
        ${varName}.add(newRecord);
    }`;
  }

  private generateUpdateOperation(op: BulkOperation, varName: string): string {
    return `
    Set<Id> recordIds = new Set<Id>(flowRecordIds);
    for (${op.objectType} record : recordsById.values()) {
        if (recordIds.contains(record.Id)) {
            ${varName}.add(record);
        }
    }`;
  }

  private generateDeleteOperation(op: BulkOperation, varName: string): string {
    return `
    ${varName}.addAll((List<${op.objectType}>) recordsById.values());`;
  }

  private getDMLOperation(operation: string): string {
    switch (operation) {
      case 'RECORD_CREATE': return 'insert';
      case 'RECORD_UPDATE': return 'update';
      case 'RECORD_DELETE': return 'delete';
      default: return 'insert';
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
      fields?.sort().join(','),
      conditions?.sort().join(','),
      operation?.join(',')
    ].filter(Boolean).join('_');
  }
}