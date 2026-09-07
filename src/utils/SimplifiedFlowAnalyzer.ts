import * as xml2js from 'xml2js';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './Logger.js';

export interface FlowFieldMapping {
  sourceField: string;
  targetField: string;
  dataType: string;
  isCollection: boolean;
  objectType?: string;
}

export interface FlowCondition {
  leftValue: string;
  operator: string;
  rightValue: string;
  dataType: string;
}

export interface FlowValidationRule {
  name: string;
  conditions: FlowCondition[];
  logicType: 'AND' | 'OR';
  errorMessage?: string;
  errorSolution?: string;
  nextElementOnTrue?: string;
  nextElementOnFalse?: string;
}

export interface FlowParameter {
  name: string;
  dataType: string;
  value?: string;
  elementReference?: string;
  fieldMapping?: FlowFieldMapping;
  validationRules?: FlowValidationRule[];
}

export interface FlowAssignment {
  variable: string;
  operator: string;
  value: string;
  dataType: string;
  isCollection: boolean;
}

export interface FlowDecision {
  name: string;
  conditions: FlowCondition[];
  logicType: 'AND' | 'OR';
  nextElementOnTrue?: string;
  nextElementOnFalse?: string;
}

export interface FlowDMLOperation {
  type: 'insert' | 'update' | 'delete' | 'upsert';
  object: string;
  fields: Map<string, string>;
  conditions?: FlowCondition[];
}

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
  flowName?: string;
  inputParameters?: FlowParameter[];
  outputParameters?: FlowParameter[];
  decisions?: FlowDecision[];
  assignments?: FlowAssignment[];
  dmlOperations?: FlowDMLOperation[];
  validationRules?: FlowValidationRule[];
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
  assignments?: FlowAssignment[];
  decisions?: FlowDecision[];
  dmlOperations?: FlowDMLOperation[];
  validationRules?: FlowValidationRule[];
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
  /** Public: BulkifiedApexGenerator resolves decision branch targets through this. */
  elements = new Map<string, FlowElement>();
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

        // Parameters are attached to the element, not the SubflowInfo, because the
        // generator resolves them by element name when emitting the validation method.
        element.flowName = flowName;
        element.inputParameters = this.parseParameters(element.rawData?.inputassignments);
        element.outputParameters = this.parseParameters(element.rawData?.outputassignments);

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

  // --- Flow-to-Apex conversion -------------------------------------------------
  // These are public because BulkifiedApexGenerator composes them when emitting
  // per-subflow validation methods. They translate parsed Flow constructs into
  // Apex fragments; they do not know about the surrounding class.

  /** Render a Flow decision's conditions as an Apex boolean expression. */
  convertDecisionToApex(decision: FlowDecision): string {
    const conditions = decision.conditions.map((cond) => {
      const leftValue = this.convertValueReference(cond.leftValue);
      const rightValue = this.convertValueReference(cond.rightValue);
      return `${leftValue} ${this.convertOperator(cond.operator)} ${rightValue}`;
    });
    return conditions.join(` ${decision.logicType.toLowerCase()} `);
  }

  /** A dotted Flow reference (Loop_over_Loans.Field__c) becomes a record field read. */
  private convertValueReference(value: string): string {
    if (value.includes('.')) {
      const [, field] = value.split('.');
      return `record.get('${field}')`;
    }
    return value;
  }

  private convertOperator(operator: string): string {
    const operatorMap: Record<string, string> = {
      EqualTo: '==',
      NotEqualTo: '!=',
      GreaterThan: '>',
      LessThan: '<',
      GreaterThanOrEqualTo: '>=',
      LessThanOrEqualTo: '<=',
      Contains: 'contains',
      IsNull: '== null',
      IsNotNull: '!= null',
    };
    return operatorMap[operator] || '==';
  }

  convertAssignmentToApex(assignment: FlowAssignment): string {
    const value = this.convertValueReference(assignment.value);
    const variable = assignment.variable;

    if (assignment.isCollection) {
      switch (assignment.operator) {
        case 'Add': return `${variable}.add(${value});`;
        case 'RemoveFirst': return `if (!${variable}.isEmpty()) { ${variable}.remove(0); }`;
        case 'RemoveAll': return `${variable}.clear();`;
        default: return `${variable} = ${value};`;
      }
    }

    switch (assignment.operator) {
      case 'Assign': return `${variable} = ${value};`;
      case 'Add': return `${variable} += ${value};`;
      case 'Subtract': return `${variable} -= ${value};`;
      case 'Multiply': return `${variable} *= ${value};`;
      case 'Divide': return `${variable} /= ${value};`;
      default: return `${variable} = ${value};`;
    }
  }

  /**
   * DML inside a Flow loop becomes a collection add, never a DML statement — that is
   * the whole point of the conversion, so the caller can issue one DML after the loop.
   */
  convertDMLToApex(dml: FlowDMLOperation): string {
    let code = '';

    if (dml.conditions && dml.conditions.length > 0) {
      const conditions = dml.conditions
        .map((cond) => {
          const leftValue = this.convertValueReference(cond.leftValue);
          const rightValue = this.convertValueReference(cond.rightValue);
          return `${leftValue} ${this.convertOperator(cond.operator)} ${rightValue}`;
        })
        .join(' && ');
      code += `if (${conditions}) {\n`;
    }

    switch (dml.type) {
      case 'insert': code += `recordsToInsert.add(record);`; break;
      case 'update': code += `recordsToUpdate.add(record);`; break;
      case 'delete': code += `recordsToDelete.add(record);`; break;
      case 'upsert': code += `recordsToUpdate.add(record);`; break;
    }

    if (dml.conditions && dml.conditions.length > 0) {
      code += '\n}';
    }
    return code;
  }

  /** Emit the block that surfaces a subflow's validation output onto the record. */
  processSubflowOutputs(element: FlowElement): string {
    if (!element.outputParameters) return '';

    const validationMsgOutputs = element.outputParameters.filter(
      (p) =>
        p.name.toLowerCase().includes('validationmessage') ||
        p.name.toLowerCase().includes('errormessage')
    );
    if (validationMsgOutputs.length === 0) return '';

    let code = `
        // Process validation messages
        if (!result.isValid) {
          ValidationResult subflowResult = new ValidationResult();
          subflowResult.isValid = false;
      `;

    for (const output of validationMsgOutputs) {
      if (!output.fieldMapping) continue;
      switch (output.fieldMapping.sourceField.toLowerCase()) {
        case 'message': code += `subflowResult.message = result.message;\n`; break;
        case 'solution': code += `subflowResult.solution = result.solution;\n`; break;
        case 'fieldname': code += `subflowResult.fieldName = result.fieldName;\n`; break;
        case 'recordid': code += `subflowResult.recordId = result.recordId;\n`; break;
        case 'recordname': code += `subflowResult.recordName = result.recordName;\n`; break;
      }
    }

    code += `
          handleValidationError(record, subflowResult);
          return result;
        }
      `;
    return code;
  }

  // --- Parameter parsing -------------------------------------------------------

  private parseParameters(assignments: any): FlowParameter[] {
    if (!assignments) return [];
    const params = Array.isArray(assignments) ? assignments : [assignments];
    return params.map((param: any) => ({
      name: param.name || param.n,
      dataType: this.inferDataType(param),
      value: this.extractValue(param.value),
      elementReference: param.value?.elementreference,
      fieldMapping: this.extractFieldMapping(param),
    }));
  }

  /** Loop_over_Loans.LLC_BI__Amount__c -> { sourceField: LLC_BI__Amount__c, ... } */
  private extractFieldMapping(param: any): FlowFieldMapping | undefined {
    const reference: string | undefined = param.value?.elementreference;
    if (!reference) return undefined;

    const parts = reference.split('.');
    if (parts.length !== 2) return undefined;

    return {
      sourceField: parts[1],
      targetField: param.name || param.n,
      dataType: this.inferFieldType(parts[1]),
      isCollection: false,
      objectType: this.inferObjectType(parts[0]),
    };
  }

  /**
   * Field type inferred from naming convention, because the Flow XML does not carry
   * the target field's type. A wrong guess produces an Apex cast that will not
   * compile, which is the intended failure mode: loud, at compile time, not silent.
   */
  private inferFieldType(fieldName: string): string {
    if (fieldName === 'Id') return 'Id';
    if (fieldName === 'Name') return 'String';
    if (fieldName.endsWith('Id')) return 'Id';
    if (fieldName.includes('Amount')) return 'Decimal';
    if (fieldName.includes('Date')) return 'Date';
    if (fieldName.includes('Is_') || fieldName.includes('Is')) return 'Boolean';
    return 'String';
  }

  private inferObjectType(variableName: string): string {
    if (variableName.includes('Loan')) return 'LLC_BI__Loan__c';
    if (variableName.includes('Account')) return 'Account';
    if (variableName.includes('Contact')) return 'Contact';
    if (variableName.includes('Opportunity')) return 'Opportunity';
    return 'SObject';
  }

  private inferDataType(param: any): string {
    if (!param.value) return 'Object';
    if (param.value.elementreference) return 'Object';
    if (param.value.stringvalue !== undefined) return 'String';
    if (param.value.numbervalue !== undefined) return 'Decimal';
    if (param.value.booleanvalue !== undefined) return 'Boolean';
    if (param.value.datevalue !== undefined) return 'Date';
    if (param.value.datetimevalue !== undefined) return 'Datetime';
    return 'Object';
  }

  private extractValue(valueContainer: any): string | undefined {
    if (!valueContainer) return undefined;
    if (valueContainer.stringvalue !== undefined) return valueContainer.stringvalue;
    if (valueContainer.numbervalue !== undefined) return String(valueContainer.numbervalue);
    if (valueContainer.booleanvalue !== undefined) return String(valueContainer.booleanvalue);
    if (valueContainer.datevalue !== undefined) return valueContainer.datevalue;
    if (valueContainer.datetimevalue !== undefined) return valueContainer.datetimevalue;
    return undefined;
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