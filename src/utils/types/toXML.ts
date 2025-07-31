import { XMLNode } from './XMLNode';
import { FlowMetadata } from '../../types/elements';

export function toXML(metadata: FlowMetadata): XMLNode {
  const xmlNode: XMLNode = {
    _flowVersion: metadata._flowVersion
  };
  
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined) continue;
    
    if (key === '_flowVersion') continue;
    
    xmlNode[key] = Array.isArray(value) 
      ? value.map(v => typeof v === 'object' ? toXML(v as FlowMetadata) : String(v)) 
      : typeof value === 'object' 
        ? toXML(value as FlowMetadata)
        : [String(value)];
  }
  
  return xmlNode;
}