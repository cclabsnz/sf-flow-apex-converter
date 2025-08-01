import { Logger } from '../Logger.js';
import { MetadataParser } from '../parsers/MetadataParser.js';
import { FlowMetadata } from '../interfaces/types.js';
import { Connection } from 'jsforce';

export class OrgMetadataFetcher {
  constructor(private connection: Connection) {}

  private getXMLValue<T>(value: unknown[] | unknown): T | undefined {
    if (Array.isArray(value) && value.length > 0) {
      return value[0] as T;
    }
    return undefined;
  }

  async fetchFlowFromOrg(flowName: string): Promise<any> {
    try {
      Logger.info('OrgMetadataFetcher', `Fetching flow ${flowName} from org`);
      
      const flowResult = await this.connection.tooling.query(`SELECT Id, Metadata FROM Flow WHERE DeveloperName = '${flowName}' AND Status = 'Active'`);

      if (!flowResult.records || flowResult.records.length === 0) {
        throw new Error(`Flow with name "${flowName}" not found in the org.`);
      }

      const flow: any = flowResult.records[0];
      const flowMetadata = flow.Metadata;
      const processType = this.getXMLValue<string>(flowMetadata?.processType);
      
      return {
        Metadata: flowMetadata,
        definition: {
          DeveloperName: flowName,
          ProcessType: processType || 'Flow'
        }
      };
      
    } catch (error) {
      Logger.error('OrgMetadataFetcher', `Failed to fetch flow from org: ${(error as Error).message}`, error);
      throw error;
    }
  }
}