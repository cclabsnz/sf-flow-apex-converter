import { FlowMetadata } from '../interfaces/SubflowTypes.js';
import { FlowElementsImpl } from './FlowElementsImpl.js';
import { Logger } from '../Logger.js';

export class ElementAnalyzer {
  private countElements(elements: any): number {
    return Array.isArray(elements) ? elements.length : 1;
  }

  analyzeElements(metadata: FlowMetadata): FlowElementsImpl {
    const elements = new FlowElementsImpl();
    
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
        elements.set(type.key, count);
        elements.set('total', (elements.total || 0) + count);
        Logger.debug('ElementAnalyzer', `Found ${count} ${type.name}`);
      }
    }

    return elements;
  }
}