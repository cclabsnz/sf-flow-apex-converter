import { XMLNode, XMLArray, XMLFlowVersion } from '../types/XMLNode';
import { FlowMetadata } from '../../types/elements';
import { Logger } from '../Logger';

type XMLNodeMetadata = XMLNode & {
  _flowVersion: XMLFlowVersion;
};

export class XMLParser {
  static parseToXMLNode(metadata: FlowMetadata): XMLNodeMetadata {
    const xmlNode: XMLNodeMetadata = {
      _flowVersion: metadata._flowVersion
    } as XMLNodeMetadata;
    
    for (const [key, value] of Object.entries(metadata)) {
      if (value === undefined || key === '_flowVersion') continue;
      
      if (Array.isArray(value)) {
        xmlNode[key] = value;
      } else if (value && typeof value === 'object') {
        xmlNode[key] = this.parseToXMLNode(value as FlowMetadata);
      } else {
        xmlNode[key] = [String(value)];
      }
    }
    
    return xmlNode;
  }

  static parseToFlowMetadata(xmlNode: XMLNodeMetadata): FlowMetadata {
    const metadata: any = {
      _flowVersion: xmlNode._flowVersion || {
        version: '1.0',
        status: 'Active',
        lastModified: new Date().toISOString()
      }
    };
    
    for (const [key, value] of Object.entries(xmlNode)) {
      if (value === undefined || key === '_flowVersion') continue;
      
      if (Array.isArray(value)) {
        metadata[key] = value;
      } else if (value && typeof value === 'object') {
        metadata[key] = this.parseToFlowMetadata(value as XMLNodeMetadata);
      }
    }
    
    return metadata;
  }
}