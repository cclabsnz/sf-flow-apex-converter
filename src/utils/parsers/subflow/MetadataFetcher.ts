import { Connection } from 'jsforce';
import { Logger } from '../../Logger.js';
import { FlowMetadata } from '../../interfaces/SubflowTypes.js';
import { MetadataParser } from '../MetadataParser.js';

export class MetadataFetcher {
  constructor(private connection: Connection | null) {}

  async getSubflowMetadata(subflowName: string, requireActive: boolean = true, xmlContent?: string): Promise<FlowMetadata> {
    if (xmlContent) {
      Logger.debug('MetadataFetcher', `Parsing provided metadata for flow: ${subflowName}`);
      const parsedMetadata = await MetadataParser.parseMetadata(xmlContent);
      return {
        ...parsedMetadata as object,
        _flowVersion: {
          version: '1',
          status: 'Active',
          lastModified: new Date().toISOString()
        }
      } as FlowMetadata;
    }

    if (!this.connection) {
      Logger.debug('MetadataFetcher', `No connection and no XML for subflow: ${subflowName}, returning empty metadata`);
      return {
        apiVersion: ['1.0'],
        _flowVersion: {
          version: '1',
          status: 'Unknown',
          lastModified: new Date().toISOString()
        }
      } as FlowMetadata;
    }

    const query = `
      SELECT Id, Metadata, VersionNumber, Status, LastModifiedDate 
      FROM Flow 
      WHERE DeveloperName = '${subflowName}'
      ${requireActive ? "AND Status = 'Active'" : ""}
      ORDER BY VersionNumber DESC
    `;
    
    Logger.debug('MetadataFetcher', `Fetching metadata for flow: ${subflowName}`, { query });
    const result = await this.connection.tooling.query(query);
    
    if (result.records.length === 0) {
      const errorMsg = requireActive 
        ? `Flow ${subflowName} not found or not active`
        : `Flow ${subflowName} not found`;
      Logger.warn('MetadataFetcher', errorMsg);
      throw new Error(errorMsg);
    }

    const flow = result.records[0];
    Logger.info('MetadataFetcher', `Found flow: ${subflowName}`, {
      version: flow.VersionNumber,
      status: flow.Status,
      lastModified: flow.LastModifiedDate
    });

    const parsedMetadata = await MetadataParser.parseMetadata(flow.Metadata);

    return {
      ...parsedMetadata as object,
      _flowVersion: {
        version: flow.VersionNumber,
        status: flow.Status,
        lastModified: flow.LastModifiedDate
      }
    } as FlowMetadata;
  }
}