import { FlowMetadata } from '../../interfaces/types.js';

export class BulkificationAnalyzer {
  static shouldBulkify(
    dmlOps: number, 
    soqlQueries: number, 
    complexity: number,
    metadata: FlowMetadata,
    soqlInLoop: boolean
  ): boolean {
    // Always bulkify if has DML or SOQL
    if (dmlOps > 0 || soqlQueries > 0) return true;
    
    // Bulkify if complex
    if (complexity > 5) return true;
    
    // Bulkify if has loops
    if (metadata.loops) return true;
    
    return false;
  }

  static getBulkificationReason(
    dmlOps: number,
    soqlQueries: number,
    complexity: number,
    metadata: FlowMetadata,
    soqlInLoop: boolean
  ): string {
    const reasons: string[] = [];
    
    if (dmlOps > 0) reasons.push(`Contains ${dmlOps} DML operation(s)`);
    if (soqlQueries > 0) {
      let soqlMessage = `Contains ${soqlQueries} SOQL queries`;
      if (soqlInLoop) {
        soqlMessage += ' (found in loop)';
      }
      reasons.push(soqlMessage);
    }
    if (complexity > 5) reasons.push(`High complexity score: ${complexity}`);
    
    if (metadata.loops) {
      const loops = Array.isArray(metadata.loops) ? metadata.loops : [metadata.loops];
      loops.forEach(loop => {
        if (loop.elements) {
          const elements = Array.isArray(loop.elements) ? loop.elements : [loop.elements];
          const subflows = elements.filter(element => {
            const elementType = Array.isArray((element as any).type) ? (element as any).type[0] : (element as any).type;
            return elementType === 'Subflow' || (element as any).subflow || (element as any).flowName;
          }).map(element => (element as any).flowName || 'Unnamed Subflow');
          
          if (subflows.length > 0) {
            reasons.push(`Contains subflow calls inside loop: ${subflows.join(', ')}`);
          }
        }
      });
    }
    
    if (reasons.length === 0) {
      return 'Simple subflow - bulkification not required';
    }

    return reasons.join('\n- ');
  }
}