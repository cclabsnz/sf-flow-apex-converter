import { QueryOperation } from '../types/BulkOperationTypes';
import { FlowElement } from '../../types';
import { FlowElementType } from '../../types/elements';

export class QueryGenerator {
  static analyzeQueryOperation(
    element: FlowElement,
    generateOperationKey: (type: string, objectType?: string, fields?: string[], conditions?: string[]) => string,
    idVariables: Set<string>
  ): { key: string; operation: QueryOperation } | undefined {
    const objectType = element.properties.object as string;
    const fields = (element.properties.fields as string[]) || [];
    const conditions = (element.properties.conditions as string[]) || [];

    const key = generateOperationKey('QUERY', objectType, fields, conditions);
    
    const operation: QueryOperation = {
      type: 'QUERY',
      objectType,
      fields,
      conditions,
      elements: [element]
    };
    
    if (element.properties.outputReference as string) {
      idVariables.add(element.properties.outputReference as string);
    }

    return { key, operation };
  }

  static consolidateQueries(
    operations: Map<string, QueryOperation>,
    generateOperationKey: (type: string, objectType?: string, fields?: string[], conditions?: string[]) => string
  ): void {
    const queryOps = Array.from(operations.values())
      .filter((op): op is QueryOperation => op.type === 'QUERY');
    
    const byObject = new Map<string, QueryOperation[]>();
    queryOps.forEach(op => {
      if (!byObject.has(op.objectType)) {
        byObject.set(op.objectType, []);
      }
      byObject.get(op.objectType)!.push(op);
    });

    byObject.forEach((ops, objectType) => {
      if (ops.length > 1) {
        const fields = new Set<string>();
        const conditions = new Set<string>();
        ops.forEach(op => {
          if (op.fields) {
            op.fields.forEach(f => fields.add(f));
          }
          if (op.conditions) {
            op.conditions.forEach(c => conditions.add(c));
          }
        });

        const consolidated: QueryOperation = {
          type: 'QUERY',
          objectType,
          fields: Array.from(fields),
          conditions: Array.from(conditions),
          elements: ops.flatMap(op => op.elements)
        };

        ops.forEach(op => {
          const key = generateOperationKey('QUERY', op.objectType, op.fields || [], op.conditions || []);
          operations.delete(key);
        });

        const newKey = generateOperationKey('QUERY', objectType, Array.from(consolidated.fields), Array.from(consolidated.conditions));
        operations.set(newKey, consolidated);
      }
    });
  }

  static generateQueries(
    operations: Map<string, QueryOperation>,
    recordCollections: Map<string, string>,
    idVariables: Set<string>
  ): string {
    const queries: string[] = [];
    
    Array.from(operations.values())
      .filter((op): op is QueryOperation => op.type === 'QUERY')
      .forEach(op => {
        const fields = Array.from(new Set(['Id', ...op.fields]));
        const conditions = op.conditions;
        
        const query = `
        List<${op.objectType}> ${recordCollections.get(op.objectType)} = [
            SELECT ${fields.join(', ')}
            FROM ${op.objectType}
            ${conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''}
            ${op.sortOrder ? 'ORDER BY ' + op.sortOrder.join(', ') : ''}
        ];`;
        
        queries.push(query);

        if (idVariables.size > 0) {
          queries.push(`recordsById.putAll(new Map<Id, SObject>(${recordCollections.get(op.objectType)}));`);
        }
      });

    return queries.join('\n\n');
  }
}