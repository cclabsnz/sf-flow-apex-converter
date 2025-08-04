import { FlowBaseType, FlowMetadata } from '../../../types/elements';
import { LoopContext } from '../../interfaces/loops/LoopAnalysis.js';
import { FlowElementType } from '../../interfaces/FlowTypes.js';
import { Logger } from '../../Logger.js';

export class LoopContextPropagator {
  private loopContexts = new Map<string, LoopContext>();
  private elementConnections = new Map<string, Set<string>>();
  private elementTypes = new Map<string, FlowElementType>();
  private metadata: FlowMetadata | null = null;
  private processedElements = new Set<string>();

  propagateLoopContexts(flowMetadata: FlowMetadata): Map<string, LoopContext> {
    this.metadata = flowMetadata;
    this.buildElementConnections(this.metadata);
    this.initializeLoopContexts(this.metadata);
    this.propagateContextsInternal();
    this.analyzeVariableReferences();
    return this.loopContexts;
  }

  private analyzeVariableReferences(): void {
    if (!this.metadata) return;
    const loopNames = new Set<string>();
    
    if (this.metadata.loops) {
      const loops = Array.isArray(this.metadata.loops) ? this.metadata.loops : [this.metadata.loops];
      for (const loop of loops) {
        const loopName = loop.name?.[0];
        if (loopName) loopNames.add(loopName);
      }
    }

    const findLoopRefInString = (str: string): string | undefined => {
      if (!str) return undefined;
      
      for (const loopName of loopNames) {
        if (str.includes(loopName)) {
          try {
            const pattern = new RegExp(`${loopName}(?:\\.[\\w]+)?`);
            const match = str.match(pattern);
            return match ? loopName : undefined;
          } catch (error) {
            Logger.debug('LoopContextPropagator', `Error creating RegExp for ${loopName}: ${error}`);
            return undefined;
          }
        }
      }
      return undefined;
    };

    const analyzeElement = (element: any) => {
      if (!element) return;

      const allAssignments: { elementReference: string }[] = [];
      
      const processInputAssignments = (inputs: any) => {
        if (!inputs) return;
        
        if (inputs.name && Array.isArray(inputs.name) && inputs.value && Array.isArray(inputs.value)) {
          for (let i = 0; i < inputs.value.length; i++) {
            const value = inputs.value[i];
            if (value.elementreference && Array.isArray(value.elementreference)) {
              value.elementreference.forEach((ref: string) => {
                allAssignments.push({ elementReference: ref });
              });
            }
          }
        }
      };
      
      processInputAssignments(element.inputAssignments);
      processInputAssignments(element.inputassignments);

      if (allAssignments.length === 0) return;

      for (const assignment of allAssignments) {
        if (assignment.elementReference) {
          for (const loopName of loopNames) {
            if (assignment.elementReference.startsWith(loopName)) {
              const elementName = element.name?.[0];
              if (elementName) {
                const context = this.loopContexts.get(elementName) || {
                  isInLoop: true,
                  loopReferenceName: loopName,
                  depth: 1,
                  path: [elementName],
                  pathTypes: [this.elementTypes.get(elementName) || FlowElementType.ASSIGNMENT]
                };
                this.loopContexts.set(elementName, context);
              }
              break;
            }
          }
        }
      }

      if (element.value?.elementReference?.[0]) {
        const elementName = element.name?.[0];
        const elementRef = element.value.elementReference[0];
        const loopRef = findLoopRefInString(elementRef);
        if (loopRef && elementName && loopNames.has(loopRef)) {
          const context = this.loopContexts.get(elementName) || {
            isInLoop: true,
            loopReferenceName: loopRef,
            depth: 1,
            path: [elementName],
            pathTypes: [this.elementTypes.get(elementName) || FlowElementType.ASSIGNMENT]
          };
          this.loopContexts.set(elementName, context);
        }
      }
    };

    const checkElements = (elements: any[] | undefined, elementType?: string) => {
      if (!elements) return;
      const elementArray = Array.isArray(elements) ? elements : [elements];
      for (const element of elementArray) {
        analyzeElement(element);
      }
    };

    if (this.metadata.subflows) {
      Logger.debug('LoopContextPropagator', 'Checking subflows for loop variable references');
      checkElements(this.metadata.subflows, 'subflow');
    }
    if (this.metadata.actionCalls) {
      Logger.debug('LoopContextPropagator', 'Checking actionCalls for loop variable references');
      checkElements(this.metadata.actionCalls, 'actionCall');
    }
    if (this.metadata.assignments) checkElements(this.metadata.assignments);
    if (this.metadata.recordLookups) checkElements(this.metadata.recordLookups);
    if (this.metadata.recordCreates) checkElements(this.metadata.recordCreates);
    if (this.metadata.recordUpdates) checkElements(this.metadata.recordUpdates);
    if (this.metadata.recordDeletes) checkElements(this.metadata.recordDeletes);

    if (this.metadata.subflows) {
      const processedSubflows = Array.isArray(this.metadata.subflows) ? this.metadata.subflows : [this.metadata.subflows];
      for (const subflow of processedSubflows) {
        if (subflow.inputAssignments) {
          const inputs = Array.isArray(subflow.inputAssignments) ? subflow.inputAssignments : [subflow.inputAssignments];
          for (const input of inputs as Array<{ value?: { elementReference?: string[] } }>) {
            const loopRef = findLoopRefInString(input.value?.elementReference?.[0] || '');
            if (loopRef) {
              const subflowName = subflow.name?.[0];
              if (subflowName && loopNames.has(loopRef)) {
                const context = this.loopContexts.get(subflowName) || {
                  isInLoop: true,
                  loopReferenceName: loopRef,
                  depth: 1,
                  path: [subflowName],
                  pathTypes: [FlowElementType.SUBFLOW]
                };
                this.loopContexts.set(subflowName, context);
              }
            }
          }
        }
      }
    }
  }

  private buildElementConnections(metadata: FlowMetadata): void {
    if (metadata.loops) this.processElementType(metadata.loops, FlowElementType.LOOP);
    if (metadata.decisions) this.processElementType(metadata.decisions, FlowElementType.DECISION);
    if (metadata.assignments) this.processElementType(metadata.assignments, FlowElementType.ASSIGNMENT);
    if (metadata.recordCreates) this.processElementType(metadata.recordCreates, FlowElementType.RECORD_CREATE);
    if (metadata.recordUpdates) this.processElementType(metadata.recordUpdates, FlowElementType.RECORD_UPDATE);
    if (metadata.recordDeletes) this.processElementType(metadata.recordDeletes, FlowElementType.RECORD_DELETE);
    if (metadata.recordLookups) this.processElementType(metadata.recordLookups, FlowElementType.RECORD_LOOKUP);
    if (metadata.subflows) this.processElementType(metadata.subflows, FlowElementType.SUBFLOW);
    if (metadata.actionCalls) this.processElementType(metadata.actionCalls, FlowElementType.ACTION_CALL);
  }

  private isElementInLoop(elementName: string, flowName?: string): boolean {
    const context = this.loopContexts.get(elementName);
    if (context?.isInLoop) return true;
    return !!elementName.match(/.*Loop_over_.*/) || !!elementName.match(/Loop\[.*\]/i);
  }

  private findInputValuesForElement(elementName: string): string[] {
    const values: string[] = [];
    if (!this.metadata) return values;

    const checkElements = (elements: any[] | undefined) => {
      if (!elements) return;
      const elementArray = Array.isArray(elements) ? elements : [elements];
      for (const element of elementArray) {
        if (element.name?.[0] === elementName) {
          const inputAssignmentsList = element.inputAssignments || element.inputassignments;
          if (inputAssignmentsList) {
            const inputs = Array.isArray(inputAssignmentsList) 
              ? inputAssignmentsList 
              : [inputAssignmentsList];
            for (const input of inputs) {
              let elementRef: string | undefined;
              if (input.value?.elementReference?.[0]) {
                elementRef = input.value.elementReference[0];
              } else if (Array.isArray(input.value) && input.value[0]?.elementReference?.[0]) {
                elementRef = input.value[0].elementReference[0];
              }
              
              if (elementRef) {
                values.push(elementRef);
              }
            }
          }

          if (element.value?.elementReference?.[0]) {
            values.push(element.value.elementReference[0]);
          }
        }
      }
    };

    checkElements(this.metadata.subflows);
    checkElements(this.metadata.actionCalls);
    checkElements(this.metadata.assignments);
    checkElements(this.metadata.recordLookups);
    checkElements(this.metadata.recordCreates);
    checkElements(this.metadata.recordUpdates);
    checkElements(this.metadata.recordDeletes);

    return values;
  }

  private processElementType(elements: FlowBaseType[] | FlowBaseType | undefined, type: FlowElementType): void {
    if (!elements) return;
    const elementArray = Array.isArray(elements) ? elements : [elements];

    for (const element of elementArray) {
      const elementName = element.name?.[0];
      if (!elementName) continue;

      const connectors = Array.isArray(element.connector) ? element.connector : [element.connector];
      const targets = new Set<string>();

      for (const connector of connectors) {
        if (connector?.targetReference?.[0]) {
          targets.add(connector.targetReference[0]);
        }
      }

      this.elementConnections.set(elementName, targets);
      this.elementTypes.set(elementName, type);
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
          if (!this.loopContexts.has(targetRef)) {
            this.loopContexts.set(targetRef, {
              isInLoop: true,
              loopReferenceName: loopName,
              depth: 1,
              path: [targetRef],
              pathTypes: [this.elementTypes.get(targetRef) || FlowElementType.ASSIGNMENT]
            });
          }
        }
      }
    }
  }

  private propagateContextsInternal(): void {
    const findLoopRefInString = (str: string): string | undefined => {
      if (!str) return undefined;
      
      const loopNames = new Set<string>();
      if (this.metadata?.loops) {
        const loops = Array.isArray(this.metadata.loops) ? this.metadata.loops : [this.metadata.loops];
        for (const loop of loops) {
          const loopName = loop.name?.[0];
          if (loopName) loopNames.add(loopName);
        }
      }
      
      for (const loopName of loopNames) {
        if (str.includes(loopName)) {
          try {
            const pattern = new RegExp(`${loopName}(?:\\.[\\w]+)?`);
            const match = str.match(pattern);
            return match ? loopName : undefined;
          } catch (error) {
            Logger.debug('LoopContextPropagator', `Error creating RegExp for ${loopName}: ${error}`);
            return undefined;
          }
        }
      }
      return undefined;
    };

    let changed = true;
    while (changed) {
      changed = false;
      
      for (const [element, targets] of this.elementConnections.entries()) {
        const elementContext = this.loopContexts.get(element);
        
        if (elementContext?.isInLoop) {
          for (const target of targets) {
            const existingContext = this.loopContexts.get(target);
            const parentContext = elementContext;
            const currentContext = existingContext || {
              isInLoop: false,
              loopReferenceName: '',
              depth: 0,
              path: [],
              pathTypes: []
            };

            if (!currentContext.isInLoop || 
                currentContext.loopReferenceName !== parentContext.loopReferenceName || 
                currentContext.depth !== parentContext.depth) {
              
              const newPath = [...(parentContext.path || []), target];
              const elementType = this.elementTypes.get(target);
              const newPathTypes = [...(parentContext.pathTypes || []), elementType || FlowElementType.ASSIGNMENT];
              
              this.loopContexts.set(target, {
                isInLoop: true,
                loopReferenceName: parentContext.loopReferenceName,
                depth: parentContext.depth,
                path: newPath,
                pathTypes: newPathTypes
              });
              changed = true;
            }

            const elementName = target;
            const inputValues = this.findInputValuesForElement(elementName);
            
            for (const value of inputValues) {
              const loopRef = findLoopRefInString(value);
              if (loopRef) {
                const newPath = [...(parentContext.path || []), target];
                const elementType = this.elementTypes.get(target);
                const newPathTypes = [...(parentContext.pathTypes || []), elementType || FlowElementType.ASSIGNMENT];
                
                this.loopContexts.set(elementName, {
                  isInLoop: true,
                  loopReferenceName: loopRef,
                  depth: parentContext.depth + 1,
                  path: newPath,
                  pathTypes: newPathTypes
                });
                break;
              }
            }

            const elementType = this.elementTypes.get(target);
            const elementNameMatch = target.match(/(.*?)(?:\..*)?$/);
            const baseElementName = elementNameMatch ? elementNameMatch[1] : target;

            if ((elementType === FlowElementType.SUBFLOW || elementType === FlowElementType.ACTION_CALL || baseElementName.toLowerCase().includes('validation') || baseElementName.toLowerCase().includes('action')) && this.metadata) {
              const subflows = Array.isArray(this.metadata.subflows) ? this.metadata.subflows : (this.metadata.subflows ? [this.metadata.subflows] : []);
              const actionCalls = Array.isArray(this.metadata.actionCalls) ? this.metadata.actionCalls : (this.metadata.actionCalls ? [this.metadata.actionCalls] : []);
              const allElements = [...subflows, ...actionCalls];
              const elementData = allElements.find((el: FlowBaseType) => {
                const elName = el.name?.[0];
                return elName && (elName === target || elName === baseElementName);
              });

              if (elementData?.inputAssignments) {
                const jsonStr = JSON.stringify(elementData);
                const loopRef = findLoopRefInString(jsonStr);
                if (loopRef) {
                  const newPath = [...(parentContext.path || []), target];
                  const elementType = this.elementTypes.get(target);
                  const newPathTypes = [...(parentContext.pathTypes || []), elementType || FlowElementType.ASSIGNMENT];
                  
                  this.loopContexts.set(target, {
                    isInLoop: true,
                    loopReferenceName: loopRef,
                    depth: parentContext.depth + 1,
                    path: newPath,
                    pathTypes: newPathTypes
                  });
                  break;
                }
              }
            }
          }
        }
      }
    }
  }
}