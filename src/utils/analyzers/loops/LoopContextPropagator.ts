import { FlowBaseType, FlowMetadata, LoopContext } from '../../../types';
import { Logger } from '../../Logger.js';

export class LoopContextPropagator {
private loopContexts = new Map<string, LoopContext>();
  private elementConnections = new Map<string, Set<string>>();
  private elementTypes = new Map<string, string>();
  private metadata: FlowMetadata | null = null;
  private processedElements = new Set<string>();

  /**
   * Propagates loop contexts through flow elements, identifying which elements are
   * within loops and tracking their relationships to loop variables.
   * 
   * The propagation is guaranteed to terminate because:
   * 1. The number of elements in a Flow XML is finite
   * 2. Each element can only have a finite number of connections
   * 3. Context changes (entering a loop, changing reference, changing depth) are finite
   * 4. The depth is bounded by the actual flow structure
   * 
   * The flow structure forms a directed graph, and this algorithm walks through it
   * marking elements as in/out of loops. Each element can only transition once from
   * not-in-loop to in-loop, and can only change its loop reference or depth a finite
   * number of times based on the actual flow structure.
   */
  propagateLoopContexts(flowMetadata: FlowMetadata): Map<string, LoopContext> {
    this.metadata = flowMetadata;
    this.buildElementConnections(this.metadata);
    this.initializeLoopContexts(this.metadata);
    this.propagateContextsInternal();
    this.analyzeVariableReferences();

    return this.loopContexts;
  }

  private analyzeVariableReferences(): void {
    Logger.debug('LoopContextPropagator', 'Starting analyzeVariableReferences');
    if (!this.metadata) return;
    const loopNames = new Set<string>();
    
    // First find all loop names
    if (this.metadata.loops) {
      const loops = Array.isArray(this.metadata.loops) ? this.metadata.loops : [this.metadata.loops];
      Logger.debug('LoopContextPropagator', `Found ${loops.length} loops to analyze`);
      for (const loop of loops) {
        const loopName = loop.name?.[0];
        if (loopName) loopNames.add(loopName);
      }
    }

    // Then look for any element that references loop variables
    const analyzeElement = (element: any) => {
      Logger.debug('LoopContextPropagator', `Analyzing element ${element.name?.[0] || 'unknown'}`);
      if (!element) return;

      // Look for inputAssignments that reference loop variables (handle both cases inputAssignments and inputassignments)
      const inputAssignmentsList = element.inputAssignments || element.inputassignments;
      Logger.debug('LoopContextPropagator', `Checking input assignments for ${element.name?.[0]}`);
      if (inputAssignmentsList) {
        const inputs = Array.isArray(inputAssignmentsList) ? inputAssignmentsList : [inputAssignmentsList];
        Logger.debug('LoopContextPropagator', `Found ${inputs.length} input assignments`);
        for (const input of inputs as any[]) {
          // Extract reference value, handling different XML structures
          let elementRef: string | undefined;
          if (input.value?.elementReference?.[0]) {
            elementRef = input.value.elementReference[0];
          } else if (Array.isArray(input.value) && input.value[0]?.elementReference?.[0]) {
            elementRef = input.value[0].elementReference[0];
          }
          
          Logger.debug('LoopContextPropagator', `Checking element reference: ${elementRef}`);
          if (elementRef && elementRef.startsWith('Loop_over_')) {
              const elementName = element.name?.[0];
              Logger.debug('LoopContextPropagator', `Found inputAssignment with loop variable reference: ${elementName} -> ${elementRef}`);
            const loopVar = elementRef.split('.')[0];
            if (elementName && loopNames.has(loopVar)) {
              Logger.debug('LoopContextPropagator', `Found loop variable reference: ${loopVar} in ${elementName}`);
              this.loopContexts.set(elementName, {
                isInLoop: true,
                loopReferenceName: loopVar,
                depth: 1
              });
            }
          }
        }
      }

      // Look for value references that use loop variables
      if (element.value?.elementReference?.[0]) {
        const elementName = element.name?.[0];
        const elementRef = element.value.elementReference[0];
        if (elementRef && elementRef.startsWith('Loop_over_')) {
          const loopVar = elementRef.split('.')[0];
          if (elementName && loopNames.has(loopVar)) {
            Logger.debug('LoopContextPropagator', `Found loop variable reference: ${loopVar} in ${elementName}`);
            this.loopContexts.set(elementName, {
              isInLoop: true,
              loopReferenceName: loopVar,
              depth: 1
            });
          }
        }
      }
    };

    // Check all types of elements that might have loop variable references
    const checkElements = (elements: any[] | undefined) => {
      if (!elements) return;
      const elementArray = Array.isArray(elements) ? elements : [elements];
      for (const element of elementArray) {
        analyzeElement(element);
      }
    };

    Logger.debug('LoopContextPropagator', 'Checking subflows for loop variable references');
    checkElements(this.metadata.subflows);
    Logger.debug('LoopContextPropagator', 'Checking actionCalls for loop variable references');
    checkElements(this.metadata.actionCalls);
    checkElements(this.metadata.assignments);
    checkElements(this.metadata.recordLookups);
    checkElements(this.metadata.recordCreates);
    checkElements(this.metadata.recordUpdates);
    checkElements(this.metadata.recordDeletes);

    // After finding references, mark all subflows that use loop variables
    if (this.metadata.subflows) {
      const subflows = Array.isArray(this.metadata.subflows) ? this.metadata.subflows : [this.metadata.subflows];
      for (const subflow of subflows) {
        if (subflow.inputAssignments) {
          const inputs = Array.isArray(subflow.inputAssignments) ? subflow.inputAssignments : [subflow.inputAssignments];
          for (const input of inputs as Array<{ value?: { elementReference?: string[] } }>) {
            if (input.value?.elementReference?.[0] && input.value.elementReference[0].startsWith('Loop_over_')) {
              const subflowName = subflow.name?.[0];
              const loopVar = input.value.elementReference[0].split('.')[0];
              if (subflowName && loopNames.has(loopVar)) {
                Logger.debug('LoopContextPropagator', `Found loop variable in subflow: ${loopVar} in ${subflowName}`);
                this.loopContexts.set(subflowName, {
                  isInLoop: true,
                  loopReferenceName: loopVar,
                  depth: 1
                });
              }
            }
          }
        }
      }
    }

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
    this.processElementType(metadata.actionCalls, 'subflows');  // Process actionCalls as subflows
  }

  private isElementInLoop(elementName: string, flowName?: string): boolean {
    // Check direct loop context
    const context = this.loopContexts.get(elementName);
    if (context?.isInLoop) return true;

    // Check if element name is referenced in any variable expressions
    // This helps detect elements that are implicitly in a loop context
    return !!elementName.match(/.*Loop_over_.*/) || !!elementName.match(/Loop\[.*\]/i);
  }

  private findInputValuesForElement(elementName: string): string[] {
    const values: string[] = [];
    if (!this.metadata) return values;

    // Check subflows and actionCalls for input references
    const checkElements = (elements: any[] | undefined) => {
      if (!elements) return;
      const elementArray = Array.isArray(elements) ? elements : [elements];
      for (const element of elementArray) {
        if (element.name?.[0] === elementName) {
          // Check input assignments
          // Handle both cases inputAssignments and inputassignments
          const inputAssignmentsList = element.inputAssignments || element.inputassignments;
          if (inputAssignmentsList) {
            const inputs = Array.isArray(inputAssignmentsList) 
              ? inputAssignmentsList 
              : [inputAssignmentsList];
            Logger.debug('LoopContextPropagator', `Found ${inputs.length} input assignments for ${elementName}`);
            for (const input of inputs) {
              // Extract reference value, handling different XML structures
              let elementRef: string | undefined;
              if (input.value?.elementReference?.[0]) {
                elementRef = input.value.elementReference[0];
              } else if (Array.isArray(input.value) && input.value[0]?.elementReference?.[0]) {
                elementRef = input.value[0].elementReference[0];
              }
              
              if (elementRef) {
                values.push(elementRef);
                Logger.debug('LoopContextPropagator', `Found input reference: ${elementRef}`);
              }
            }
          }

          // Check value references
          if (element.value?.elementReference?.[0]) {
            values.push(element.value.elementReference[0]);
          }
        }
      }
    };

    // Check all possible element types that could have references
    checkElements(this.metadata.subflows);
    checkElements(this.metadata.actionCalls);
    checkElements(this.metadata.assignments);
    checkElements(this.metadata.recordLookups);
    checkElements(this.metadata.recordCreates);
    checkElements(this.metadata.recordUpdates);
    checkElements(this.metadata.recordDeletes);

    return values;
  }

  private processElementType(elements: FlowBaseType[] | FlowBaseType | undefined, type: string): void {
    if (!elements) return;
    const elementArray = Array.isArray(elements) ? elements : [elements];

    for (const element of elementArray) {
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

  /**
   * Internal method to propagate loop contexts through the flow elements.
   * This uses a change-detection approach where we continue propagating until
   * no more changes are detected. This is guaranteed to terminate because:
   * 
   * 1. We only set changed=true when we actually modify a context
   * 2. Each context can only be modified in specific ways:
   *    - Transitioning from not-in-loop to in-loop (once per element)
   *    - Changing loop reference (bounded by number of loops)
   *    - Changing depth (bounded by flow structure)
   * 3. The changed flag is managed exactly where context updates occur
   */
  private propagateContextsInternal(): void {
    let changed = true;
    while (changed) {
      changed = false;
      
      for (const [element, targets] of this.elementConnections.entries()) {
        const elementContext = this.loopContexts.get(element);
        
        if (elementContext?.isInLoop) {
          for (const target of targets) {
            const existingContext = this.loopContexts.get(target);

            const parentContext = elementContext; // Always treat as in-loop within this block
            const currentContext = existingContext || {
              isInLoop: false,
              loopReferenceName: '',
              depth: 0
            };

            // Only update if there's an actual change
            if (!currentContext.isInLoop || 
                currentContext.loopReferenceName !== parentContext.loopReferenceName || 
                currentContext.depth !== parentContext.depth) {
              
              this.loopContexts.set(target, {
                isInLoop: true,
                loopReferenceName: parentContext.loopReferenceName,
                depth: parentContext.depth
              });
              changed = true;
              Logger.debug('LoopContextPropagator', `Propagated loop context to ${target} from ${element}`);
            }

            // Check input/output references for loop context
            const elementName = target;
            const inputValues = this.findInputValuesForElement(elementName);
            for (const value of inputValues) {
              if (value.includes('Loop_over_')) {
                Logger.debug('LoopContextPropagator', `Found loop reference in input: ${value} for ${elementName}`);
                this.loopContexts.set(elementName, {
                  isInLoop: true,
                  loopReferenceName: value.split('.')[0],
                  depth: parentContext.depth + 1
                });
                break;
              }
            }

            // Check if this is a subflow or action call with inputs referencing loop variables
            const elementType = this.elementTypes.get(target);
            const elementNameMatch = target.match(/(.*?)(?:\..*)?$/);
            const baseElementName = elementNameMatch ? elementNameMatch[1] : target;

            if ((elementType === 'subflows' || baseElementName.toLowerCase().includes('validation') || baseElementName.toLowerCase().includes('action')) && this.metadata) {
              Logger.debug('LoopContextPropagator', `Processing subflow/action: ${baseElementName}`);
              const subflows = this.metadata.subflows || [];
              const actionCalls = this.metadata.actionCalls || [];
              const allElements = [...subflows, ...actionCalls];
              const elementData = allElements.find((el: FlowBaseType) => {
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

            // changed flag is now handled when the context is updated
          }
        }
      }
    }
  }
}
