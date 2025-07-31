import { Logger } from '../Logger.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MetadataParser } from '../parsers/MetadataParser.js';
import { FlowMetadata, FlowBaseType } from '../interfaces/types.js';

export class OrgMetadataFetcher {
  private getXMLValue<T>(value: unknown[] | unknown): T | undefined {
    if (Array.isArray(value) && value.length > 0) {
      return value[0] as T;
    }
    return undefined;
  }

  async getOrgInfo(targetOrg?: string): Promise<{alias: string; username: string; instanceUrl: string}> {
    try {
      let orgCmd = 'sf org display';
      if (targetOrg) {
        orgCmd += ` -o ${targetOrg}`;
        Logger.info('OrgMetadataFetcher', `Using specified org: ${targetOrg}`);
      }

      const orgDetails = execSync(`${orgCmd} --json`, { encoding: 'utf8' });
      const details = JSON.parse(orgDetails);
      
      return {
        alias: details.result.alias || 'Unknown',
        username: details.result.username,
        instanceUrl: details.result.instanceUrl
      };
    } catch (error) {
      Logger.error('OrgMetadataFetcher', 'Failed to get org info', error);
      throw new Error('Failed to get org info. Make sure you are logged in with "sf org login web"');
    }
  }

  async fetchFlowFromOrg(flowName: string, targetOrg?: string): Promise<any> {
    try {
      const orgInfo = await this.getOrgInfo(targetOrg);
      Logger.info('OrgMetadataFetcher', `Connected to org: ${orgInfo.alias} (${orgInfo.username})`);
      Logger.info('OrgMetadataFetcher', `Instance URL: ${orgInfo.instanceUrl}`);
      Logger.info('OrgMetadataFetcher', `Fetching flow ${flowName} from org`);
      
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-analysis-'));
      const manifestPath = path.join(tempDir, 'package.xml');
      
      const packageXml = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types>
        <members>${flowName}</members>
        <n>Flow</n>
    </types>
    <version>58.0</version>
</Package>`;
      
      fs.writeFileSync(manifestPath, packageXml);
      
      Logger.debug('OrgMetadataFetcher', 'Executing sf cli retrieve command');
      execSync(`sf project retrieve start -x "${manifestPath}"`, {
        stdio: 'inherit'
      });
      
      const flowPath = path.join('force-app', 'main', 'default', 'flows', `${flowName}.flow-meta.xml`);
      if (!fs.existsSync(flowPath)) {
        throw new Error(`Flow ${flowName} not found in org or not active`);
      }
      
      const flowContent = fs.readFileSync(flowPath, 'utf8');
      
      fs.rmSync(tempDir, { recursive: true, force: true });
      
      const parsedMetadata = await MetadataParser.parseMetadata(flowContent);
      const processType = this.getXMLValue<string>(parsedMetadata?.processType);
      
      return {
        Metadata: parsedMetadata,
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