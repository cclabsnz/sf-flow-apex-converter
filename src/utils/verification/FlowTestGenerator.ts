import { FlowMetadata, FlowElement, FlowElementType } from '../../types/elements';
import { FlowNode } from '../../types/analysis';
import { FlowGraph, FlowTestScenario, FlowTestSetup, SObjectSetup } from './types';
import { FlowGraphAnalyzer } from './FlowGraphAnalyzer';

export class FlowTestGenerator {
  private graphAnalyzer: FlowGraphAnalyzer;

  constructor(private flowMetadata: FlowMetadata, private graph: FlowGraph) {
    this.graphAnalyzer = new FlowGraphAnalyzer(graph);
  }

  public generateTestClass(): string {
    const className = this.flowMetadata.name.replace(/[^a-zA-Z0-9]/g, '_');
    const scenarios = this.generateTestScenarios();
    
    let testClass = `@isTest\nprivate class ${className}Test {\n`;
    
    // Add test data factory methods
    testClass += this.generateTestDataFactories();
    
    // Add utility methods
    testClass += this.generateUtilityMethods();
    
    // Generate a test method for each scenario
    scenarios.forEach(scenario => {
      testClass += this.generateTestMethod(scenario);
    });
    
    // Add negative test cases
    testClass += this.generateNegativeTests();
    
    testClass += '}\n';
    return testClass;
  }

  private generateTestScenarios(): FlowTestScenario[] {
    const scenarios: FlowTestScenario[] = [];
    
    // Get all execution paths
    const paths = this.graphAnalyzer.findAllPaths();
    
    // Generate scenarios for each path
    paths.forEach((path, index) => {
      const scenario = this.generateScenarioForPath(path, index);
      if (scenario) {
        scenarios.push(scenario);
      }
    });
    
    // Add special scenarios for critical paths
    const criticalPaths = this.graphAnalyzer.findCriticalPaths();
    criticalPaths.forEach((path, index) => {
      const scenario = this.generateCriticalPathScenario(path, index);
      if (scenario) {
        scenarios.push(scenario);
      }
    });
    
    return scenarios;
  }

  private generateScenarioForPath(path: string[], index: number): FlowTestScenario | null {
    const nodes = path.map(id => this.graph.nodes.get(id)!);
    
    // Extract input requirements
    const inputs = this.determineRequiredInputs(nodes);
    
    // Determine expected outputs
    const expectedOutputs = this.determineExpectedOutputs(nodes);
    
    // Determine required test data setup
    const setup = this.determineTestDataSetup(nodes);
    
    return {
      name: `testPath${index + 1}`,
      description: `Test execution path ${index + 1}`,
      setup,
      inputs,
      expectedState: {
        outputs: expectedOutputs,
        dmlOperations: this.determineDMLOperations(nodes)
      }
    };
  }

  private generateCriticalPathScenario(path: string[], index: number): FlowTestScenario | null {
    const scenario = this.generateScenarioForPath(path, index);
    if (!scenario) return null;

    // Enhance the scenario with boundary conditions
    return {
      ...scenario,
      name: `testCriticalPath${index + 1}`,
      description: `Test critical path ${index + 1} with boundary conditions`
    };
  }

  private determineRequiredInputs(nodes: FlowNode[]): Record<string, any> {
    const inputs: Record<string, any> = {};
    
    nodes.forEach(node => {
      if (node.type === 'DECISION') {
        // Extract decision requirements
        const conditions = node.metadata.conditions || [];
        conditions.forEach((condition: { name: string; value: any }) => {
          const requiredInputs = this.analyzeConditionRequirements(condition);
          Object.assign(inputs, requiredInputs);
        });
      }
      
      if (this.isDMLOperation(node)) {
        // Extract DML requirements
        const dmlInputs = this.analyzeDMLRequirements(node);
        Object.assign(inputs, dmlInputs);
      }
    });
    
    return inputs;
  }

  private determineExpectedOutputs(nodes: FlowNode[]): Record<string, any> {
    const outputs: Record<string, any> = {};
    
    nodes.forEach(node => {
      if (node.type === 'ASSIGNMENT') {
        const assignmentValue = this.evaluateAssignment(node);
        if (assignmentValue !== undefined) {
          outputs[node.outputRefs[0]] = assignmentValue;
        }
      }
    });
    
    return outputs;
  }

  private determineTestDataSetup(nodes: FlowNode[]): FlowTestSetup {
    const setup: FlowTestSetup = {
      sObjects: []
    };
    
    const requiredObjects = new Set<string>();
    
    nodes.forEach(node => {
      if (this.isDMLOperation(node)) {
        requiredObjects.add(node.metadata.object);
      }
      if (this.isSOQLQuery(node)) {
        requiredObjects.add(node.metadata.object);
      }
    });
    
    requiredObjects.forEach(objectType => {
      setup.sObjects.push(this.generateSObjectSetup(objectType));
    });
    
    return setup;
  }

  private generateSObjectSetup(objectType: string): SObjectSetup {
    return {
      objectType,
      records: [
        this.generateTestRecord(objectType)
      ]
    };
  }

  private generateTestRecord(objectType: string): Record<string, any> {
    // This would need to be customized based on your schema
    return {
      Name: `Test_${objectType}_${Date.now()}`,
      // Add other required fields based on object type
    };
  }

  private analyzeConditionRequirements(condition: any): Record<string, any> {
    // This would need to be implemented based on your condition format
    return {};
  }

  private analyzeDMLRequirements(node: FlowNode): Record<string, any> {
    // This would need to be implemented based on your DML operation format
    return {};
  }

  private evaluateAssignment(node: FlowNode): any {
    // This would need to be implemented based on your assignment format
    return undefined;
  }

  private generateTestDataFactories(): string {
    let code = '\n    // Test data factory methods\n';
    
    // Add factory methods for each object type
    const objectTypes = new Set<string>();
    this.graph.nodes.forEach(node => {
      if (this.isDMLOperation(node)) {
        objectTypes.add(node.metadata.object);
      }
    });
    
    objectTypes.forEach(objectType => {
      code += this.generateFactoryMethod(objectType);
    });
    
    return code;
  }

  private generateFactoryMethod(objectType: string): string {
    return `
    private static ${objectType} create${objectType}(Map<String, Object> overrides) {
        ${objectType} record = new ${objectType}(
            Name = 'Test_${objectType}_' + DateTime.now().getTime()
            // Add other required fields
        );
        
        // Apply any overrides
        for (String field : overrides.keySet()) {
            record.put(field, overrides.get(field));
        }
        
        return record;
    }
    `;
  }

  private generateUtilityMethods(): string {
    return `
    private static void assertExpectedOutputs(Map<String, Object> expected, Map<String, Object> actual) {
        System.assertEquals(expected.size(), actual.size(), 'Mismatched number of outputs');
        for (String key : expected.keySet()) {
            System.assertEquals(expected.get(key), actual.get(key), 
                'Mismatched value for output: ' + key);
        }
    }
    
    private static void assertDMLOperations(List<Database.SaveResult> results) {
        for (Database.SaveResult result : results) {
            System.assert(result.isSuccess(), 
                'DML operation failed: ' + result.getErrors()[0].getMessage());
        }
    }
    `;
  }

  private generateTestMethod(scenario: FlowTestScenario): string {
    return `
    @isTest
    static void ${scenario.name}() {
        // Setup test data
        ${this.generateTestDataSetup(scenario)}
        
        // Setup input data
        ${this.generateInputSetup(scenario)}
        
        // Execute flow
        Test.startTest();
        ${this.flowMetadata.name} flow = new ${this.flowMetadata.name}();
        Map<String, Object> result = flow.execute(inputs);
        Test.stopTest();
        
        // Verify results
        ${this.generateAssertions(scenario)}
    }
    `;
  }

  private generateTestDataSetup(scenario: FlowTestScenario): string {
    let setup = '';
    
    scenario.setup.sObjects.forEach(sObjectSetup => {
      setup += `
        List<${sObjectSetup.objectType}> test${sObjectSetup.objectType}s = new List<${sObjectSetup.objectType}>();
        for (Integer i = 0; i < ${sObjectSetup.records.length}; i++) {
            test${sObjectSetup.objectType}s.add(
                create${sObjectSetup.objectType}(
                    new Map<String, Object>${JSON.stringify(sObjectSetup.records[0])}
                )
            );
        }
        insert test${sObjectSetup.objectType}s;
      `;
    });
    
    return setup;
  }

  private generateInputSetup(scenario: FlowTestScenario): string {
    return `
        Map<String, Object> inputs = new Map<String, Object>${JSON.stringify(scenario.inputs)};
    `;
  }

  private generateAssertions(scenario: FlowTestScenario): string {
    let assertions = 'Map<String, Object> expectedOutputs = new Map<String, Object>';
    assertions += JSON.stringify(scenario.expectedState.outputs);
    assertions += ';\n        assertExpectedOutputs(expectedOutputs, result);';
    
    // Add DML operation assertions if needed
    if (scenario.expectedState.dmlOperations.length > 0) {
      assertions += '\n        // Verify DML operations\n';
      scenario.expectedState.dmlOperations.forEach(operation => {
        assertions += `        System.assert([SELECT Id FROM ${operation.sObject} WHERE /* Add conditions */].size() > 0, 'Expected ${operation.operation} operation on ${operation.sObject}');\n`;
      });
    }
    
    return assertions;
  }

  private generateNegativeTests(): string {
    let tests = '\n    // Negative test cases\n';
    
    // Test null inputs
    tests += `
    @isTest
    static void testNullInputs() {
        ${this.flowMetadata.name} flow = new ${this.flowMetadata.name}();
        try {
            flow.execute(null);
            System.assert(false, 'Expected exception for null inputs');
        } catch (Exception e) {
            System.assert(e.getMessage().contains('Required input'), 
                'Expected validation error message');
        }
    }
    `;
    
    // Test invalid inputs
    tests += `
    @isTest
    static void testInvalidInputs() {
        ${this.flowMetadata.name} flow = new ${this.flowMetadata.name}();
        Map<String, Object> invalidInputs = new Map<String, Object>{
            'InvalidField' => 'InvalidValue'
        };
        try {
            flow.execute(invalidInputs);
            System.assert(false, 'Expected exception for invalid inputs');
        } catch (Exception e) {
            System.assert(e.getMessage().contains('Invalid input'), 
                'Expected validation error message');
        }
    }
    `;
    
    return tests;
  }

  private isDMLOperation(node: FlowNode): boolean {
    return ['RECORD_CREATE', 'RECORD_UPDATE', 'RECORD_DELETE'].includes(node.type);
  }

  private isSOQLQuery(node: FlowNode): boolean {
    return node.type === 'RECORD_LOOKUP';
  }

  private determineDMLOperations(nodes: FlowNode[]): any[] {
    const operations: any[] = [];
    
    nodes.forEach(node => {
      if (this.isDMLOperation(node)) {
        operations.push({
          operation: node.type.replace('RECORD_', '').toLowerCase(),
          sObject: node.metadata.object,
          records: []  // This would need to be populated based on your requirements
        });
      }
    });
    
    return operations;
  }
}
