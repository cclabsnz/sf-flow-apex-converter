import Handlebars from 'handlebars';
import { FlowElementType } from './FlowAnalyzer.js';
export class ApexGenerator {
    constructor(schemaManager, subflowManager) {
        this.schemaManager = schemaManager;
        this.subflowManager = subflowManager;
        this.registerHandlebarsHelpers();
    }
    async generateBulkifiedClass(config) {
        const template = this.getMainClassTemplate();
        const context = await this.buildContext(config);
        const compiledTemplate = Handlebars.compile(template);
        return compiledTemplate(context);
    }
    registerHandlebarsHelpers() {
        Handlebars.registerHelper('mapFlowTypeToApex', (dataType, isCollection) => {
            const typeMap = {
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
    async buildContext(config) {
        const { className, flowAnalysis, bulkThreshold, preserveStructure } = config;
        const elementsByType = new Map();
        flowAnalysis.elements.forEach(element => {
            if (!elementsByType.has(element.type)) {
                elementsByType.set(element.type, []);
            }
            elementsByType.get(element.type).push(element);
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
    generateCollectionVariables(analysis) {
        const variables = [];
        analysis.objectDependencies.forEach(objectType => {
            variables.push(`private List<${objectType}> ${objectType.toLowerCase()}sToCreate = new List<${objectType}>();`);
            variables.push(`private List<${objectType}> ${objectType.toLowerCase()}sToUpdate = new List<${objectType}>();`);
            variables.push(`private List<${objectType}> ${objectType.toLowerCase()}sToDelete = new List<${objectType}>();`);
            variables.push(`private Map<Id, ${objectType}> ${objectType.toLowerCase()}Map = new Map<Id, ${objectType}>();`);
        });
        return variables;
    }
    generateProcessingMethods(analysis, elementsByType) {
        const methods = [];
        elementsByType.forEach((elements, type) => {
            elements.forEach((element, index) => {
                methods.push(this.generateElementMethod(element, type, index));
            });
        });
        return methods;
    }
    generateElementMethod(element, type, index) {
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
    generateRecordCreateCode(element) {
        const objectType = element.properties.object;
        let code = `    ${objectType} newRecord = new ${objectType}();\n`;
        if (element.properties.inputAssignments) {
            element.properties.inputAssignments.forEach((assignment) => {
                code += `    newRecord.${assignment.field} = ${this.generateValueReference(assignment.value)};\n`;
            });
        }
        code += `    ${objectType.toLowerCase()}sToCreate.add(newRecord);\n`;
        return code;
    }
    generateRecordUpdateCode(element) {
        const objectType = element.properties.object;
        let code = `    ${objectType} updateRecord = new ${objectType}();\n`;
        code += `    updateRecord.Id = (Id)record.get('Id');\n`;
        if (element.properties.inputAssignments) {
            element.properties.inputAssignments.forEach((assignment) => {
                code += `    updateRecord.${assignment.field} = ${this.generateValueReference(assignment.value)};\n`;
            });
        }
        code += `    ${objectType.toLowerCase()}sToUpdate.add(updateRecord);\n`;
        return code;
    }
    generateRecordDeleteCode(element) {
        const objectType = element.properties.object;
        return `    ${objectType.toLowerCase()}sToDelete.add((${objectType})record);\n`;
    }
    generateRecordLookupCode(element) {
        return '    // Record lookups are handled in bulk query method\n';
    }
    generateDecisionCode(element) {
        let code = '    Boolean result = false;\n';
        if (element.connectors) {
            element.connectors.forEach((connector, index) => {
                if (connector.conditions) {
                    const conditions = connector.conditions.map(cond => this.generateCondition(cond)).join(' && ');
                    code += `    ${index > 0 ? 'else ' : ''}if (${conditions}) {\n`;
                    code += '        result = true;\n';
                    code += '    }\n';
                }
            });
        }
        return code;
    }
    generateCondition(condition) {
        const left = condition.leftValueReference;
        const operator = this.mapOperator(condition.operator);
        const right = this.generateValueReference(condition.rightValue);
        return `${left} ${operator} ${right}`;
    }
    mapOperator(operator) {
        const operatorMap = {
            'EqualTo': '==',
            'NotEqualTo': '!=',
            'GreaterThan': '>',
            'LessThan': '<',
            'GreaterThanOrEqualTo': '>=',
            'LessThanOrEqualTo': '<='
        };
        return operatorMap[operator] || '==';
    }
    generateValueReference(value) {
        if (!value)
            return 'null';
        if (value.stringValue !== undefined)
            return `'${value.stringValue}'`;
        if (value.numberValue !== undefined)
            return value.numberValue.toString();
        if (value.booleanValue !== undefined)
            return value.booleanValue.toString();
        return 'null';
    }
    generateBulkOperations(analysis) {
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
    getMainClassTemplate() {
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
//# sourceMappingURL=ApexGenerator.js.map