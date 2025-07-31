import { FlowMetadata, FlowElements } from '../interfaces/SubflowTypes.js';
import { LoopMetrics, LoopContext } from '../interfaces/FlowTypes.js';
import { Logger } from '../Logger.js';

export interface FlowMetrics {
  elements: FlowElements;
  dmlOperations: number;
  soqlQueries: number;
  soqlSources: Set<string>;
  dmlSources: Set<string>;
  soqlInLoop: boolean;
  parameters: Map<string, any>;
  loops: LoopMetrics[];
  loopContexts: Map<string, LoopContext>;
}

export class MetricsCalculator {
  private countElements(elements: any): number {
    return Array.isArray(elements) ? elements.length : 1;
  }

  private countFlowElements(metadata: FlowMetadata): FlowElements {
    const elements: FlowElements = { total: 0 };
    
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
        elements[type.key] = count;
        elements.total += count;
        Logger.debug('MetricsCalculator', `Found ${count} ${type.name}`);
      }
    }

    return elements;
  }

  private analyzeLoops(metadata: FlowMetadata): {
    loopMetrics: LoopMetrics[];
    loopContexts: Map<string, LoopContext>;
  } {
    const loopMetrics: LoopMetrics[] = [];
    const loopContexts = new Map<string, LoopContext>();
    
    if (!metadata.loops) return { loopMetrics, loopContexts };
    
    const loops = Array.isArray(metadata.loops) ? metadata.loops : [metadata.loops];
    
    for (const loop of loops) {
      const loopName = loop.name?.[0] || 'UnnamedLoop';
      const metrics: LoopMetrics = {
        totalLoops: 1,
        itemsProcessed: [],
        containsDML: false,
        containsSOQL: false,
        containsSubflows: false,
        nestedElements: {
          dml: 0,
          soql: 0,
          subflows: 0,
          other: 0
        },
        loopVariables: {
          inputCollection: loop.collectionReference?.[0] || '',
          currentItem: loop.iterationVariable?.[0] || '',
          iterationOrder: (loop.iterationOrder?.[0] || 'Asc') as 'Asc' | 'Desc'
        }
      };
      
      // Track elements connected to this loop
      const connectedElements = new Set<string>();
      if (loop.connector) {
        const connectors = Array.isArray(loop.connector) ? loop.connector : [loop.connector];
        for (const connector of connectors) {
          if (connector.targetReference) {
            const targetRef = connector.targetReference[0];
            connectedElements.add(targetRef);
            loopContexts.set(targetRef, {
              isInLoop: true,
              loopReferenceName: loopName,
              depth: 1
            });
          }
        }
      }

      // Analyze elements connected to this loop
      connectedElements.forEach(elementRef => {
        // Check for DML operations
        if (metadata.recordCreates?.some(e => e.name?.[0] === elementRef)) {
          metrics.containsDML = true;
          metrics.nestedElements.dml++;
        }
        if (metadata.recordUpdates?.some(e => e.name?.[0] === elementRef)) {
          metrics.containsDML = true;
          metrics.nestedElements.dml++;
        }
        if (metadata.recordDeletes?.some(e => e.name?.[0] === elementRef)) {
          metrics.containsDML = true;
          metrics.nestedElements.dml++;
        }

        // Check for SOQL operations
        if (metadata.recordLookups?.some(e => e.name?.[0] === elementRef)) {
          metrics.containsSOQL = true;
          metrics.nestedElements.soql++;
        }

        // Check for subflows
        if (metadata.subflows?.some(e => e.name?.[0] === elementRef)) {
          metrics.containsSubflows = true;
          metrics.nestedElements.subflows++;
        }

        // Count other elements
        if (metadata.assignments?.some(e => e.name?.[0] === elementRef)) {
          metrics.nestedElements.other++;
        }
        if (metadata.decisions?.some(e => e.name?.[0] === elementRef)) {
          metrics.nestedElements.other++;
        }
      });
      
      loopMetrics.push(metrics);
    }
    
    return { loopMetrics, loopContexts };
  }

  calculateMetrics(metadata: FlowMetadata): FlowMetrics {
    const elements = this.countFlowElements(metadata);
    let dmlOperations = 0;
    let soqlQueries = 0;
    let soqlInLoop = false;
    const soqlSources = new Set<string>();
    const dmlSources = new Set<string>();
    const parameters = new Map<string, any>();

    // Count DML operations
    if (metadata.recordCreates) {
      dmlOperations += this.countElements(metadata.recordCreates);
      dmlSources.add('Record Creates');
    }
    if (metadata.recordUpdates) {
      dmlOperations += this.countElements(metadata.recordUpdates);
      dmlSources.add('Record Updates');
    }
    if (metadata.recordDeletes) {
      dmlOperations += this.countElements(metadata.recordDeletes);
      dmlSources.add('Record Deletes');
    }

    // Record Lookups (Get Records)
    if (metadata.recordLookups) {
      const lookups = Array.isArray(metadata.recordLookups) ? metadata.recordLookups : [metadata.recordLookups];
      soqlQueries += lookups.length;
      soqlSources.add('Record Lookups');
    }

    // Dynamic Choice Sets
    if (metadata.dynamicChoiceSets) {
      const choiceSets = Array.isArray(metadata.dynamicChoiceSets) ? metadata.dynamicChoiceSets : [metadata.dynamicChoiceSets];
      soqlQueries += choiceSets.length;
      soqlSources.add('Dynamic Choice Sets');
    }

    // Record-Triggered Flow
    if (metadata.trigger && metadata.trigger[0]?.type?.[0] === 'RecordAfterSave') {
      soqlQueries++; // Count implicit query for the triggering record
      soqlSources.add('Record-Triggered Flow');
    }

    // Formula Elements with Cross-Object References
    if (metadata.formulas) {
      const formulas = Array.isArray(metadata.formulas) ? metadata.formulas : [metadata.formulas];
      for (const formula of formulas) {
        if (formula.expression?.[0]?.includes('.')) {
          soqlQueries++; // Count cross-object reference queries
          soqlSources.add('Cross-Object Formula References');
        }
      }
    }

    // Extract parameters
    if (metadata.variables) {
      const variables = Array.isArray(metadata.variables) ? metadata.variables : [metadata.variables];
      variables.forEach((variable: any) => {
        if (variable.isInput?.[0] === 'true' || variable.isOutput?.[0] === 'true') {
          parameters.set(variable.name[0], {
            dataType: variable.dataType?.[0],
            isInput: variable.isInput?.[0] === 'true',
            isOutput: variable.isOutput?.[0] === 'true',
            isCollection: variable.isCollection?.[0] === 'true'
          });
        }
      });
    }

    // Analyze loops
    const { loopMetrics, loopContexts } = this.analyzeLoops(metadata);

    return {
      elements,
      dmlOperations,
      soqlQueries,
      soqlSources,
      dmlSources,
      soqlInLoop,
      parameters,
      loops: loopMetrics,
      loopContexts
    };
  }
}