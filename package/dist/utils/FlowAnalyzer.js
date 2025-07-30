export var FlowElementType;
(function (FlowElementType) {
    FlowElementType["RECORD_CREATE"] = "recordCreates";
    FlowElementType["RECORD_UPDATE"] = "recordUpdates";
    FlowElementType["RECORD_DELETE"] = "recordDeletes";
    FlowElementType["RECORD_LOOKUP"] = "recordLookups";
    FlowElementType["RECORD_ROLLBACK"] = "recordRollbacks";
    FlowElementType["ASSIGNMENT"] = "assignments";
    FlowElementType["DECISION"] = "decisions";
    FlowElementType["LOOP"] = "loops";
    FlowElementType["SUBFLOW"] = "subflows";
    FlowElementType["SCREEN"] = "screens";
})(FlowElementType || (FlowElementType = {}));
export class FlowAnalyzer {
    constructor(connection, schemaManager, subflowManager) {
        this.connection = connection;
        this.schemaManager = schemaManager;
        this.subflowManager = subflowManager;
    }
    async analyzeFlowComprehensive(flowMetadata) {
        const metadata = flowMetadata.metadata;
        const analysis = {
            flowName: flowMetadata.definition.DeveloperName,
            processType: flowMetadata.definition.ProcessType || 'Flow',
            totalElements: 0,
            dmlOperations: 0,
            soqlQueries: 0,
            bulkificationScore: 100,
            elements: new Map(),
            objectDependencies: new Set(),
            recommendations: []
        };
        await this.parseAllElements(metadata, analysis);
        this.calculateMetrics(analysis);
        this.generateRecommendations(analysis);
        return analysis;
    }
    async parseAllElements(metadata, analysis) {
        for (const elementType of Object.values(FlowElementType)) {
            if (metadata[elementType]) {
                const elements = Array.isArray(metadata[elementType])
                    ? metadata[elementType]
                    : [metadata[elementType]];
                analysis.totalElements += elements.length;
                if (elementType === FlowElementType.RECORD_CREATE ||
                    elementType === FlowElementType.RECORD_UPDATE ||
                    elementType === FlowElementType.RECORD_DELETE) {
                    analysis.dmlOperations += elements.length;
                }
                if (elementType === FlowElementType.RECORD_LOOKUP) {
                    analysis.soqlQueries += elements.length;
                }
                elements.forEach(element => {
                    const flowElement = {
                        type: elementType,
                        name: element.name?.[0] || 'Unnamed',
                        properties: this.parseProperties(element),
                        connectors: this.parseConnectors(element)
                    };
                    analysis.elements.set(flowElement.name, flowElement);
                    if (element.object) {
                        analysis.objectDependencies.add(element.object[0]);
                    }
                });
            }
        }
    }
    parseProperties(element) {
        const properties = {};
        Object.keys(element).forEach(key => {
            if (key !== 'name' && key !== 'connector' && element[key]) {
                properties[key] = Array.isArray(element[key]) ? element[key][0] : element[key];
            }
        });
        return properties;
    }
    parseConnectors(element) {
        if (!element.connector)
            return [];
        const connectors = Array.isArray(element.connector)
            ? element.connector
            : [element.connector];
        return connectors.map((conn) => ({
            targetReference: conn.targetReference?.[0] || '',
            conditionLogic: conn.conditionLogic?.[0],
            conditions: this.parseConditions(conn.conditions)
        }));
    }
    parseConditions(conditions) {
        if (!conditions)
            return [];
        const condArray = Array.isArray(conditions) ? conditions : [conditions];
        return condArray.map(cond => ({
            leftValueReference: cond.leftValueReference?.[0] || '',
            operator: cond.operator?.[0] || '',
            rightValue: cond.rightValue?.[0] ? {
                stringValue: cond.rightValue[0].stringValue?.[0],
                numberValue: cond.rightValue[0].numberValue?.[0] ?
                    parseFloat(cond.rightValue[0].numberValue[0]) : undefined,
                booleanValue: cond.rightValue[0].booleanValue?.[0] === 'true'
            } : undefined
        }));
    }
    calculateMetrics(analysis) {
        let score = 100;
        // Penalize for DML operations
        score -= Math.max(0, analysis.dmlOperations - 1) * 10;
        // Penalize for SOQL queries
        score -= Math.max(0, analysis.soqlQueries - 1) * 5;
        // Check for operations in loops
        analysis.elements.forEach(element => {
            if (element.type === FlowElementType.LOOP) {
                const hasNestedDML = this.hasNestedOperation(element, analysis, [FlowElementType.RECORD_CREATE, FlowElementType.RECORD_UPDATE, FlowElementType.RECORD_DELETE]);
                const hasNestedSOQL = this.hasNestedOperation(element, analysis, [FlowElementType.RECORD_LOOKUP]);
                if (hasNestedDML)
                    score -= 30;
                if (hasNestedSOQL)
                    score -= 20;
            }
        });
        analysis.bulkificationScore = Math.max(0, score);
    }
    hasNestedOperation(element, analysis, operationTypes) {
        const visited = new Set();
        const checkElement = (elementName) => {
            if (visited.has(elementName))
                return false;
            visited.add(elementName);
            const currentElement = analysis.elements.get(elementName);
            if (!currentElement)
                return false;
            if (operationTypes.includes(currentElement.type))
                return true;
            return currentElement.connectors.some(conn => conn.targetReference && checkElement(conn.targetReference));
        };
        return element.connectors.some(conn => conn.targetReference && checkElement(conn.targetReference));
    }
    generateRecommendations(analysis) {
        if (analysis.bulkificationScore < 70) {
            analysis.recommendations.push('Critical: Flow requires significant bulkification');
        }
        analysis.elements.forEach(element => {
            if (element.type === FlowElementType.LOOP) {
                const hasNestedDML = this.hasNestedOperation(element, analysis, [FlowElementType.RECORD_CREATE, FlowElementType.RECORD_UPDATE, FlowElementType.RECORD_DELETE]);
                const hasNestedSOQL = this.hasNestedOperation(element, analysis, [FlowElementType.RECORD_LOOKUP]);
                if (hasNestedDML) {
                    analysis.recommendations.push(`Move DML operations outside of loop in element: ${element.name}`);
                }
                if (hasNestedSOQL) {
                    analysis.recommendations.push(`Move SOQL queries outside of loop in element: ${element.name}`);
                }
            }
        });
        if (analysis.dmlOperations > 1) {
            analysis.recommendations.push('Consider consolidating multiple DML operations');
        }
        if (analysis.soqlQueries > 1) {
            analysis.recommendations.push('Consider combining SOQL queries where possible');
        }
    }
}
//# sourceMappingURL=FlowAnalyzer.js.map