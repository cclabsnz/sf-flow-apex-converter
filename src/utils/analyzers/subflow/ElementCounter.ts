import { FlowElements, FlowMetadata } from '../../../types/elements';
import { FlowElementsImpl } from '../FlowElementsImpl.js';
import { Logger } from '../../Logger.js';

export class ElementCounter {
  static countElements(elements: any): number {
    return Array.isArray(elements) ? elements.length : 1;
  }

  static countFlowElements(metadata: FlowMetadata): FlowElements {
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
        Logger.debug('ElementCounter', `Found ${count} ${type.name}`);
      }
    }

    return elements;
  }
}