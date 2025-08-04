import { FlowElement, FlowElementType, ElementRef, FlowCondition } from '../../types';
import { XMLNode } from '../../types/xml';
import { Logger } from '../Logger.js';
import { LoopContext } from '../interfaces/loops/LoopAnalysis.js';
import { LoopContextPropagator } from '../analyzers/loops/LoopContextPropagator.js';

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

  static buildLoopContext(metadata: any): Map<string, LoopContext> {
    const propagator = new LoopContextPropagator();
    return propagator.propagateLoopContexts(metadata);
  }

  static isElementInLoop(elementName: string, loopContext: Map<string, LoopContext>, visitedElements: Set<string> = new Set()): string | undefined {
    if (visitedElements.has(elementName)) return undefined;
    visitedElements.add(elementName);
    const context = loopContext.get(elementName);
    return context?.loopReferenceName;
  }

  static parseElement(
    elementMetadata: any, 
    elementType: FlowElementType, 
    loopContext: Map<string, LoopContext>
  ): FlowElement {
    const elementName = elementMetadata.name?.[0] || 'Unnamed';
    const context = loopContext.get(elementName);
    
    return {
      id: Array.isArray(elementMetadata.name) ? elementMetadata.name[0] : 'unknown',
      type: elementType,
      name: elementName,
      properties: this.parseProperties(elementMetadata),
      connectors: this.parseConnectors(elementMetadata),
      isInLoop: !!context?.isInLoop,
      loopContext: context?.loopReferenceName
    };
  }

  static getTagsForType(elementType: FlowElementType): string[] {
    return (this.typeToTags as any)[elementType] || [elementType.toLowerCase()];
  }
}