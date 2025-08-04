import { FlowMetadata, FlowElement } from '../interfaces/types';

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
    
    // Start from each start element
    const startElements = this.flowMetadata.elements.filter(e => 
      e.type === 'START' || e.type === 'TRIGGER'
    );

    for (const start of startElements) {
      this.traverseFlow(start, graph, visited, []);
    }
  }

  private traverseFlow(
    element: FlowElement,
    graph: Map<string, FlowElement[]>,
    visited: Set<string>,
    currentPath: FlowElement[]
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
        this.traverseFlow(next, graph, new Set(visited), [...currentPath]);
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
      if (element.type === 'ASSIGNMENT') {
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

  generateApexClass(): string {
    const className = this.flowMetadata.name.replace(/[^a-zA-Z0-9]/g, '_');
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
    const className = this.flowMetadata.name.replace(/[^a-zA-Z0-9]/g, '_');
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
    method.appendLine(`${this.flowMetadata.name} flow = new ${this.flowMetadata.name}();`);
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
      .filter(e => e.type === 'DECISION')
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
        .filter(e => ['RECORD_CREATE', 'RECORD_UPDATE', 'RECORD_DELETE'].includes(e.type))
        .map(e => `${e.type}_${e.object}`)
    );
  }
}
