import { FlowMetadata, FlowBaseType } from '../../../types';

export class OperationCounter {
  static countOperations(metadata: FlowMetadata): {
    dmlOperations: number;
    soqlQueries: number;
    soqlSources: Set<string>;
    dmlSources: Set<string>;
  } {
    let dmlOperations = 0;
    let soqlQueries = 0;
    const soqlSources = new Set<string>();
    const dmlSources = new Set<string>();

    // Count DML operations
    if (metadata.recordCreates) {
      const creates = Array.isArray(metadata.recordCreates) ? metadata.recordCreates : [metadata.recordCreates];
      dmlOperations += creates.length;
      dmlSources.add('Record Creates');
    }
    if (metadata.recordUpdates) {
      const updates = Array.isArray(metadata.recordUpdates) ? metadata.recordUpdates : [metadata.recordUpdates];
      dmlOperations += updates.length;
      dmlSources.add('Record Updates');
    }
    if (metadata.recordDeletes) {
      const deletes = Array.isArray(metadata.recordDeletes) ? metadata.recordDeletes : [metadata.recordDeletes];
      dmlOperations += deletes.length;
      dmlSources.add('Record Deletes');
    }

    // Record Lookups (Get Records)
    if (metadata.recordLookups) {
      const lookups = Array.isArray(metadata.recordLookups) ? metadata.recordLookups : [metadata.recordLookups];
      soqlQueries += lookups.length;
      soqlSources.add('Record Lookups');
    }

    // Dynamic Choice Sets
    if (metadata.dynamicChoiceSets) {
      const choiceSets = Array.isArray(metadata.dynamicChoiceSets) ? metadata.dynamicChoiceSets : [metadata.dynamicChoiceSets];
      soqlQueries += choiceSets.length;
      soqlSources.add('Dynamic Choice Sets');
    }

    // Record-Triggered Flow
    if (Array.isArray(metadata.trigger?.[0]?.type) && metadata.trigger[0].type[0] === 'RecordAfterSave') {
      soqlQueries++; // Count implicit query for the triggering record
      soqlSources.add('Record-Triggered Flow');
    }

    // Formula Elements with Cross-Object References
    if (metadata.formulas) {
      const formulas = Array.isArray(metadata.formulas) ? metadata.formulas : [metadata.formulas];
      for (const formula of formulas) {
        if (typeof formula.expression?.[0] === 'string' && formula.expression[0].includes('.')) {
          soqlQueries++; // Count cross-object reference queries
          soqlSources.add('Cross-Object Formula References');
        }
      }
    }

    return {
      dmlOperations,
      soqlQueries,
      soqlSources,
      dmlSources
    };
  }
}