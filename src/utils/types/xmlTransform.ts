import { XMLNode, XMLArray } from './XMLNode';
import { FlowMetadata } from '../../types/elements';

export function transformToXML(metadata: Record<string, unknown>): XMLNode {
  const xml: XMLNode = {};
  
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined) continue;
    
    if (Array.isArray(value)) {
      xml[key] = value as XMLArray<string | number | boolean | XMLNode>;
    } else if (typeof value === 'object') {
      xml[key] = transformToXML(value as Record<string, unknown>);
    } else {
      xml[key] = [String(value)] as XMLArray<string>;
    }
  }
  
  return xml;
}

export function isFlowMetadata(value: unknown): value is FlowMetadata {
  if (!value || typeof value !== 'object') return false;
  
  const meta = value as Record<string, unknown>;
  return '_flowVersion' in meta &&
    typeof meta._flowVersion === 'object' &&
    meta._flowVersion !== null &&
    'version' in meta._flowVersion &&
    'status' in meta._flowVersion &&
    'lastModified' in meta._flowVersion;
}