import { Connection } from 'jsforce';
import { FlowMetadata } from '../../types/elements';
import { XMLParser } from '../parsers/XMLParser';
import { Logger } from '../Logger';

export class MetadataFetcher {
  constructor(private connection: Connection | null) {}

  async getSubflowMetadata(flowName: string, requireActive: boolean = true, xmlContent?: string): Promise<FlowMetadata> {
    try {
      if (xmlContent) {
        return this.parseXMLContent(xmlContent);
      }

      if (!this.connection) {
        throw new Error('No connection available for fetching metadata');
      }

      const query = `
        SELECT Id, Metadata, VersionNumber, Status, LastModifiedDate 
        FROM Flow 
        WHERE DeveloperName = '${flowName}'
        ${requireActive ? "AND Status = 'Active'" : ""}
        ORDER BY VersionNumber DESC
      `;
      
      Logger.debug('MetadataFetcher', `Fetching metadata for flow: ${flowName}`, { query });
      const result = await this.connection.tooling.query(query);
      
      if (result.records.length === 0) {
        const errorMsg = requireActive 
          ? `Flow ${flowName} not found or not active`
          : `Flow ${flowName} not found`;
        Logger.warn('MetadataFetcher', errorMsg);
        throw new Error(errorMsg);
      }

      const flow = result.records[0];
      Logger.info('MetadataFetcher', `Found flow: ${flowName}`, {
        version: flow.VersionNumber,
        status: flow.Status,
        lastModified: flow.LastModifiedDate
      });
      
      return {
        ...flow.Metadata,
        _flowVersion: {
          version: flow.VersionNumber,
          status: flow.Status,
          lastModified: flow.LastModifiedDate
        }
      };
    } catch (error: any) {
      Logger.error('MetadataFetcher', `Failed to fetch metadata for flow: ${flowName}`, error);
      throw new Error(`Failed to fetch metadata: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private parseXMLContent(xml: string): FlowMetadata {
    try {
      // Parse XML content to flow metadata format
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, 'application/xml');
      
      if (!doc.documentElement) {
        throw new Error('Invalid XML content');
      }

      const xmlNode = XMLParser.parseToXMLNode({
        _flowVersion: {
          version: '1.0',
          status: 'Active',
          lastModified: new Date().toISOString()
        }
      } as FlowMetadata);

      return XMLParser.parseToFlowMetadata(xmlNode);
    } catch (error: any) {
      Logger.error('MetadataFetcher', 'Failed to parse XML content', error);
      throw new Error(`Failed to parse XML: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}