import { FlowMetadata } from '../../../types/elements';
import { FlowElementsImpl } from '../../analyzers/FlowElementsImpl';
import { Logger } from '../../Logger';

export class ElementCounter {
  static countElements(elements: unknown[] | unknown): number {
    return Array.isArray(elements) ? elements.length : 1;
  }

  static countDMLOperations(metadata: FlowMetadata): number {
    let count = 0;
    if (metadata.recordCreates) count += this.countElements(metadata.recordCreates);
    if (metadata.recordUpdates) count += this.countElements(metadata.recordUpdates);
    if (metadata.recordDeletes) count += this.countElements(metadata.recordDeletes);
    return count;
  }

  static countSOQLQueries(metadata: FlowMetadata): number {
    let count = 0;
    if (metadata.recordLookups) count += this.countElements(metadata.recordLookups);
    if (metadata.dynamicChoiceSets) count += this.countElements(metadata.dynamicChoiceSets);
    if (Array.isArray(metadata.trigger?.[0]?.type) && metadata.trigger[0].type[0] === 'RecordAfterSave') count++;
    return count;
  }

  static countFlowElements(metadata: FlowMetadata): FlowElementsImpl {
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