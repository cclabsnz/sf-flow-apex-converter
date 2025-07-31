import { FlowMetadata, LoopMetrics, LoopContext, FlowBaseType } from '../../../types';

export class LoopAnalyzer {
  static analyzeLoops(metadata: FlowMetadata): {
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
      
      const connectedElements = new Set<string>();
      if (loop.connector) {
        const connectors = loop.connector as Array<{ targetReference?: string[] }>;
        for (const connector of connectors) {
          if (connector.targetReference?.[0]) {
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

      connectedElements.forEach(elementRef => {
        if (metadata.recordCreates?.some((e: FlowBaseType) => e.name?.[0] === elementRef)) {
          metrics.containsDML = true;
          metrics.nestedElements.dml++;
        }
        if (metadata.recordUpdates?.some((e: FlowBaseType) => e.name?.[0] === elementRef)) {
          metrics.containsDML = true;
          metrics.nestedElements.dml++;
        }
        if (metadata.recordDeletes?.some((e: FlowBaseType) => e.name?.[0] === elementRef)) {
          metrics.containsDML = true;
          metrics.nestedElements.dml++;
        }

        if (metadata.recordLookups?.some((e: FlowBaseType) => e.name?.[0] === elementRef)) {
          metrics.containsSOQL = true;
          metrics.nestedElements.soql++;
        }

        if (metadata.subflows?.some((e: FlowBaseType) => e.name?.[0] === elementRef)) {
          metrics.containsSubflows = true;
          metrics.nestedElements.subflows++;
        }

        if (metadata.assignments?.some((e: FlowBaseType) => e.name?.[0] === elementRef)) {
          metrics.nestedElements.other++;
        }
        if (metadata.decisions?.some((e: FlowBaseType) => e.name?.[0] === elementRef)) {
          metrics.nestedElements.other++;
        }
      });
      
      loopMetrics.push(metrics);
    }
    
    return { loopMetrics, loopContexts };
  }
}