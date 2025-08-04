import { FlowMetadata, FlowElement, FlowElementType } from '../interfaces/types';
import { FlowGraph, FlowState, ApexClassStructure, ApexMethod } from './types';
import { FlowGraphAnalyzer } from './FlowGraphAnalyzer';
import { FlowTestGenerator } from './FlowTestGenerator';

export class FlowToApexGenerator {
  private graphAnalyzer: FlowGraphAnalyzer;
  private testGenerator: FlowTestGenerator;
  private states: Map<string, FlowState>;
  
  constructor(
    private flowMetadata: FlowMetadata,
    private graph: FlowGraph
  ) {
    this.graphAnalyzer = new FlowGraphAnalyzer(graph);
    this.testGenerator = new FlowTestGenerator(flowMetadata, graph);
    this.states = this.graphAnalyzer.analyzeStateTransitions();
  }

  public generateApexImplementation(): { main: string; test: string } {
    // Generate test class first to drive the implementation
    const testClass = this.testGenerator.generateTestClass();
    
    // Generate the main implementation
    const mainClass = this.generateMainClass();
    
    return {
      main: mainClass,
      test: testClass
    };
  }

  private generateMainClass(): string {
    const structure = this.buildClassStructure();
    return this.renderApexClass(structure);
  }

  private buildClassStructure(): ApexClassStructure {
    const className = this.flowMetadata.name.replace(/[^a-zA-Z0-9]/g, '_');
    
    const structure: ApexClassStructure = {
      className,
      annotations: [],
      innerClasses: [
        this.generateInputWrapperClass(),
        this.generateOutputWrapperClass(),
        this.generateFlowException()
      ],
      methods: [
        this.generateExecuteMethod(),
        ...this.generateStateHandlers(),
        ...this.generateHelperMethods()
      ],
      properties: [
        {
          name: 'currentState',
          type: 'String',
          access: 'private',
          annotations: []
        },
        {
          name: 'flowInputs',
          type: 'Map<String, Object>',
          access: 'private',
          annotations: []
        },
        {
          name: 'flowOutputs',
          type: 'Map<String, Object>',
          access: 'private',
          annotations: []
        }
      ]
    };

    // Add state enum if needed
    if (this.states.size > 0) {
      structure.innerClasses.push(this.generateStateEnum());
    }

    return structure;
  }

  private generateInputWrapperClass(): ApexInnerClass {
    const properties = this.analyzeInputRequirements();
    
    return {
      name: 'FlowInput',
      properties: properties.map(prop => ({
        name: prop.name,
        type: prop.type,
        access: 'public',
        annotations: []
      })),
      methods: []
    };
  }

  private generateOutputWrapperClass(): ApexInnerClass {
    const properties = this.analyzeOutputRequirements();
    
    return {
      name: 'FlowOutput',
      properties: properties.map(prop => ({
        name: prop.name,
        type: prop.type,
        access: 'public',
        annotations: []
      })),
      methods: []
    };
  }

  private generateFlowException(): ApexInnerClass {
    return {
      name: 'FlowException',
      properties: [],
      methods: []
    };
  }

  private generateStateEnum(): ApexInnerClass {
    const states = Array.from(this.states.keys());
    
    return {
      name: 'FlowState',
      properties: states.map(state => ({
        name: state,
        type: '',
        access: '',
        annotations: []
      })),
      methods: []
    };
  }

  private generateExecuteMethod(): ApexMethod {
    return {
      name: 'execute',
      returnType: 'Map<String, Object>',
      parameters: [{
        name: 'inputs',
        type: 'Map<String, Object>'
      }],
      body: this.generateExecuteMethodBody(),
      annotations: [],
      access: 'public'
    };
  }

  private generateExecuteMethodBody(): string {
    let body = `
        // Validate inputs
        validateInputs(inputs);
        
        // Initialize state
        this.flowInputs = inputs;
        this.flowOutputs = new Map<String, Object>();
        this.currentState = 'START';
        
        // Execute state machine
        while (this.currentState != 'END') {
            processCurrentState();
        }
        
        // Validate outputs
        validateOutputs();
        
        return this.flowOutputs;
    `;
    
    return body;
  }

  private generateStateHandlers(): ApexMethod[] {
    const handlers: ApexMethod[] = [];
    
    this.states.forEach((state, stateName) => {
      handlers.push({
        name: `handle${stateName}State`,
        returnType: 'void',
        parameters: [],
        body: this.generateStateHandlerBody(state),
        annotations: [],
        access: 'private'
      });
    });
    
    return handlers;
  }

  private generateStateHandlerBody(state: FlowState): string {
    let body = '';
    
    // Add state validations
    state.validations.forEach(validation => {
      body += `
        // ${validation.type}: ${validation.message}
        if (!(${validation.condition})) {
            throw new FlowException('${validation.message}');
        }
      `;
    });
    
    // Add state transitions
    state.transitions.forEach(transition => {
      body += `
        if (${transition.condition}) {
          ${this.generateActionCode(transition.actions)}
          this.currentState = '${transition.toState}';
          return;
        }
      `;
    });
    
    return body;
  }

  private generateActionCode(actions: any[]): string {
    let code = '';
    
    actions.forEach(action => {
      switch (action.type) {
        case 'DML':
          code += this.generateDMLCode(action);
          break;
        case 'ASSIGNMENT':
          code += this.generateAssignmentCode(action);
          break;
        case 'SOQL':
          code += this.generateSOQLCode(action);
          break;
      }
    });
    
    return code;
  }

  private generateHelperMethods(): ApexMethod[] {
    return [
      {
        name: 'validateInputs',
        returnType: 'void',
        parameters: [{
          name: 'inputs',
          type: 'Map<String, Object>'
        }],
        body: this.generateInputValidation(),
        annotations: [],
        access: 'private'
      },
      {
        name: 'validateOutputs',
        returnType: 'void',
        parameters: [],
        body: this.generateOutputValidation(),
        annotations: [],
        access: 'private'
      },
      {
        name: 'processCurrentState',
        returnType: 'void',
        parameters: [],
        body: this.generateStateProcessor(),
        annotations: [],
        access: 'private'
      }
    ];
  }

  private renderApexClass(structure: ApexClassStructure): string {
    let apex = '';
    
    // Add class header
    apex += `public with sharing class ${structure.className} {\n`;
    
    // Add properties
    structure.properties.forEach(prop => {
      apex += `    ${prop.access} ${prop.type} ${prop.name};\n`;
    });
    
    // Add inner classes
    structure.innerClasses.forEach(innerClass => {
      apex += this.renderInnerClass(innerClass);
    });
    
    // Add methods
    structure.methods.forEach(method => {
      apex += this.renderMethod(method);
    });
    
    apex += '}\n';
    return apex;
  }

  private renderInnerClass(innerClass: ApexInnerClass): string {
    let code = `    public class ${innerClass.name} {\n`;
    
    innerClass.properties.forEach(prop => {
      code += `        ${prop.access} ${prop.type} ${prop.name};\n`;
    });
    
    code += '    }\n\n';
    return code;
  }

  private renderMethod(method: ApexMethod): string {
    const params = method.parameters
      .map(p => `${p.type} ${p.name}`)
      .join(', ');
    
    let code = `    ${method.access} ${method.returnType} ${method.name}(${params}) {\n`;
    code += `        ${method.body}\n`;
    code += '    }\n\n';
    
    return code;
  }

  // Helper methods
  private analyzeInputRequirements(): { name: string; type: string; }[] {
    const inputs: { name: string; type: string; }[] = [];
    
    this.graph.nodes.forEach(node => {
      node.inputRefs.forEach(ref => {
        if (!inputs.some(i => i.name === ref)) {
          inputs.push({
            name: ref,
            type: this.determineApexType(ref, node)
          });
        }
      });
    });
    
    return inputs;
  }

  private analyzeOutputRequirements(): { name: string; type: string; }[] {
    const outputs: { name: string; type: string; }[] = [];
    
    this.graph.nodes.forEach(node => {
      node.outputRefs.forEach(ref => {
        if (!outputs.some(o => o.name === ref)) {
          outputs.push({
            name: ref,
            type: this.determineApexType(ref, node)
          });
        }
      });
    });
    
    return outputs;
  }

  private determineApexType(reference: string, node: FlowNode): string {
    // This would need to be implemented based on your metadata format
    return 'Object';
  }

  private generateInputValidation(): string {
    return `
        if (inputs == null) {
            throw new FlowException('Inputs cannot be null');
        }
        
        // Validate required inputs
        Set<String> requiredInputs = new Set<String>{'input1', 'input2'}; // Replace with actual required inputs
        for (String required : requiredInputs) {
            if (!inputs.containsKey(required)) {
                throw new FlowException('Missing required input: ' + required);
            }
        }
    `;
  }

  private generateOutputValidation(): string {
    return `
        // Validate required outputs
        Set<String> requiredOutputs = new Set<String>{'output1', 'output2'}; // Replace with actual required outputs
        for (String required : requiredOutputs) {
            if (!this.flowOutputs.containsKey(required)) {
                throw new FlowException('Missing required output: ' + required);
            }
        }
    `;
  }

  private generateStateProcessor(): string {
    let code = 'switch on this.currentState {\n';
    
    this.states.forEach((_, stateName) => {
      code += `            when '${stateName}' {\n`;
      code += `                handle${stateName}State();\n`;
      code += '            }\n';
    });
    
    code += '        }';
    return code;
  }

  private generateDMLCode(action: any): string {
    return `
        // Perform ${action.operation} on ${action.object}
        ${action.object} record = new ${action.object}();
        // Set fields
        ${action.operation.toLowerCase()}(record);
    `;
  }

  private generateAssignmentCode(action: any): string {
    return `
        // Assign value to ${action.target}
        this.flowOutputs.put('${action.target}', ${action.value});
    `;
  }

  private generateSOQLCode(action: any): string {
    return `
        // Execute SOQL query
        List<${action.object}> records = [SELECT Id FROM ${action.object} WHERE /* Add conditions */];
    `;
  }
}
