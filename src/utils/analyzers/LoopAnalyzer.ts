import { FlowMetadata } from '../../types/elements';
import { LoopMetrics, LoopContext } from '../../types/loops';
import { Logger } from '../Logger.js';

export class LoopAnalyzer {
  private countElements(elements: unknown[] | unknown): number {
    return Array.isArray(elements) ? elements.length : 1;
  }

  analyzeLoops(metadata: FlowMetadata): {
    loopMetrics: LoopMetrics[];
    loopContexts: Map<string, LoopContext>;
    bulkificationIssues: string[];
  } {
    const loopMetrics: LoopMetrics[] = [];
    const loopContexts = new Map<string, LoopContext>();
    const bulkificationIssues: string[] = [];

    if (!metadata.loops) {
      return { loopMetrics, loopContexts, bulkificationIssues };
    }

    const loops = Array.isArray(metadata.loops) ? metadata.loops : [metadata.loops];
    
    for (const loop of loops) {
      const loopName = loop.name?.[0] || 'UnnamedLoop';
      
      // Analyze loop contents
      const nestedElements = {
        dml: 0,
        soql: 0,
        subflows: 0,
        other: 0
      };

      // Count DML operations in loop
      if (loop.recordCreates) nestedElements.dml += this.countElements(loop.recordCreates);
      if (loop.recordUpdates) nestedElements.dml += this.countElements(loop.recordUpdates);
      if (loop.recordDeletes) nestedElements.dml += this.countElements(loop.recordDeletes);

      // Count SOQL operations in loop
      if (loop.recordLookups) nestedElements.soql += this.countElements(loop.recordLookups);
      if (loop.dynamicChoiceSets) nestedElements.soql += this.countElements(loop.dynamicChoiceSets);

      // Count subflows in loop
      if (loop.subflows) nestedElements.subflows += this.countElements(loop.subflows);

      // Count other elements
      if (loop.assignments) nestedElements.other += this.countElements(loop.assignments);
      if (loop.decisions) nestedElements.other += this.countElements(loop.decisions);

      const metrics: LoopMetrics = {
        totalLoops: 1,
        itemsProcessed: [],
        containsDML: nestedElements.dml > 0,
        containsSOQL: nestedElements.soql > 0,
        containsSubflows: nestedElements.subflows > 0,
        nestedElements,
        loopVariables: {
          inputCollection: Array.isArray(loop.collectionReference) ? loop.collectionReference[0] : (loop.collectionReference || ''),
          currentItem: Array.isArray(loop.iterationVariable) ? loop.iterationVariable[0] : (loop.iterationVariable || ''),
          iterationOrder: (Array.isArray(loop.iterationOrder) ? loop.iterationOrder[0] : loop.iterationOrder || 'Asc') as 'Asc' | 'Desc'
        }
      };

      // Generate bulkification recommendations
      if (metrics.containsDML) {
        bulkificationIssues.push(
          `DML operations found in loop '${loopName}' processing ${metrics.loopVariables.inputCollection}`
        );
      }
      if (metrics.containsSOQL) {
        bulkificationIssues.push(
          `SOQL queries found in loop '${loopName}' processing ${metrics.loopVariables.inputCollection}`
        );
      }
      if (metrics.containsSubflows) {
        bulkificationIssues.push(
          `Subflow calls found in loop '${loopName}' processing ${metrics.loopVariables.inputCollection}`
        );
      }

      // Track elements within the loop context
      if (loop.connector) {
        const connectors = Array.isArray(loop.connector) ? loop.connector : [loop.connector];
        for (const connector of connectors) {
          if (connector.targetReference) {
            const targetRef = connector.targetReference[0];
            loopContexts.set(targetRef, {
              isInLoop: true,
              loopReferenceName: loopName,
              depth: 1
            });
          }
        }
      }

      loopMetrics.push(metrics);
    }

    return { loopMetrics, loopContexts, bulkificationIssues };
  }
}