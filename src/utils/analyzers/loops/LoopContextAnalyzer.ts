import { FlowMetadata } from '../../interfaces/SubflowTypes.js';
import { LoopContext } from '../../interfaces/FlowTypes.js';
import { Logger } from '../../Logger.js';

export class LoopContextAnalyzer {
  analyzeLoopContext(metadata: FlowMetadata): Map<string, LoopContext> {
    const loopContexts = new Map<string, LoopContext>();
    
    if (!metadata.loops) return loopContexts;
    
    const loops = Array.isArray(metadata.loops) ? metadata.loops : [metadata.loops];
    
    for (const loop of loops) {
      const loopName = loop.name?.[0] || 'UnnamedLoop';
      
      if (loop.connector) {
        const connectors = Array.isArray(loop.connector) ? loop.connector : [loop.connector];
        for (const connector of connectors) {
          if (connector.targetReference) {
            const targetRef = connector.targetReference[0];
            loopContexts.set(targetRef, {
              isInLoop: true,
              loopReferenceName: loopName,
              depth: 1
            });
            Logger.debug('LoopContextAnalyzer', `Element ${targetRef} is inside loop ${loopName}`);
          }
        }
      }
    }
    
    return loopContexts;
  }
}