import { FlowBaseType, FlowMetadata, LoopContext } from '../../../types';
import { Logger } from '../../Logger.js';

export class LoopContextPropagator {
  private loopContexts = new Map<string, LoopContext>();
  private elementConnections = new Map<string, Set<string>>();
  private elementTypes = new Map<string, string>();
  private metadata: FlowMetadata | null = null;
  private processedElements = new Set<string>();

  propagateLoopContexts(flowMetadata: FlowMetadata): Map<string, LoopContext> {
    this.metadata = flowMetadata;
    this.buildElementConnections(this.metadata);
    this.initializeLoopContexts(this.metadata);
    this.propagateContexts();
    return this.loopContexts;
  }

  private buildElementConnections(metadata: FlowMetadata): void {
    this.processElementType(metadata.loops, 'loops');
    this.processElementType(metadata.decisions, 'decisions');
    this.processElementType(metadata.assignments, 'assignments');
    this.processElementType(metadata.recordCreates, 'recordCreates');
    this.processElementType(metadata.recordUpdates, 'recordUpdates');
    this.processElementType(metadata.recordDeletes, 'recordDeletes');
    this.processElementType(metadata.recordLookups, 'recordLookups');
    this.processElementType(metadata.subflows, 'subflows');
  }

  private isElementInLoop(elementName: string, flowName?: string): boolean {
    // Check direct loop context
    const context = this.loopContexts.get(elementName);
    if (context?.isInLoop) return true;

    // Check if element name is referenced in any variable expressions
    // This helps detect elements that are implicitly in a loop context
    return !!elementName.match(/.*Loop_over_.*/) || !!elementName.match(/Loop\[.*\]/i);
  }

  private processElementType(elements: FlowBaseType[] | undefined, type: string): void {
    if (!elements) return;

    for (const element of elements) {
      const elementName = element.name?.[0];
      if (!elementName) continue;

      // Get all connector targets for this element
      const connectors = Array.isArray(element.connector) ? element.connector : [element.connector];
      const targets = new Set<string>();

      for (const connector of connectors) {
        if (connector?.targetReference?.[0]) {
          targets.add(connector.targetReference[0]);
        }
      }

      this.elementConnections.set(elementName, targets);
      this.elementTypes.set(elementName, type);
      Logger.debug('LoopContextPropagator', `Element ${elementName} connects to: ${Array.from(targets).join(', ')}`);
    }
  }

  private initializeLoopContexts(metadata: FlowMetadata): void {
    if (!metadata.loops) return;

    const loops = Array.isArray(metadata.loops) ? metadata.loops : [metadata.loops];
    
    for (const loop of loops) {
      const loopName = loop.name?.[0];
      if (!loopName) continue;

      const connectors = Array.isArray(loop.connector) ? loop.connector : [loop.connector];
      for (const connector of connectors) {
        if (connector?.targetReference?.[0]) {
          const targetRef = connector.targetReference[0];
          // Only set loop context if not already set (preserves first loop)
          if (!this.loopContexts.has(targetRef)) {
            this.loopContexts.set(targetRef, {
            isInLoop: true,
            loopReferenceName: loopName,
            depth: 1
          });
          Logger.debug('LoopContextPropagator', `Initial loop context: ${targetRef} in loop ${loopName}`);
          }
        }
      }
    }
  }

  private propagateContexts(): void {
    let changed = true;
    while (changed) {
      changed = false;
      
      for (const [element, targets] of this.elementConnections.entries()) {
        const elementContext = this.loopContexts.get(element);
        
        if (elementContext?.isInLoop) {
          for (const target of targets) {
            const existingContext = this.loopContexts.get(target);
            
            // Only set loop context if element isn't already in a loop
            // This preserves the first loop that claims an element
            if (!existingContext) {
              const parentContext = elementContext;
              this.loopContexts.set(target, {
                isInLoop: true,
                loopReferenceName: parentContext.loopReferenceName,
                depth: parentContext.depth
              });

              // Check if this is a subflow with inputs referencing loop variables
              const elementType = this.elementTypes.get(target);
const elementNameMatch = target.match(/(.*?)(?:\..*)?$/);
const baseElementName = elementNameMatch ? elementNameMatch[1] : target;

if (elementType === 'subflows' && this.metadata) {
                Logger.debug('LoopContextPropagator', `Processing subflow: ${baseElementName}`);
                const subflows = this.metadata.subflows || [];
const elementData = subflows.find((el: FlowBaseType) => {
                  const elName = el.name?.[0];
                  return elName && (elName === target || elName === baseElementName);
                });
                if (elementData?.inputAssignments) {
                  const inputs = Array.isArray(elementData.inputAssignments) ? elementData.inputAssignments : [elementData.inputAssignments];
for (const input of inputs as any[]) {
                    const value = Array.isArray(input.value) ? input.value[0] : input.value;
                    const elementRef = value?.elementReference?.[0];
                    if (elementRef?.startsWith('Loop_over_')) {
                      Logger.debug('LoopContextPropagator', `Subflow ${target} has loop variable in input: ${elementRef}`);
                      this.loopContexts.set(target, {
                        isInLoop: true,
                        loopReferenceName: elementRef.split('.')[0],
                        depth: parentContext.depth + 1
                      });
                      break;
                    }
                  }
                }
              }

              changed = true;
              Logger.debug('LoopContextPropagator', `Propagated loop context to ${target} from ${element}`);
            }
          }
        }
      }
    }
  }
}
