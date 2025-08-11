import * as xml2js from 'xml2js';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './Logger.js';

export interface FlowElement {
  name: string;
  type: string;
  isInLoop: boolean;
  loopContext?: string;
  operations: {
    soql: boolean;
    dml: boolean;
    apex: boolean;
    subflow: boolean;
  };
  nextElements: string[];
  rawData?: any;
}

export interface LoopInfo {
  name: string;
  collection: string;
  nextElement: string;
  elementsInLoop: Set<string>;
  problematicElements: {
    element: string;
    type: string;
    issue: string;
  }[];
}

export interface SubflowInfo {
  name: string;
  flowName: string;
  isInLoop: boolean;
  loopContext?: string;
}

export interface FlowAnalysisResult {
  flowName: string;
  elements: Map<string, FlowElement>;
  loops: Map<string, LoopInfo>;
  subflows: SubflowInfo[];
  bulkificationIssues: string[];
  requiresBulkification: boolean;
  executionPath: string[];
}

export class SimplifiedFlowAnalyzer {
  private elements = new Map<string, FlowElement>();
  private loops = new Map<string, LoopInfo>();
  private subflows: SubflowInfo[] = [];
  private bulkificationIssues: string[] = [];
  private executionPath: string[] = [];
  private visitedElements = new Set<string>();

  async analyzeFlowFromXML(xmlPath: string): Promise<FlowAnalysisResult> {
    const xmlContent = fs.readFileSync(xmlPath, 'utf-8');
    // Remove any flow-related extension
    const flowName = path.basename(xmlPath)
      .replace(/\.flow-meta\.xml$/, '')
      .replace(/\.flow\.xml$/, '')
      .replace(/\.xml$/, '');
    return this.analyzeFlow(xmlContent, flowName);
  }

  async analyzeFlow(xmlContent: string, flowName: string): Promise<FlowAnalysisResult> {
    Logger.info('SimplifiedFlowAnalyzer', `Starting analysis of ${flowName}`);
    
    try {
      // Parse XML
      const flowData = await this.parseXML(xmlContent);
      
      // Reset state
      this.reset();
      
      // Step 1: Identify all elements
      this.identifyElements(flowData);
      
      // Step 2: Build execution path from start
      this.buildExecutionPath(flowData);
      
      // Step 3: Identify loops and mark elements in loops
      this.identifyLoopsAndContents(flowData);
      
      // Step 4: Analyze for bulkification issues
      this.analyzeForBulkificationIssues();
      
      // Step 5: Identify subflows
      this.identifySubflows();
      
      const result = {
        flowName,
        elements: this.elements,
        loops: this.loops,
        subflows: this.subflows,
        bulkificationIssues: this.bulkificationIssues,
        requiresBulkification: this.bulkificationIssues.length > 0,
        executionPath: this.executionPath
      };
      
      this.logAnalysisResults(result);
      
      return result;
      
    } catch (error) {
      Logger.error('SimplifiedFlowAnalyzer', 'Analysis failed', error);
      throw error;
    }
  }

  private reset(): void {
    this.elements.clear();
    this.loops.clear();
    this.subflows = [];
    this.bulkificationIssues = [];
    this.executionPath = [];
    this.visitedElements.clear();
  }

  private async parseXML(xmlContent: string): Promise<any> {
    const parser = new xml2js.Parser({
      explicitArray: false,
      mergeAttrs: true,
      normalizeTags: true
    });
    
    const result = await parser.parseStringPromise(xmlContent);
    return result.flow || result;
  }

  private identifyElements(flowData: any): void {
    const elementTypes = [
      'actioncalls',
      'assignments', 
      'decisions',
      'loops',
      'recordlookups',
      'recordcreates',
      'recordupdates',
      'recorddeletes',
      'subflows',
      'collectionprocessors'
    ];

    for (const type of elementTypes) {
      if (flowData[type]) {
        const elements = Array.isArray(flowData[type]) ? flowData[type] : [flowData[type]];
        
        for (const element of elements) {
          const name = this.getElementName(element);
          
          this.elements.set(name, {
            name,
            type,
            isInLoop: false,
            operations: {
              soql: type === 'recordlookups',
              dml: ['recordcreates', 'recordupdates', 'recorddeletes'].includes(type),
              apex: type === 'actioncalls',
              subflow: type === 'subflows'
            },
            nextElements: this.getNextElements(element),
            rawData: element
          });
        }
      }
    }
  }

  private buildExecutionPath(flowData: any): void {
    // Find start element
    const startElement = flowData.start?.connector?.targetreference;
    if (!startElement) {
      Logger.warn('SimplifiedFlowAnalyzer', 'No start element found');
      return;
    }
    
    this.traverseFlow(startElement);
  }

  private traverseFlow(elementName: string): void {
    if (this.visitedElements.has(elementName)) return;
    
    this.visitedElements.add(elementName);
    this.executionPath.push(elementName);
    
    const element = this.elements.get(elementName);
    if (element) {
      for (const nextElement of element.nextElements) {
        this.traverseFlow(nextElement);
      }
    }
  }

  private identifyLoopsAndContents(flowData: any): void {
    if (!flowData.loops) return;
    
    const loops = Array.isArray(flowData.loops) ? flowData.loops : [flowData.loops];
    
    for (const loop of loops) {
      const loopName = this.getElementName(loop);
      const collection = loop.collectionreference || '';
      const nextElement = loop.nextvalueconnector?.targetreference || '';
      
      const loopInfo: LoopInfo = {
        name: loopName,
        collection,
        nextElement,
        elementsInLoop: new Set(),
        problematicElements: []
      };
      
      // Mark all elements that are inside this loop
      if (nextElement) {
        this.markElementsInLoop(nextElement, loopInfo, new Set());
      }
      
      this.loops.set(loopName, loopInfo);
    }
  }

  private markElementsInLoop(
    elementName: string, 
    loopInfo: LoopInfo,
    visited: Set<string>
  ): void {
    // Avoid infinite recursion
    if (visited.has(elementName)) return;
    visited.add(elementName);
    
    // Stop if we've reached the loop element again (end of loop)
    if (elementName === loopInfo.name) return;
    
    const element = this.elements.get(elementName);
    if (!element) return;
    
    // Mark this element as being in the loop
    element.isInLoop = true;
    element.loopContext = loopInfo.name;
    loopInfo.elementsInLoop.add(elementName);
    
    // Continue traversing
    for (const nextElement of element.nextElements) {
      this.markElementsInLoop(nextElement, loopInfo, visited);
    }
  }

  private analyzeForBulkificationIssues(): void {
    for (const [loopName, loopInfo] of this.loops) {
      for (const elementName of loopInfo.elementsInLoop) {
        const element = this.elements.get(elementName);
        if (!element) continue;
        
        if (element.operations.soql) {
          const issue = `SOQL query "${elementName}" inside loop "${loopName}" - Will hit governor limits`;
          loopInfo.problematicElements.push({
            element: elementName,
            type: 'SOQL',
            issue
          });
          this.bulkificationIssues.push(issue);
        }
        
        if (element.operations.dml) {
          const issue = `DML operation "${elementName}" inside loop "${loopName}" - Will hit governor limits`;
          loopInfo.problematicElements.push({
            element: elementName,
            type: 'DML',
            issue
          });
          this.bulkificationIssues.push(issue);
        }
        
        if (element.operations.apex) {
          const actionName = element.rawData?.actionname || 'Unknown';
          const issue = `Apex action "${actionName}" (${elementName}) inside loop "${loopName}" - Check for bulk safety`;
          loopInfo.problematicElements.push({
            element: elementName,
            type: 'Apex',
            issue
          });
          this.bulkificationIssues.push(issue);
        }
        
        if (element.operations.subflow) {
          const subflowName = element.rawData?.flowname || 'Unknown';
          const issue = `Subflow "${subflowName}" (${elementName}) inside loop "${loopName}" - Needs deep analysis`;
          loopInfo.problematicElements.push({
            element: elementName,
            type: 'Subflow',
            issue
          });
          this.bulkificationIssues.push(issue);
        }
      }
    }
  }

  private identifySubflows(): void {
    for (const [name, element] of this.elements) {
      if (element.operations.subflow) {
        const flowName = element.rawData?.flowname || 'Unknown';
        this.subflows.push({
          name,
          flowName,
          isInLoop: element.isInLoop,
          loopContext: element.loopContext
        });
      }
    }
  }

  private getElementName(element: any): string {
    return element.name || 'Unknown';
  }

  private getNextElements(element: any): string[] {
    const nextElements: string[] = [];
    
    // Regular connector
    if (element.connector?.targetreference) {
      nextElements.push(element.connector.targetreference);
    }
    
    // Loop next value connector
    if (element.nextvalueconnector?.targetreference) {
      nextElements.push(element.nextvalueconnector.targetreference);
    }
    
    // Decision default connector
    if (element.defaultconnector?.targetreference) {
      nextElements.push(element.defaultconnector.targetreference);
    }

    // Fault connector
    if (element.faultconnector?.targetreference) {
      nextElements.push(element.faultconnector.targetreference);
    }

    // Multiple fault connectors (some elements support arrays)
    if (element.faultconnectors) {
      const faults = Array.isArray(element.faultconnectors)
        ? element.faultconnectors
        : [element.faultconnectors];
      for (const fault of faults) {
        if (fault.targetreference) {
          nextElements.push(fault.targetreference);
        } else if (fault.connector?.targetreference) {
          nextElements.push(fault.connector.targetreference);
        }
      }
    }

    // Decision rules
    if (element.rules) {
      const rules = Array.isArray(element.rules) ? element.rules : [element.rules];
      for (const rule of rules) {
        if (rule.connector?.targetreference) {
          nextElements.push(rule.connector.targetreference);
        }
      }
    }
    
    return nextElements;
  }

  private logAnalysisResults(result: FlowAnalysisResult): void {
    Logger.info('SimplifiedFlowAnalyzer', '=== Flow Analysis Results ===');
    Logger.info('SimplifiedFlowAnalyzer', `Flow: ${result.flowName}`);
    Logger.info('SimplifiedFlowAnalyzer', `Total Elements: ${result.elements.size}`);
    Logger.info('SimplifiedFlowAnalyzer', `Loops Found: ${result.loops.size}`);
    
    if (result.loops.size > 0) {
      Logger.info('SimplifiedFlowAnalyzer', '\n--- Loop Details ---');
      for (const [name, loop] of result.loops) {
        Logger.info('SimplifiedFlowAnalyzer', `Loop: ${name}`);
        Logger.info('SimplifiedFlowAnalyzer', `  Collection: ${loop.collection}`);
        Logger.info('SimplifiedFlowAnalyzer', `  Elements in loop: ${loop.elementsInLoop.size}`);
        if (loop.problematicElements.length > 0) {
          Logger.warn('SimplifiedFlowAnalyzer', `  Issues found:`);
          for (const problem of loop.problematicElements) {
            Logger.warn('SimplifiedFlowAnalyzer', `    - ${problem.issue}`);
          }
        }
      }
    }
    
    if (result.subflows.length > 0) {
      Logger.info('SimplifiedFlowAnalyzer', '\n--- Subflows ---');
      for (const subflow of result.subflows) {
        Logger.info('SimplifiedFlowAnalyzer', 
          `Subflow: ${subflow.flowName} (element: ${subflow.name})` +
          (subflow.isInLoop ? ` [IN LOOP: ${subflow.loopContext}]` : ''));
      }
    }
    
    if (result.bulkificationIssues.length > 0) {
      Logger.warn('SimplifiedFlowAnalyzer', '\n--- Bulkification Issues ---');
      for (const issue of result.bulkificationIssues) {
        Logger.warn('SimplifiedFlowAnalyzer', `• ${issue}`);
      }
    }
    
    Logger.info('SimplifiedFlowAnalyzer', `\nRequires Bulkification: ${result.requiresBulkification ? 'YES' : 'NO'}`);
  }

  async analyzeSubflows(
    mainFlowPath: string,
    flowDirectory?: string
  ): Promise<Map<string, FlowAnalysisResult>> {
    const results = new Map<string, FlowAnalysisResult>();
    const flowDir = flowDirectory || path.dirname(mainFlowPath);
    
    // Analyze main flow
    const mainResult = await this.analyzeFlowFromXML(mainFlowPath);
    results.set(mainResult.flowName, mainResult);
    
    // Analyze each subflow
    for (const subflow of mainResult.subflows) {
      const subflowPath = path.join(flowDir, `${subflow.flowName}.flow-meta.xml`);
      
      if (fs.existsSync(subflowPath)) {
        Logger.info('SimplifiedFlowAnalyzer', `Analyzing subflow: ${subflow.flowName}`);
        const subflowResult = await this.analyzeFlowFromXML(subflowPath);
        
        // Update subflow analysis with parent loop context
        if (subflow.isInLoop) {
          subflowResult.bulkificationIssues.push(
            `Entire subflow "${subflow.flowName}" is called within loop "${subflow.loopContext}" - All operations will be repeated`
          );
          subflowResult.requiresBulkification = true;
        }
        
        results.set(subflow.flowName, subflowResult);
      } else {
        Logger.warn('SimplifiedFlowAnalyzer', `Subflow not found: ${subflowPath}`);
      }
    }
    
    return results;
  }
}