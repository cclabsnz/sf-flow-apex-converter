import { FlowMetadata, FlowElements } from '../interfaces/SubflowTypes.js';
import { Logger } from '../Logger.js';

export class ElementAnalyzer {
  private countElements(elements: any): number {
    return Array.isArray(elements) ? elements.length : 1;
  }

  analyzeElements(metadata: FlowMetadata): FlowElements {
    const elements: FlowElements = { total: 0 };
    
    const elementTypes = [
      { key: 'recordLookups', name: 'Record Lookups' },
      { key: 'recordCreates', name: 'Record Creates' },
      { key: 'recordUpdates', name: 'Record Updates' },
      { key: 'recordDeletes', name: 'Record Deletes' },
      { key: 'decisions', name: 'Decisions' },
      { key: 'loops', name: 'Loops' },
      { key: 'assignments', name: 'Assignments' },
      { key: 'actionCalls', name: 'Apex Actions' },
      { key: 'subflows', name: 'Subflows' }
    ];

    for (const type of elementTypes) {
      if (metadata[type.key]) {
        const count = this.countElements(metadata[type.key]);
        elements[type.key] = count;
        elements.total += count;
        Logger.debug('ElementAnalyzer', `Found ${count} ${type.name}`);
      }
    }

    return elements;
  }
}