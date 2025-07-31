import { QueryOperation, DMLOperation } from '../types/BulkOperationTypes';

export class VariableGenerator {
  static generateVariableDeclarations(
    operations: Map<string, QueryOperation | DMLOperation>, 
    recordCollections: Map<string, string>,
    idVariables: Set<string>
  ): string {
    const declarations: string[] = [];
    
    Array.from(operations.values())
      .filter((op): op is QueryOperation => op.type === 'QUERY')
      .forEach(op => {
        const varName = `${op.objectType.toLowerCase()}List`;
        declarations.push(`List<${op.objectType}> ${varName} = new List<${op.objectType}>();`);
        recordCollections.set(op.objectType, varName);
      });

    if (idVariables.size > 0) {
      declarations.push('Map<Id, SObject> recordsById = new Map<Id, SObject>();');
    }

    return declarations.join('\n');
  }
}