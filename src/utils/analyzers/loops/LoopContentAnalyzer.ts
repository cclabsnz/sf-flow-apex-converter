import { FlowMetadata } from '../../../types';
import { Logger } from '../../Logger.js';

export interface LoopContent {
  dml: number;
  soql: number;
  subflows: number;
  other: number;
}

export class LoopContentAnalyzer {
  private countElements(elements: any): number {
    return Array.isArray(elements) ? elements.length : 1;
  }

  analyzeLoopContent(metadata: FlowMetadata, connectedElements: Set<string>): LoopContent {
    const content: LoopContent = {
      dml: 0,
      soql: 0,
      subflows: 0,
      other: 0
    };

    // Analyze elements connected to this loop
    connectedElements.forEach(elementRef => {
      // Check for DML operations
      if (metadata.recordCreates?.some(e => e.name?.[0] === elementRef)) {
        content.dml++;
      }
      if (metadata.recordUpdates?.some(e => e.name?.[0] === elementRef)) {
        content.dml++;
      }
      if (metadata.recordDeletes?.some(e => e.name?.[0] === elementRef)) {
        content.dml++;
      }

      // Check for SOQL operations
      if (metadata.recordLookups?.some(e => e.name?.[0] === elementRef)) {
        content.soql++;
      }

      // Check for subflows
      if (metadata.subflows?.some(e => e.name?.[0] === elementRef)) {
        content.subflows++;
      }

      // Count other elements
      if (metadata.assignments?.some(e => e.name?.[0] === elementRef)) {
        content.other++;
      }
      if (metadata.decisions?.some(e => e.name?.[0] === elementRef)) {
        content.other++;
      }
    });

    Logger.debug('LoopContentAnalyzer', 
      `Found in loop: ${content.dml} DML, ${content.soql} SOQL, ` +
      `${content.subflows} subflows, ${content.other} other operations`);

    return content;
  }
}