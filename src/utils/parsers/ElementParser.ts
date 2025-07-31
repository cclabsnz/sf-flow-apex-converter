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
    [FlowElementType.SUBFLOW]: ['subflows'],
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

  static buildLoopContext(metadata: any): Map<string, string> {
    const loopContext = new Map<string, string>();
    
    if (metadata.loops) {
      const loops = Array.isArray(metadata.loops) ? metadata.loops : [metadata.loops];
      for (const loop of loops) {
        if (loop.name && loop.connector) {
          const connectors = Array.isArray(loop.connector) ? loop.connector : [loop.connector];
          for (const connector of connectors) {
            if (connector.targetreference) {
              const target = connector.targetreference[0];
              loopContext.set(target, loop.name[0]);
            }
          }
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
    element: any, 
    elementType: FlowElementType, 
    loopContext: Map<string, string>
  ): FlowElement {
    const elementName = element.name?.[0] || 'Unnamed';
    const elementLoopContext = this.isElementInLoop(elementName, loopContext);
    
    return {
      type: elementType,
      name: elementName,
      properties: this.parseProperties(element),
      connectors: this.parseConnectors(element),
      isInLoop: !!elementLoopContext,
      loopContext: elementLoopContext
    };
  }

  static getTagsForType(elementType: FlowElementType): string[] {
    return this.typeToTags[elementType] || [elementType.toLowerCase()];
  }
}