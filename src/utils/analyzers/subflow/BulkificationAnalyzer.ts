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
        soqlMessage += ' (detected in: loop recordLookups';
        if (metadata.loops) {
          const loops = Array.isArray(metadata.loops) ? metadata.loops : [metadata.loops];
          for (const loop of loops) {
            if (loop.elements) {
              const elements = Array.isArray(loop.elements) ? loop.elements : [loop.elements];
              for (const element of elements) {
                if ((element as any).actionCall || (Array.isArray((element as any).type) && (element as any).type[0] === 'ActionCall')) {
                  soqlMessage += ', Apex actions';
                  break;
                }
                if ((element as any).subflow || (Array.isArray((element as any).type) && (element as any).type[0] === 'Subflow')) {
                  soqlMessage += ', subflows';
                  break;
                }
              }
            }
          }
        }
        soqlMessage += ')';
      }
      reasons.push(soqlMessage);
    }
    if (complexity > 5) reasons.push(`High complexity score: ${complexity}`);
    if (metadata.loops) reasons.push('Contains loops');
    
    return reasons.length > 0 
      ? reasons.join(', ')
      : 'Simple subflow - bulkification not required';
  }
}