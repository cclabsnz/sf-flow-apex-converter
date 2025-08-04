import { ComprehensiveFlowAnalysis, FlowElement, FlowElementType, FlowConnector } from '../../types';

export class RecommendationGenerator {
  private static hasNestedOperation(
    element: FlowElement, 
    analysis: ComprehensiveFlowAnalysis,
    operationTypes: FlowElementType[]
  ): boolean {
    const visited = new Set<string>();
    
    const checkElement = (elementName: string): boolean => {
      if (visited.has(elementName)) return false;
      visited.add(elementName);
      
      const currentElement = analysis.elements.get(elementName);
      if (!currentElement) return false;
      
      if (operationTypes.includes(currentElement.type)) return true;
      
      return (currentElement.connectors || []).some((conn: FlowConnector) => 
        conn.targetReference && checkElement(conn.targetReference)
      );
    };
    
    return (element.connectors || []).some((conn: FlowConnector) => 
      conn.targetReference && checkElement(conn.targetReference)
    );
  }

  static generateRecommendations(analysis: ComprehensiveFlowAnalysis): void {
    if (analysis.bulkificationScore < 70) {
      analysis.recommendations.push({
        shouldSplit: true,
        reason: 'Critical: Flow requires significant bulkification',
        suggestedClasses: ['BulkifiedFlow']
      });
    }
    
    analysis.elements.forEach(element => {
      if (element.type === FlowElementType.LOOP) {
        const hasNestedDML = this.hasNestedOperation(element, analysis, 
          [FlowElementType.RECORD_CREATE, FlowElementType.RECORD_UPDATE, FlowElementType.RECORD_DELETE]);
        const hasNestedSOQL = this.hasNestedOperation(element, analysis, 
          [FlowElementType.RECORD_LOOKUP]);
        
        if (hasNestedDML) {
          analysis.recommendations.push({
            shouldSplit: false,
            reason: `Move DML operations outside of loop in element: ${element.name}`,
            suggestedClasses: []
          });
        }
        if (hasNestedSOQL) {
          analysis.recommendations.push({
            shouldSplit: false,
            reason: `Move SOQL queries outside of loop in element: ${element.name}`,
            suggestedClasses: []
          });
        }
      }
    });
    
    if (analysis.dmlOperations > 1) {
      analysis.recommendations.push({
        shouldSplit: false,
        reason: 'Consider consolidating multiple DML operations',
        suggestedClasses: []
      });
    }
    
    if (analysis.soqlQueries > 1) {
      analysis.recommendations.push({
        shouldSplit: false,
        reason: 'Consider combining SOQL queries where possible',
        suggestedClasses: []
      });
    }
  }
}