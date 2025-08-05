import { FlowMetadata, LoopContext, LoopMetrics } from '../../../types';
import { Logger } from '../../Logger.js';
import { LoopContextPropagator } from './LoopContextPropagator.js';

import { LogLevel } from '../../Logger.js';

export class LoopAnalyzer {
  private countElements(elements: unknown[] | unknown): number {
    return Array.isArray(elements) ? elements.length : elements ? 1 : 0;
  }

  private findAllReferencedSubflows(metadata: FlowMetadata, element: any, visited = new Set<string>()): {name: string; flowName: string}[] {
    if (!element) return [];

    const elementName = Array.isArray(element.name) ? element.name[0] : (Array.isArray(element.n) ? element.n[0] : element.n);
    if (!elementName || visited.has(elementName)) {
      return [];
    }
    visited.add(elementName);

    Logger.debug('LoopAnalyzer', `Finding subflows for element:`, { 
      name: elementName, 
      element
    });
    
    const foundSubflows: {name: string; flowName: string}[] = [];

    // Normalize XML property names
    const normalizeProps = (obj: any): any => {
      if (!obj) return {};
      const result: any = {};
      Object.entries(obj).forEach(([key, value]) => {
        result[key.toLowerCase()] = value;
      });
      return result;
    };

    // Check for subflows by inspecting XML structure
    const outerSubflows = metadata.subflows || metadata.Subflows;
    if (outerSubflows) {
      const subflows = Array.isArray(outerSubflows) ? outerSubflows : [outerSubflows];
      subflows.forEach((subflow: any) => {
        const normalizedSubflow = normalizeProps(subflow);
        // Check if this subflow is referenced from our current element
        if (elementName === normalizedSubflow.n?.[0] || 
            elementName === normalizedSubflow.name?.[0] ||
            this.isElementConnectedTo(element, normalizedSubflow.n?.[0] || normalizedSubflow.name?.[0])) {
          foundSubflows.push({
            name: normalizedSubflow.n?.[0] || normalizedSubflow.name?.[0] || 'Unnamed Subflow',
            flowName: normalizedSubflow.flowname?.[0] || normalizedSubflow.flowName?.[0] || 'Unknown Flow'
          });
        }
      });
    }

    // Get all potential next elements through connectors
    const nextElements: any[] = [];

    // Check all types of connectors
    const connectors = [
      { source: element.connector || element.Connector, type: 'connector' },
      { source: element.nextValueConnector || element.nextvalueconnector || element.NextValueConnector, type: 'nextValueConnector' },
      { source: element.defaultConnector || element.defaultconnector || element.DefaultConnector, type: 'defaultConnector' }
    ];

    // Process each connector
    connectors.forEach(({ source, type }) => {
      if (source?.targetReference?.[0] || source?.targetreference?.[0]) {
        const targetRef = source.targetReference?.[0] || source.targetreference?.[0];
        Logger.debug('LoopAnalyzer', `Following ${type} target: ${targetRef}`);

        // Check if target is a subflow directly
        if (metadata.subflows) {
          const subflows = Array.isArray(metadata.subflows) ? metadata.subflows : [metadata.subflows];
          subflows.forEach((subflow: any) => {
            const normalizedSubflow = normalizeProps(subflow);
            if (normalizedSubflow.n?.[0] === targetRef || normalizedSubflow.name?.[0] === targetRef) {
              foundSubflows.push({
                name: normalizedSubflow.n?.[0] || normalizedSubflow.name?.[0] || 'Unnamed Subflow',
                flowName: normalizedSubflow.flowname?.[0] || normalizedSubflow.flowName?.[0] || 'Unknown Flow'
              });
            }
          });
        }

        // Add target element for further traversal
        const nextElement = this.findElementByName(metadata, targetRef);
        if (nextElement) {
          Logger.debug('LoopAnalyzer', `Found next element via ${type}:`, nextElement);
          nextElements.push(nextElement);
        }
      }
    });

    // Check rules for decisions
    const rules = element.rules || element.Rules;
    if (rules) {
      const ruleArray = Array.isArray(rules) ? rules : [rules];
      ruleArray.forEach((rule: any) => {
        const ruleConnector = rule.connector || rule.Connector;
        if (ruleConnector?.targetReference?.[0] || ruleConnector?.targetreference?.[0]) {
          const targetRef = ruleConnector.targetReference?.[0] || ruleConnector.targetreference?.[0];
          Logger.debug('LoopAnalyzer', `Following rule connector target: ${targetRef}`);

          // Check if target is a subflow
          if (metadata.subflows) {
            const subflows = Array.isArray(metadata.subflows) ? metadata.subflows : [metadata.subflows];
            subflows.forEach((subflow: any) => {
              const normalizedSubflow = normalizeProps(subflow);
              if (normalizedSubflow.n?.[0] === targetRef || normalizedSubflow.name?.[0] === targetRef) {
                foundSubflows.push({
                  name: normalizedSubflow.n?.[0] || normalizedSubflow.name?.[0] || 'Unnamed Subflow',
                  flowName: normalizedSubflow.flowname?.[0] || normalizedSubflow.flowName?.[0] || 'Unknown Flow'
                });
              }
            });
          }

          const nextElement = this.findElementByName(metadata, targetRef);
          if (nextElement) {
            Logger.debug('LoopAnalyzer', `Found next element via rule:`, nextElement);
            nextElements.push(nextElement);
          }
        }
      });
    }

    // Recursively check each next element
    nextElements.forEach(nextElement => {
      foundSubflows.push(...this.findAllReferencedSubflows(metadata, nextElement, visited));
    });

    return foundSubflows;
  }

  private isElementConnectedTo(element: any, targetName: string): boolean {
    // Check all possible connector types
    const connectors = [
      element.connector?.targetReference?.[0],
      element.nextValueConnector?.targetReference?.[0],
      element.defaultConnector?.targetReference?.[0],
      element.Connector?.targetReference?.[0],
      element.NextValueConnector?.targetReference?.[0],
      element.DefaultConnector?.targetReference?.[0]
    ];

    // Check rules
    const rules = element.rules || element.Rules;
    if (rules) {
      const ruleArray = Array.isArray(rules) ? rules : [rules];
      ruleArray.forEach((rule: any) => {
        if (rule.connector?.targetReference?.[0]) {
          connectors.push(rule.connector.targetReference[0]);
        }
        if (rule.Connector?.targetReference?.[0]) {
          connectors.push(rule.Connector.targetReference[0]);
        }
      });
    }

    return connectors.some(ref => ref === targetName);
  }

  private findElementByName(metadata: FlowMetadata, name: string): any {
    const elementTypes = [
      { key: 'decisions', alt: 'Decisions' },
      { key: 'assignments', alt: 'Assignments' },
      { key: 'loops', alt: 'Loops' },
      { key: 'recordCreates', alt: 'recordcreates' },
      { key: 'recordUpdates', alt: 'recordupdates' },
      { key: 'recordDeletes', alt: 'recorddeletes' },
      { key: 'recordLookups', alt: 'recordlookups' },
      { key: 'subflows', alt: 'Subflows' },
      { key: 'actionCalls', alt: 'actioncalls' }
    ];

    for (const { key, alt } of elementTypes) {
      const elements = metadata[key] || metadata[alt];
      if (elements) {
        const elementArray = Array.isArray(elements) ? elements : [elements];
        for (const element of elementArray) {
          const elementName = 
            (Array.isArray(element.name) ? element.name[0] : element.name) ||
            (Array.isArray(element.n) ? element.n[0] : element.n);
          
          if (elementName === name) {
            return element;
          }
        }
      }
    }
    return null;
  }

  analyze(metadata: FlowMetadata): {
    loopMetrics: LoopMetrics[];
    loopContexts: Map<string, LoopContext>;
    bulkificationIssues: string[];
  } {
    Logger.setLogLevel(LogLevel.DEBUG);
    Logger.debug('LoopAnalyzer', 'Starting analysis with debug logging');
    Logger.debug('LoopAnalyzer', 'Metadata structure:', JSON.stringify(metadata, null, 2));
    
    const loopMetrics: LoopMetrics[] = [];
    const bulkificationIssues: string[] = [];

    // Get propagated loop contexts
    const propagator = new LoopContextPropagator();
    const loopContexts = propagator.propagateLoopContexts(metadata);

    if (!metadata.loops) {
      return { loopMetrics, loopContexts, bulkificationIssues };
    }

    const loops = Array.isArray(metadata.loops) ? metadata.loops : [metadata.loops];
    Logger.debug('LoopAnalyzer', 'Processing loops:', loops);
    
    for (const loop of loops) {
      const loopName = Array.isArray(loop.name) ? loop.name[0] : (Array.isArray(loop.n) ? loop.n[0] : (loop.n || 'UnnamedLoop'));
      Logger.debug('LoopAnalyzer', 'Processing loop:', { name: loopName, loop });
      
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

      // Find all subflows in loop
      const foundSubflows: {name: string; flowName: string}[] = [];
      
      // Find all subflows in any connected paths
      const referencedSubflows = this.findAllReferencedSubflows(metadata, loop, new Set());
      foundSubflows.push(...referencedSubflows);
      nestedElements.subflows += referencedSubflows.length;
      Logger.debug('LoopAnalyzer', 'Found subflows in paths:', referencedSubflows);
      
      // Check direct subflows tag
      if (loop.subflows) {
        const subflows = Array.isArray(loop.subflows) ? loop.subflows : [loop.subflows];
        subflows.forEach((subflow: any) => {
          foundSubflows.push({
            name: subflow.n?.[0] || 'Unnamed Subflow',
            flowName: subflow.flowName?.[0] || 'Unknown Flow'
          });
          nestedElements.subflows++;
        });
      }
      
      // Check action calls
      if (loop.actionCalls) {
        const actionCalls = Array.isArray(loop.actionCalls) ? loop.actionCalls : [loop.actionCalls];
        actionCalls.forEach((action: any) => {
          foundSubflows.push({
            name: action.n?.[0] || 'Unnamed Action',
            flowName: action.actionName?.[0] || 'Unknown Action'
          });
          nestedElements.subflows++;
        });
      }

      Logger.debug('LoopAnalyzer', `Found ${foundSubflows.length} subflows/actions in loop ${loopName}:`, foundSubflows);

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
        bulkificationIssues.push(`DML operations found in loop '${loopName}' processing ${metrics.loopVariables.inputCollection}`);
      }
      if (metrics.containsSOQL) {
        bulkificationIssues.push(`SOQL queries found in loop '${loopName}' processing ${metrics.loopVariables.inputCollection}`);
      }
      if (metrics.containsSubflows) {
        const subflowList = foundSubflows.map(sf => `${sf.name} (${sf.flowName})`).join('\n- ');
        bulkificationIssues.push(`Subflow calls found in loop '${loopName}' processing ${metrics.loopVariables.inputCollection}:\n- ${subflowList}`);
      }

      loopMetrics.push(metrics);
    }

    return { loopMetrics, loopContexts, bulkificationIssues };
  }
}
