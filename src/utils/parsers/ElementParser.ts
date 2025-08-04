import { FlowElement, FlowElementType, ElementRef, FlowCondition } from '../../types';
import { XMLNode } from '../../types/xml';
import { Logger } from '../Logger.js';

export class ElementParser {
  private static typeToTags = {
    [FlowElementType.RECORD_CREATE]: ['recordcreates', 'recordCreates'],
    [FlowElementType.RECORD_UPDATE]: ['recordupdates', 'recordUpdates'],
    [FlowElementType.RECORD_DELETE]: ['recorddeletes', 'recordDeletes'],
    [FlowElementType.RECORD_LOOKUP]: ['recordlookups', 'recordLookups'],
    [FlowElementType.RECORD_ROLLBACK]: ['recordrollbacks', 'recordRollbacks'],
    [FlowElementType.ASSIGNMENT]: ['assignments'],
    [FlowElementType.DECISION]: ['decisions'],
    [FlowElementType.LOOP]: ['loops'],
    [FlowElementType.SUBFLOW]: ['subflows', 'actionCalls'],  // Include actionCalls as they can be subflows
    [FlowElementType.SCREEN]: ['screens']
  };

  private static getXMLValue<T>(value: unknown): T | undefined {
    if (Array.isArray(value) && value.length > 0) {
      return value[0] as T;
    }
    return undefined;
  }

  private static isXMLNode(value: unknown): value is XMLNode {
    return typeof value === 'object' && value !== null;
  }

  private static parseProperties(element: XMLNode): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    Object.keys(element).forEach(key => {
      if (key !== 'name' && key !== 'connector' && element[key]) {
        properties[key] = Array.isArray(element[key]) ? element[key][0] : element[key];
      }
    });
    return properties;
  }

  private static parseConnectors(element: XMLNode): ElementRef[] {
    if (!element.connector) return [];
    
    const connectors = Array.isArray(element.connector) 
      ? element.connector 
      : [element.connector];
    
    return connectors.map((conn: any) => ({
      targetReference: conn.targetReference?.[0] || '',
      conditionLogic: conn.conditionLogic?.[0],
      conditions: this.parseConditions(conn.conditions)
    }));
  }

  private static parseConditions(conditions: unknown): FlowCondition[] {
    if (!conditions) return [];
    
    if (!this.isXMLNode(conditions)) return [];
    
    const condArray = Array.isArray(conditions) ? conditions : [conditions];
    return condArray.map(cond => {
      if (!this.isXMLNode(cond)) {
        return {
          leftValueReference: '',
          operator: '',
          rightValue: undefined
        };
      }
      
      const rightValueNode = this.getXMLValue<XMLNode>(cond.rightValue);
      const rightValue = rightValueNode ? {
        stringValue: this.getXMLValue<string>(rightValueNode.stringValue),
        numberValue: this.getXMLValue<string>(rightValueNode.numberValue) ?
          parseFloat(this.getXMLValue<string>(rightValueNode.numberValue)!) : undefined,
        booleanValue: this.getXMLValue<string>(rightValueNode.booleanValue) === 'true'
      } : undefined;
      
      return {
        leftValueReference: this.getXMLValue<string>(cond.leftValueReference) || '',
        operator: this.getXMLValue<string>(cond.operator) || '',
        rightValue
      };
    });
  }

  static checkElementForLoopReferences(element: any, loopNames: Set<string>): boolean {
    // Check input assignments
    if (element.inputAssignments) {
      const inputs = Array.isArray(element.inputAssignments) ? element.inputAssignments : [element.inputAssignments];
      for (const input of inputs) {
        if (input.value?.elementReference?.[0] && 
            typeof input.value.elementReference[0] === 'string') {
          const ref = input.value.elementReference[0];
          const loopVar = ref.split('.')[0];
          if (loopNames.has(loopVar)) {
            Logger.debug('ElementParser', `Found loop reference in input assignment: ${ref}`);
            return true;
          }
        }
      }
    }

    // Check value references
    if (element.value?.elementReference?.[0] && 
        typeof element.value.elementReference[0] === 'string') {
      const ref = element.value.elementReference[0];
      const loopVar = ref.split('.')[0];
      if (loopNames.has(loopVar)) {
        Logger.debug('ElementParser', `Found loop reference in value: ${ref}`);
        return true;
      }
    }

    return false;
  }

  static buildLoopContext(metadata: any): Map<string, string> {
    const loopContext = new Map<string, string>();
    const loopNames = new Set<string>();

    // First collect all loop names
    if (metadata.loops) {
      const loops = Array.isArray(metadata.loops) ? metadata.loops : [metadata.loops];
      for (const loop of loops) {
        if (loop.name) {
          const loopName = Array.isArray(loop.name) ? loop.name[0] : loop.name;
          loopNames.add(loopName);
          Logger.debug('ElementParser', `Found loop: ${loopName}`);
        }
      }
    }
    const processConnector = (connector: any, loopName: string) => {
      if (connector.targetReference) {
        const target = Array.isArray(connector.targetReference) ? connector.targetReference[0] : connector.targetReference;
        loopContext.set(target, loopName);
        
        // Check for subflows in the target element
        // Check if target element exists in metadata
        let targetElement;
        const elementTypes = ['subflows', 'actionCalls', 'assignments', 'recordLookups', 'recordCreates', 'recordUpdates', 'recordDeletes'];
        for (const type of elementTypes) {
          if (metadata[type]) {
            const elements = Array.isArray(metadata[type]) ? metadata[type] : [metadata[type]];
            targetElement = elements.find((el: any) => {
              const elName = Array.isArray(el.name) ? el.name[0] : el.name;
              return elName === target;
            });
            if (targetElement) break;
          }
        }

        if (targetElement) {
          // Check for loop variable references in the target element
          if (this.checkElementForLoopReferences(targetElement, loopNames)) {
            Logger.debug('ElementParser', `Found loop reference in element: ${target}`);
            loopContext.set(target, loopName);
          }
        }

        if (target.toLowerCase().includes('subflow') || target.toLowerCase().includes('validation')) {
          Logger.debug('ElementParser', `Found subflow in loop: ${target}`);
        }
        
        // Recursively follow target elements to mark their targets as in the loop too
        if (metadata[target.toLowerCase()]) {
          const targetElement = Array.isArray(metadata[target.toLowerCase()]) 
            ? metadata[target.toLowerCase()][0] 
            : metadata[target.toLowerCase()];
          if (targetElement.connector) {
            const nextConnectors = Array.isArray(targetElement.connector) 
              ? targetElement.connector 
              : [targetElement.connector];
            nextConnectors.forEach((nextConn: any) => processConnector(nextConn, loopName));
          }
        }
      }
    };
    
    // Process all elements to find loop variable references
    const elementTypes = ['subflows', 'actionCalls', 'assignments', 'recordLookups', 'recordCreates', 'recordUpdates', 'recordDeletes'];
    elementTypes.forEach((type: string) => {
      if (metadata[type]) {
        const elements = Array.isArray(metadata[type]) ? metadata[type] : [metadata[type]];
        elements.forEach((element: any) => {
          const elementName = Array.isArray(element.name) ? element.name[0] : element.name;
          if (elementName && this.checkElementForLoopReferences(element, loopNames)) {
            Logger.debug('ElementParser', `Found loop reference in ${type} element: ${elementName}`);
            loopContext.set(elementName, Array.from(loopNames)[0]); // Use first loop for now
          }
        });
      }
    });

    // Then process loop connectors
    if (metadata.loops) {
      const loops = Array.isArray(metadata.loops) ? metadata.loops : [metadata.loops];
      for (const loop of loops) {
        if (loop.name && loop.connector) {
          const loopName = Array.isArray(loop.name) ? loop.name[0] : loop.name;
          const connectors = Array.isArray(loop.connector) ? loop.connector : [loop.connector];
          connectors.forEach((connector: any) => processConnector(connector, loopName));
        }
      }
    }

    return loopContext;
  }

  static isElementInLoop(elementName: string, loopContext: Map<string, string>, visitedElements: Set<string> = new Set()): string | undefined {
    if (visitedElements.has(elementName)) return undefined;
    visitedElements.add(elementName);
    return loopContext.get(elementName);
  }

  static parseElement(
    elementMetadata: any, 
    elementType: FlowElementType, 
    loopContext: Map<string, string>
  ): FlowElement {
    const elementName = elementMetadata.name?.[0] || 'Unnamed';
    const elementLoopContext = this.isElementInLoop(elementName, loopContext);
    
    return {
      id: Array.isArray(elementMetadata.name) ? elementMetadata.name[0] : 'unknown',
      type: elementType,
      name: elementName,
      properties: this.parseProperties(elementMetadata),
      connectors: this.parseConnectors(elementMetadata),
      isInLoop: !!elementLoopContext,
      loopContext: elementLoopContext
    };
  }

  static getTagsForType(elementType: FlowElementType): string[] {
    return (this.typeToTags as any)[elementType] || [elementType.toLowerCase()];
  }
}