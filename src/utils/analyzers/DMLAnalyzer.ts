import { FlowMetadata } from '../interfaces/SubflowTypes.js';
import { Logger } from '../Logger.js';

export interface DMLStats {
  operations: number;
  sources: Set<string>;
}

export class DMLAnalyzer {
  private countElements(elements: any): number {
    return Array.isArray(elements) ? elements.length : 1;
  }

  analyzeDMLOperations(metadata: FlowMetadata): DMLStats {
    let operations = 0;
    const sources = new Set<string>();

    // Count DML operations
    if (metadata.recordCreates) {
      operations += this.countElements(metadata.recordCreates);
      sources.add('Record Creates');
    }
    if (metadata.recordUpdates) {
      operations += this.countElements(metadata.recordUpdates);
      sources.add('Record Updates');
    }
    if (metadata.recordDeletes) {
      operations += this.countElements(metadata.recordDeletes);
      sources.add('Record Deletes');
    }

    Logger.debug('DMLAnalyzer', `Found ${operations} DML operations from ${Array.from(sources).join(', ')}`);
    
    return { operations, sources };
  }
}