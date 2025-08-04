import { FlowMetadata, FlowElement, FlowElementType } from '../../types/elements';
import { FlowNode } from '../../types/analysis';
import { ApexClassStructure, ApexMethod, ApexInnerClass } from '../../types/apex';
import { StringBuilder } from './utils/StringBuilder';

export interface FlowTestCase {
  name: string;
  inputs: Record<string, any>;
  expectedOutputs: Record<string, any>;
  expectedDML: {
    operation: string;
    object: string;
    records: any[];
  }[];
}

export interface FlowExecutionPath {
  elements: FlowElement[];
  conditions: string[];
  variables: Set<string>;
  dmlOperations: Set<string>;
}

export class FlowParityVerifier {
private testCases: FlowTestCase[] = [];
  private executionPaths: FlowExecutionPath[] = [];
  private stateTransitions: Map<string, Set<string>> = new Map();
  private subflowsInLoop: Set<string> = new Set();
  private soqlInLoop: Map<string, number> = new Map();
  
  constructor(private flowMetadata: FlowMetadata) {
    this.analyzeFlow();
  }

  private analyzeFlow() {
    // Build execution graph
    this.buildExecutionGraph();
    
    // Generate test cases for each path
    this.generateTestCases();
    
    // Analyze state transitions
    this.analyzeStateTransitions();
  }

  private buildExecutionGraph() {
    const graph = new Map<string, FlowElement[]>();
    const visited = new Set<string>();
    this.subflowsInLoop.clear();
    this.soqlInLoop.clear();
    
    // Start from each start element
    const startElements = Array.isArray(this.flowMetadata.elements) ?
      this.flowMetadata.elements.filter(e => 
        e.type === FlowElementType.START || e.type === FlowElementType.TRIGGER
      ) : [];

    for (const start of startElements) {
      this.traverseFlow(start, graph, visited, []);
    }
  }

  private traverseFlow(
    element: FlowElement,
    graph: Map<string, FlowElement[]>,
    visited: Set<string>,
    currentPath: FlowElement[],
    inLoop: boolean = false
  ) {
    if (visited.has(element.id)) {
      // We've found a cycle, store the path
      this.executionPaths.push({
        elements: [...currentPath],
        conditions: this.extractConditions(currentPath),
        variables: this.extractVariables(currentPath),
        dmlOperations: this.extractDMLOperations(currentPath)
      });
      return;
    }

    visited.add(element.id);
    currentPath.push(element);

    // Track subflows and SOQL in loops
    if (inLoop || element.type === FlowElementType.LOOP) {
      if (element.type === FlowElementType.SUBFLOW) {
        this.subflowsInLoop.add(element.flowName || 'Unknown Subflow');
      }
      if (element.type === FlowElementType.RECORD_LOOKUP) {
        const queryKey = `${element.object || 'Unknown'}: ${element.conditions?.length || 0} conditions`;
        this.soqlInLoop.set(queryKey, (this.soqlInLoop.get(queryKey) || 0) + 1);
      }
    }

    // Get next elements based on connectors
    const nextElements = this.getNextElements(element);
    
    if (nextElements.length === 0) {
      // End of path, store it
      this.executionPaths.push({
        elements: [...currentPath],
        conditions: this.extractConditions(currentPath),
        variables: this.extractVariables(currentPath),
        dmlOperations: this.extractDMLOperations(currentPath)
      });
    } else {
      for (const next of nextElements) {
        this.traverseFlow(
          next,
          graph,
          new Set(visited),
          [...currentPath],
          inLoop || element.type === FlowElementType.LOOP
        );
      }
    }
  }

  private generateTestCases() {
    for (const path of this.executionPaths) {
      const testCase = this.generateTestForPath(path);
      this.testCases.push(testCase);
    }
  }

  private generateTestForPath(path: FlowExecutionPath): FlowTestCase {
    const inputs: Record<string, any> = {};
    const outputs: Record<string, any> = {};
    const dmlOps: { operation: string; object: string; records: any[]; }[] = [];

    // Generate minimal input values to satisfy conditions
    for (const condition of path.conditions) {
      const requiredInputs = this.analyzeConditionRequirements(condition);
      Object.assign(inputs, requiredInputs);
    }

    // Add required inputs for DML operations
    for (const dml of path.dmlOperations) {
      const dmlRequirements = this.analyzeDMLRequirements(dml);
      dmlOps.push(dmlRequirements);
    }

    // Determine expected outputs
    for (const element of path.elements) {
      if (element.type === FlowElementType.ASSIGNMENT && element.outputReference && element.outputReference in outputs) {
        outputs[element.outputReference] = this.evaluateAssignment(element, inputs);
      }
    }

    return {
      name: `Test_${this.generatePathSignature(path)}`,
      inputs,
      expectedOutputs: outputs,
      expectedDML: dmlOps
    };
  }

  private analyzeStateTransitions() {
    for (const path of this.executionPaths) {
      let previousState = 'START';
      
      for (const element of path.elements) {
        const currentState = this.determineElementState(element);
        
        if (!this.stateTransitions.has(previousState)) {
          this.stateTransitions.set(previousState, new Set());
        }
        
        this.stateTransitions.get(previousState)!.add(currentState);
        previousState = currentState;
      }
    }
  }

  generateAnalysisSummary(): string {
    const summary = new StringBuilder();

    // Add subflows in loops section
    if (this.subflowsInLoop.size > 0) {
      summary.appendLine('\nSubflows Called in Loops:');
      Array.from(this.subflowsInLoop).forEach(subflow => {
        summary.appendLine(`  - ${subflow}`);
      });
    }

    // Add SOQL in loops section
    if (this.soqlInLoop.size > 0) {
      summary.appendLine('\nSOQL Queries in Loops:');
      Array.from(this.soqlInLoop.entries()).forEach(([query, count]) => {
        summary.appendLine(`  - ${query} (called ${count} times)`);
      });
    }

    // Add performance recommendations if needed
    if (this.subflowsInLoop.size > 0 || this.soqlInLoop.size > 0) {
      summary.appendLine('\nPerformance Recommendations:');
      if (this.subflowsInLoop.size > 0) {
        summary.appendLine('  - Consider bulkifying subflow calls to avoid governor limits');
      }
      if (this.soqlInLoop.size > 0) {
        summary.appendLine('  - Bulkify SOQL queries by collecting IDs and using IN clauses');
      }
    }

    return summary.toString();
  }

  generateApexClass(): string {
    const className = Array.isArray(this.flowMetadata.name) 
      ? this.flowMetadata.name[0]?.replace(/[^a-zA-Z0-9]/g, '_') || 'UnknownFlow'
      : (this.flowMetadata.name || 'UnknownFlow').toString().replace(/[^a-zA-Z0-9]/g, '_');
    const apex = new StringBuilder();
    
    // Generate class header with required annotations
    apex.appendLine(`public with sharing class ${className} {`);
    
    // Generate state enum if needed
    if (this.stateTransitions.size > 0) {
      apex.appendLine(this.generateStateEnum());
    }
    
    // Generate input/output wrapper classes
    apex.appendLine(this.generateWrapperClasses());
    
    // Generate main execution method
    apex.appendLine(this.generateExecuteMethod());
    
    // Generate helper methods for each state
    for (const state of this.stateTransitions.keys()) {
      apex.appendLine(this.generateStateHandler(state));
    }
    
    // Generate validation methods
    apex.appendLine(this.generateValidationMethods());
    
    apex.appendLine('}');
    
    return apex.toString();
  }

  generateTestClass(): string {
    const className = Array.isArray(this.flowMetadata.name)
      ? this.flowMetadata.name[0]?.replace(/[^a-zA-Z0-9]/g, '_') || 'UnknownFlow'
      : (this.flowMetadata.name || 'UnknownFlow').toString().replace(/[^a-zA-Z0-9]/g, '_');
    const testClass = new StringBuilder();
    
    testClass.appendLine(`@isTest`);
    testClass.appendLine(`private class ${className}Test {`);
    
    // Generate test setup if needed
    if (this.hasSharedSetup()) {
      testClass.appendLine(this.generateTestSetup());
    }
    
    // Generate a test method for each test case
    for (const testCase of this.testCases) {
      testClass.appendLine(this.generateTestMethod(testCase));
    }
    
    // Generate negative test cases
    testClass.appendLine(this.generateNegativeTests());
    
    testClass.appendLine('}');
    
    return testClass.toString();
  }

  private generateTestMethod(testCase: FlowTestCase): string {
    const method = new StringBuilder();
    
    method.appendLine(`@isTest`);
    method.appendLine(`static void ${testCase.name}() {`);
    
    // Setup test data
    method.appendLine(this.generateTestDataSetup(testCase));
    
    // Execute flow
    const flowClassName = Array.isArray(this.flowMetadata.name)
      ? this.flowMetadata.name[0]?.replace(/[^a-zA-Z0-9]/g, '_') || 'UnknownFlow'
      : (this.flowMetadata.name || 'UnknownFlow').toString().replace(/[^a-zA-Z0-9]/g, '_');
    method.appendLine(`${flowClassName} flow = new ${flowClassName}();`);
    method.appendLine(`FlowResult result = flow.execute(input);`);
    
    // Assert expected outputs
    method.appendLine(this.generateAssertions(testCase));
    
    method.appendLine('}');
    
    return method.toString();
  }

  private generateAssertions(testCase: FlowTestCase): string {
    const assertions = new StringBuilder();
    
    // Assert outputs
    for (const [key, value] of Object.entries(testCase.expectedOutputs)) {
      assertions.appendLine(`System.assertEquals(${value}, result.${key}, 'Unexpected value for ${key}');`);
    }
    
    // Assert DML operations
    if (testCase.expectedDML.length > 0) {
      assertions.appendLine(this.generateDMLAssertions(testCase.expectedDML));
    }
    
    return assertions.toString();
  }

  // Helper methods...
  private extractConditions(path: FlowElement[]): string[] {
    return path
      .filter(e => e.type === FlowElementType.DECISION)
      .map(e => e.conditions)
      .flat();
  }

  private extractVariables(path: FlowElement[]): Set<string> {
    const variables = new Set<string>();
    path.forEach(element => {
      // Add input variables
      if (element.inputReferences) {
        element.inputReferences.forEach(ref => variables.add(ref));
      }
      // Add output variables
      if (element.outputReference) {
        variables.add(element.outputReference);
      }
    });
    return variables;
  }

private extractDMLOperations(path: FlowElement[]): Set<string> {
    return new Set(
      path
        .filter(e => [FlowElementType.RECORD_CREATE, FlowElementType.RECORD_UPDATE, FlowElementType.RECORD_DELETE].includes(e.type))
        .map(e => `${e.type}_${e.object}`)
    );
  }

  private getNextElements(element: FlowElement): FlowElement[] {
    const nextElements: FlowElement[] = [];
    if (!element.connectors) return nextElements;

    element.connectors.forEach(connector => {
      const targetElement = this.findElementByRef(connector.targetReference);
      if (targetElement) nextElements.push(targetElement);
    });

    return nextElements;
  }

  private findElementByRef(reference: string): FlowElement | undefined {
    return Array.isArray(this.flowMetadata.elements) ?
      this.flowMetadata.elements.find(e => e.name === reference) :
      undefined;
  }

  private determineElementState(element: FlowElement): string {
    switch (element.type) {
      case FlowElementType.DECISION:
        return 'DECISION_STATE';
      case FlowElementType.ASSIGNMENT:
        return 'ASSIGNMENT_STATE';
      case FlowElementType.RECORD_CREATE:
      case FlowElementType.RECORD_UPDATE:
      case FlowElementType.RECORD_DELETE:
        return 'DML_STATE';
      case FlowElementType.LOOP:
        return 'LOOP_STATE';
      case FlowElementType.SUBFLOW:
        return 'SUBFLOW_STATE';
      default:
        return 'PROCESSING_STATE';
    }
  }

  private generatePathSignature(path: FlowExecutionPath): string {
    return path.elements
      .map(e => e.name)
      .join('_')
      .replace(/[^a-zA-Z0-9]/g, '_');
  }

  private analyzeConditionRequirements(condition: any): Record<string, any> {
    // Implement condition analysis logic
    return {};
  }

  private analyzeDMLRequirements(dml: string): any {
    // Implement DML requirements analysis
    return {
      operation: dml.split('_')[1],
      object: dml.split('_')[2],
      records: []
    };
  }

  private evaluateAssignment(element: FlowElement, inputs: Record<string, any>): any {
    // Implement assignment evaluation logic
    return null;
  }

  private hasSharedSetup(): boolean {
    // Check if there are shared setup requirements across test cases
    return this.testCases.some(tc => tc.expectedDML.length > 0);
  }

  private generateStateEnum(): string {
    const states = Array.from(this.stateTransitions.keys());
    const enumLines = states.map(state => `        ${state},`);
    return `    public enum FlowState {
${enumLines.join('\n')}
    }`;
  }

  private generateWrapperClasses(): string {
    return `
    public class FlowInput {
        // Add input fields
    }

    public class FlowOutput {
        // Add output fields
    }`;
  }

  private generateExecuteMethod(): string {
    return `
    public FlowOutput execute(FlowInput input) {
        // Validate input
        validateInput(input);

        // Initialize state
        FlowState currentState = FlowState.START;
        FlowOutput output = new FlowOutput();

        // Execute state machine
        while (currentState != FlowState.END) {
            currentState = processState(currentState, input, output);
        }

        return output;
    }`;
  }

  private generateStateHandler(state: string): string {
    return `
    private FlowState handle${state}(FlowInput input, FlowOutput output) {
        // Add state handling logic
        return FlowState.END;
    }`;
  }

  private generateValidationMethods(): string {
    return `
    private void validateInput(FlowInput input) {
        if (input == null) {
            throw new FlowException('Input cannot be null');
        }
        // Add input validation
    }`;
  }

  private generateTestSetup(): string {
    return `
    @TestSetup
    static void setup() {
        // Add shared test setup
    }`;
  }

  private generateTestDataSetup(testCase: FlowTestCase): string {
    // Generate test data setup code
    return '';
  }

  private generateDMLAssertions(dmlOps: any[]): string {
    return dmlOps.map(op => `
        System.assert([SELECT Id FROM ${op.object} LIMIT 1].size() > 0,
            'Expected ${op.operation} operation on ${op.object}');`).join('\n');
  }

  private generateNegativeTests(): string {
    return `
    @isTest
    static void testNullInput() {
        FlowInput input = null;
        try {
            new Flow().execute(input);
            System.assert(false, 'Expected exception for null input');
        } catch (Exception e) {
            System.assert(e.getMessage().contains('Input cannot be null'));
        }
    }`;
  }
}
