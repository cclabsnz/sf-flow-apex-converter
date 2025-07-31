import { XMLNode } from './XMLNode';
import { FlowMetadata } from '../../types/elements';

export function fromXML(node: XMLNode): FlowMetadata {
  const metadata: Record<string, unknown> = {
    _flowVersion: node._flowVersion || {
      version: '1.0',
      status: 'Active',
      lastModified: new Date().toISOString()
    }
  };
  
  for (const [key, value] of Object.entries(node)) {
    if (value === undefined || key === '_flowVersion') continue;
    
    metadata[key] = Array.isArray(value)
      ? value.map(v => typeof v === 'object' ? fromXML(v as XMLNode) : v)
      : typeof value === 'object'
        ? fromXML(value as XMLNode)
        : value;
  }
  
  return metadata as FlowMetadata;
}