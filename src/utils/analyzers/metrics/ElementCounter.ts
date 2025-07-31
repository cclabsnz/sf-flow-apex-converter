import { FlowMetadata, FlowElement } from '../../../types';
import { FlowElementType } from '../../../types/elements';
import { Logger } from '../../Logger.js';

export class ElementCounter {
  static countElements(elements: unknown[] | unknown): number {
    return Array.isArray(elements) ? elements.length : 1;
  }

  static countFlowElements(metadata: FlowMetadata): Map<string, FlowElement> {
    const elementMap = new Map<string, FlowElement>();
    
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
      const elements = metadata[type.key];
      if (elements) {
        const elementArray = Array.isArray(elements) ? elements : [elements];
        elementArray.forEach((element: { name?: string[] }, index: number) => {
          const elementName = element.name?.[0] || `${type.key}_${index}`;
          elementMap.set(elementName, {
            type: type.key === 'recordCreates' ? FlowElementType.RECORD_CREATE :
                 type.key === 'recordUpdates' ? FlowElementType.RECORD_UPDATE :
                 type.key === 'recordDeletes' ? FlowElementType.RECORD_DELETE :
                 type.key === 'recordLookups' ? FlowElementType.RECORD_LOOKUP :
                 type.key === 'recordRollbacks' ? FlowElementType.RECORD_ROLLBACK :
                 type.key === 'assignments' ? FlowElementType.ASSIGNMENT :
                 type.key === 'decisions' ? FlowElementType.DECISION :
                 type.key === 'loops' ? FlowElementType.LOOP :
                 type.key === 'subflows' ? FlowElementType.SUBFLOW :
                 FlowElementType.SCREEN,
            name: elementName,
            properties: {},
            connectors: []
          });
        });
        Logger.debug('ElementCounter', `Found ${elementArray.length} ${type.name}`);
      }
    }

    return elementMap;
  }
}