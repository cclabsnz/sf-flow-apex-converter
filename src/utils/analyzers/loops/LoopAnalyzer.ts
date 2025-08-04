import { FlowMetadata, LoopContext, LoopMetrics } from '../../../types';
import { Logger } from '../../Logger.js';
import { LoopContextPropagator } from './LoopContextPropagator.js';

import { LogLevel } from '../../Logger.js';

export class LoopAnalyzer {
  private countElements(elements: unknown[] | unknown): number {
    return Array.isArray(elements) ? elements.length : elements ? 1 : 0;
  }

analyze(metadata: FlowMetadata): {
    loopMetrics: LoopMetrics[];
    loopContexts: Map<string, LoopContext>;
    bulkificationIssues: string[];
  } {
    Logger.setLogLevel(LogLevel.DEBUG);
    Logger.debug('LoopAnalyzer', 'Starting analysis with debug logging');
    const loopMetrics: LoopMetrics[] = [];
    const bulkificationIssues: string[] = [];

    // Get propagated loop contexts
    const propagator = new LoopContextPropagator();
    const loopContexts = propagator.propagateLoopContexts(metadata);

    if (!metadata.loops) {
      return { loopMetrics, loopContexts, bulkificationIssues };
    }

    const loops = Array.isArray(metadata.loops) ? metadata.loops : [metadata.loops];
    
    for (const loop of loops) {
      const loopName = loop.name?.[0] || 'UnnamedLoop';
      
      // Debug loop structure
      Logger.debug('LoopAnalyzer', 'Loop structure:', {
        name: loopName,
        collectionReference: loop.collectionReference,
        iterationVariable: loop.iterationVariable,
        iterationOrder: loop.iterationOrder
      });
      
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

      // Count subflows and action calls in loop
      if (loop.subflows) nestedElements.subflows += this.countElements(loop.subflows);
      if (loop.actionCalls) nestedElements.subflows += this.countElements(loop.actionCalls);
      
      // Also check for action calls in elements array
      if (loop.elements) {
        const elements = Array.isArray(loop.elements) ? loop.elements : [loop.elements];
        for (const element of elements) {
          if ((element as any).actionCall || (Array.isArray((element as any).type) && (element as any).type[0] === 'ActionCall')) {
            nestedElements.subflows++;
          }
        }
      }

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
          inputCollection: loop.collectionReference?.toString() || '',
          currentItem: loop.iterationVariable?.toString() || '',
          iterationOrder: (loop.iterationOrder?.toString() || 'Asc') as 'Asc' | 'Desc'
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

      loopMetrics.push(metrics);
    }

    return { loopMetrics, loopContexts, bulkificationIssues };
  }
}
