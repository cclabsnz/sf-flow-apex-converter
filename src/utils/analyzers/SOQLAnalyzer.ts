import { FlowMetadata } from '../interfaces/SubflowTypes.js';
import { Logger } from '../Logger.js';

export interface SOQLStats {
  queries: number;
  sources: Set<string>;
}

export class SOQLAnalyzer {
  private countElements(elements: any): number {
    return Array.isArray(elements) ? elements.length : 1;
  }

  analyzeSOQLQueries(metadata: FlowMetadata): SOQLStats {
    let queries = 0;
    const sources = new Set<string>();

    // Record Lookups (Get Records)
    if (metadata.recordLookups) {
      const lookups = Array.isArray(metadata.recordLookups) ? metadata.recordLookups : [metadata.recordLookups];
      queries += lookups.length;
      sources.add('Record Lookups');
    }

    // Dynamic Choice Sets
    if (metadata.dynamicChoiceSets) {
      const choiceSets = Array.isArray(metadata.dynamicChoiceSets) ? metadata.dynamicChoiceSets : [metadata.dynamicChoiceSets];
      queries += choiceSets.length;
      sources.add('Dynamic Choice Sets');
    }

    // Record-Triggered Flow
    if (metadata.trigger && metadata.trigger[0]?.type?.[0] === 'RecordAfterSave') {
      queries++; // Count implicit query for the triggering record
      sources.add('Record-Triggered Flow');
    }

    // Formula Elements with Cross-Object References
    if (metadata.formulas) {
      const formulas = Array.isArray(metadata.formulas) ? metadata.formulas : [metadata.formulas];
      for (const formula of formulas) {
        if (formula.expression?.[0]?.includes('.')) {
          queries++; // Count cross-object reference queries
          sources.add('Cross-Object Formula References');
        }
      }
    }

    Logger.debug('SOQLAnalyzer', `Found ${queries} SOQL queries from ${Array.from(sources).join(', ')}`);
    
    return { queries, sources };
  }
}