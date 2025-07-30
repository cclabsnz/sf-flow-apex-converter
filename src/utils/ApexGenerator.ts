import Handlebars from 'handlebars';
import { SchemaManager } from './SchemaManager.js';
import { SubflowManager } from './SubflowManager.js';
import { ComprehensiveFlowAnalysis, FlowElement, FlowElementType } from './FlowAnalyzer.js';

export interface ApexGenerationConfig {
  className: string;
  flowAnalysis: ComprehensiveFlowAnalysis;
  bulkThreshold: number;
  preserveStructure: boolean;
}

export class ApexGenerator {
  constructor(
    private schemaManager: SchemaManager,
    private subflowManager: SubflowManager
  ) {
    this.registerHandlebarsHelpers();
  }

  async generateBulkifiedClass(config: ApexGenerationConfig): Promise<string> {
    const template = this.getMainClassTemplate();
    const context = await this.buildContext(config);
    
    const compiledTemplate = Handlebars.compile(template);
    return compiledTemplate(context);
  }

  private registerHandlebarsHelpers(): void {
    Handlebars.registerHelper('mapFlowTypeToApex', (dataType: string, isCollection: boolean) => {
      const typeMap: Record<string, string> = {
        'String': 'String',
        'Boolean': 'Boolean',
        'Number': 'Decimal',
        'Currency': 'Decimal',
        'Date': 'Date',
        'DateTime': 'Datetime',
        'SObject': 'SObject'
      };
      
      const apexType = typeMap[dataType] || 'Object';
      return isCollection ? `List<${apexType}>` : apexType;
    });
  }

  private async buildContext(config: ApexGenerationConfig): Promise<any> {
    const { className, flowAnalysis, bulkThreshold, preserveStructure } = config;
    
    const elementsByType = new Map<FlowElementType, FlowElement[]>();
    flowAnalysis.elements.forEach(element => {
      if (!elementsByType.has(element.type)) {
        elementsByType.set(element.type, []);
      }
      elementsByType.get(element.type)!.push(element);
    });

    return {
      className,
      bulkThreshold,
      flowAnalysis,
      elementsByType,
      collectionVariables: this.generateCollectionVariables(flowAnalysis),
      processingMethods: this.generateProcessingMethods(flowAnalysis, elementsByType),
      bulkOperations: this.generateBulkOperations(flowAnalysis)
    };
  }

  private generateCollectionVariables(analysis: ComprehensiveFlowAnalysis): string[] {
    const variables: string[] = [];
    
    analysis.objectDependencies.forEach(objectType => {
      variables.push(`private List<${objectType}> ${objectType.toLowerCase()}sToCreate = new List<${objectType}>();`);
      variables.push(`private List<${objectType}> ${objectType.toLowerCase()}sToUpdate = new List<${objectType}>();`);
      variables.push(`private List<${objectType}> ${objectType.toLowerCase()}sToDelete = new List<${objectType}>();`);
      variables.push(`private Map<Id, ${objectType}> ${objectType.toLowerCase()}Map = new Map<Id, ${objectType}>();`);
    });
    
    return variables;
  }

  private generateProcessingMethods(
    analysis: ComprehensiveFlowAnalysis,
    elementsByType: Map<FlowElementType, FlowElement[]>
  ): string[] {
    const methods: string[] = [];
    
    elementsByType.forEach((elements, type) => {
      elements.forEach((element, index) => {
        methods.push(this.generateElementMethod(element, type, index));
      });
    });
    
    return methods;
  }

  private generateElementMethod(element: FlowElement, type: FlowElementType, index: number): string {
    const methodName = `process${type}${element.name}${index}`;
    let code = `private void ${methodName}(SObject record) {\n`;
    
    switch (type) {
      case FlowElementType.RECORD_CREATE:
        code += this.generateRecordCreateCode(element);
        break;
      case FlowElementType.RECORD_UPDATE:
        code += this.generateRecordUpdateCode(element);
        break;
      case FlowElementType.RECORD_DELETE:
        code += this.generateRecordDeleteCode(element);
        break;
      case FlowElementType.RECORD_LOOKUP:
        code += this.generateRecordLookupCode(element);
        break;
      case FlowElementType.DECISION:
        code += this.generateDecisionCode(element);
        break;
      default:
        code += '    // TODO: Implement ' + type + ' logic\n';
    }
    
    code += '}\n';
    return code;
  }

  private generateRecordCreateCode(element: FlowElement): string {
    const objectType = element.properties.object;
    let code = `    ${objectType} newRecord = new ${objectType}();\n`;
    
    if (element.properties.inputAssignments) {
      element.properties.inputAssignments.forEach((assignment: any) => {
        code += `    newRecord.${assignment.field} = ${this.generateValueReference(assignment.value)};\n`;
      });
    }
    
    code += `    ${objectType.toLowerCase()}sToCreate.add(newRecord);\n`;
    return code;
  }

  private generateRecordUpdateCode(element: FlowElement): string {
    const objectType = element.properties.object;
    let code = `    ${objectType} updateRecord = new ${objectType}();\n`;
    code += `    updateRecord.Id = (Id)record.get('Id');\n`;
    
    if (element.properties.inputAssignments) {
      element.properties.inputAssignments.forEach((assignment: any) => {
        code += `    updateRecord.${assignment.field} = ${this.generateValueReference(assignment.value)};\n`;
      });
    }
    
    code += `    ${objectType.toLowerCase()}sToUpdate.add(updateRecord);\n`;
    return code;
  }

  private generateRecordDeleteCode(element: FlowElement): string {
    const objectType = element.properties.object;
    return `    ${objectType.toLowerCase()}sToDelete.add((${objectType})record);\n`;
  }

  private generateRecordLookupCode(element: FlowElement): string {
    return '    // Record lookups are handled in bulk query method\n';
  }

  private generateDecisionCode(element: FlowElement): string {
    let code = '    Boolean result = false;\n';
    
    if (element.connectors) {
      element.connectors.forEach((connector, index) => {
        if (connector.conditions) {
          const conditions = connector.conditions.map(cond => 
            this.generateCondition(cond)
          ).join(' && ');
          
          code += `    ${index > 0 ? 'else ' : ''}if (${conditions}) {\n`;
          code += '        result = true;\n';
          code += '    }\n';
        }
      });
    }
    
    return code;
  }

  private generateCondition(condition: any): string {
    const left = condition.leftValueReference;
    const operator = this.mapOperator(condition.operator);
    const right = this.generateValueReference(condition.rightValue);
    return `${left} ${operator} ${right}`;
  }

  private mapOperator(operator: string): string {
    const operatorMap: Record<string, string> = {
      'EqualTo': '==',
      'NotEqualTo': '!=',
      'GreaterThan': '>',
      'LessThan': '<',
      'GreaterThanOrEqualTo': '>=',
      'LessThanOrEqualTo': '<='
    };
    return operatorMap[operator] || '==';
  }

  private generateValueReference(value: any): string {
    if (!value) return 'null';
    if (value.stringValue !== undefined) return `'${value.stringValue}'`;
    if (value.numberValue !== undefined) return value.numberValue.toString();
    if (value.booleanValue !== undefined) return value.booleanValue.toString();
    return 'null';
  }

  private generateBulkOperations(analysis: ComprehensiveFlowAnalysis): string {
    let code = '    try {\n';
    
    analysis.objectDependencies.forEach(objectType => {
      code += `        // ${objectType} operations\n`;
      code += `        if (!${objectType.toLowerCase()}sToCreate.isEmpty()) {\n`;
      code += `            insert ${objectType.toLowerCase()}sToCreate;\n`;
      code += `        }\n`;
      code += `        if (!${objectType.toLowerCase()}sToUpdate.isEmpty()) {\n`;
      code += `            update ${objectType.toLowerCase()}sToUpdate;\n`;
      code += `        }\n`;
      code += `        if (!${objectType.toLowerCase()}sToDelete.isEmpty()) {\n`;
      code += `            delete ${objectType.toLowerCase()}sToDelete;\n`;
      code += `        }\n`;
    });
    
    code += '    } catch (Exception e) {\n';
    code += '        throw new FlowConversionException(\'Bulk operation failed: \' + e.getMessage());\n';
    code += '    }\n';
    
    return code;
  }

  private getMainClassTemplate(): string {
    return `/**
 * Bulkified Apex class generated from Flow: {{flowAnalysis.flowName}}
 * Bulkification Score: {{flowAnalysis.bulkificationScore}}/100
 */
public class {{className}} {
    
    private static final Integer BULK_THRESHOLD = {{bulkThreshold}};
    
    // Collection variables for bulk operations
    {{#each collectionVariables}}
    {{this}}
    {{/each}}
    
    /**
     * Process records in bulk
     */
    public void process(List<SObject> records) {
        if (records == null || records.isEmpty()) return;
        
        try {
            // Process each record (accumulate operations)
            for (SObject record : records) {
                processRecord(record);
            }
            
            // Execute bulk operations
            executeBulkOperations();
            
        } catch (Exception e) {
            throw new FlowConversionException(e.getMessage());
        }
    }
    
    private void processRecord(SObject record) {
        {{#each processingMethods}}
        {{this}}
        {{/each}}
    }
    
    private void executeBulkOperations() {
        {{bulkOperations}}
    }
    
    public class FlowConversionException extends Exception {}
}`;
  }
}