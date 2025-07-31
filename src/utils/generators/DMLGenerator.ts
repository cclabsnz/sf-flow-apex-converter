import { DMLOperation } from '../types/BulkOperationTypes';
import { FlowElement } from '../../types';

export class DMLGenerator {
  static analyzeDMLOperation(
    element: FlowElement,
    generateOperationKey: (type: string, objectType?: string, fields?: string[], conditions?: string[], operation?: string[]) => string
  ): { key: string; operation: DMLOperation } | undefined {
    const objectType = element.properties.object as string;
    const operation = element.type.toString();
    const fields = (element.properties.fields as string[]) || [];

    const key = generateOperationKey('DML', objectType, fields, [], [operation]);
    
    const dmlOp: DMLOperation = {
      type: 'DML',
      objectType,
      operation,
      fields,
      elements: [element]
    };

    return { key, operation: dmlOp };
  }

  static optimizeDMLOperations(
    operations: Map<string, DMLOperation>,
    generateOperationKey: (type: string, objectType?: string, fields?: string[], conditions?: string[], operation?: string[]) => string
  ): void {
    const dmlOps = Array.from(operations.values())
      .filter((op): op is DMLOperation => op.type === 'DML');
    
    const byObjectAndOp = new Map<string, DMLOperation[]>();
    dmlOps.forEach(op => {
      const key = `${op.objectType}_${op.operation}`;
      if (!byObjectAndOp.has(key)) {
        byObjectAndOp.set(key, []);
      }
      byObjectAndOp.get(key)!.push(op);
    });

    byObjectAndOp.forEach((ops, key) => {
      if (ops.length > 1) {
        const [objectType, operation] = key.split('_');
        const fields = new Set<string>();
        ops.forEach(op => {
          if (op.fields) {
            op.fields.forEach(f => fields.add(f));
          }
        });

        const consolidated: DMLOperation = {
          type: 'DML',
          objectType,
          operation,
          fields: Array.from(fields),
          elements: ops.flatMap(op => op.elements)
        };

        ops.forEach(op => {
          const opKey = generateOperationKey('DML', op.objectType, op.fields || [], [], [op.operation!]);
          operations.delete(opKey);
        });

        const newKey = generateOperationKey('DML', objectType, Array.from(consolidated.fields), [], [operation]);
        operations.set(newKey, consolidated);
      }
    });
  }

  private static getDMLOperation(operation: string): string {
    switch (operation) {
      case 'RECORD_CREATE': return 'insert';
      case 'RECORD_UPDATE': return 'update';
      case 'RECORD_DELETE': return 'delete';
      default: return 'insert';
    }
  }

  private static generateCreateOperation(op: DMLOperation, varName: string): string {
    return `
    for (FlowInputRecord record : flowRecords) {
        ${op.objectType} newRecord = new ${op.objectType}();
        ${op.fields!.map(field => `newRecord.${field} = record.get('${field}');`).join('\n        ')}
        ${varName}.add(newRecord);
    }`;
  }

  private static generateUpdateOperation(op: DMLOperation, varName: string): string {
    return `
    Set<Id> recordIds = new Set<Id>(flowRecordIds);
    for (${op.objectType} record : recordsById.values()) {
        if (recordIds.contains(record.Id)) {
            ${varName}.add(record);
        }
    }`;
  }

  private static generateDeleteOperation(op: DMLOperation, varName: string): string {
    return `
    ${varName}.addAll((List<${op.objectType}>) recordsById.values());`;
  }

  static generateDMLOperations(operations: Map<string, DMLOperation>): string {
    const dmlOps: string[] = [];
    
    Array.from(operations.values())
      .filter((op): op is DMLOperation => op.type === 'DML')
      .forEach(op => {
        const varName = `${op.objectType.toLowerCase()}ToProcess`;
        
        dmlOps.push(`List<${op.objectType}> ${varName} = new List<${op.objectType}>();`);
        
        if (op.operation === 'RECORD_CREATE') {
          dmlOps.push(this.generateCreateOperation(op, varName));
        } else if (op.operation === 'RECORD_UPDATE') {
          dmlOps.push(this.generateUpdateOperation(op, varName));
        } else if (op.operation === 'RECORD_DELETE') {
          dmlOps.push(this.generateDeleteOperation(op, varName));
        }
        
        dmlOps.push(`
        if (${varName}.size() > 10000) {
            throw new FlowBulkificationException('DML operation would exceed governor limits');
        }`);
        
        dmlOps.push(`
        if (!${varName}.isEmpty()) {
            List<List<${op.objectType}>> chunks = new List<List<${op.objectType}>>();
            Integer chunkSize = 200;
            for (Integer i = 0; i < ${varName}.size(); i += chunkSize) {
                chunks.add(${varName}.subList(i, Math.min(i + chunkSize, ${varName}.size())));
            }
            
            for (List<${op.objectType}> chunk : chunks) {
                ${this.getDMLOperation(op.operation)}(chunk);
            }
        }`);
      });

    return dmlOps.join('\n\n');
  }
}