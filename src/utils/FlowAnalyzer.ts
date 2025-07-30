import { Connection } from 'jsforce';
import { parseStringPromise } from 'xml2js';
import { SchemaManager } from './SchemaManager.js';
import { SubflowManager } from './SubflowManager.js';
import { Logger } from './Logger.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export enum FlowElementType {
  RECORD_CREATE = 'recordCreates',
  RECORD_UPDATE = 'recordUpdates',
  RECORD_DELETE = 'recordDeletes',
  RECORD_LOOKUP = 'recordLookups',
  RECORD_ROLLBACK = 'recordRollbacks',
  ASSIGNMENT = 'assignments',
  DECISION = 'decisions',
  LOOP = 'loops',
  SUBFLOW = 'subflows',
  SCREEN = 'screens'
}

export interface FlowElement {
  type: FlowElementType;
  name: string;
  properties: Record<string, any>;
  connectors: FlowConnector[];
}

export interface FlowConnector {
  targetReference: string;
  conditionLogic?: string;
  conditions?: FlowCondition[];
}

export interface FlowCondition {
  leftValueReference: string;
  operator: string;
  rightValue?: {
    stringValue?: string;
    numberValue?: number;
    booleanValue?: boolean;
  };
}

export interface SecurityContext {
  isSystemMode: boolean;
  enforceObjectPermissions: boolean;
  enforceFieldPermissions: boolean;
  enforceSharingRules: boolean;
  requiredPermissions: Set<string>;
  requiredObjects: Set<string>;
  requiredFields: Map<string, Set<string>>;
}

export interface ComprehensiveFlowAnalysis {
  flowName: string;
  processType: string;
  totalElements: number;
  dmlOperations: number;
  soqlQueries: number;
  bulkificationScore: number;
  elements: Map<string, FlowElement>;
  objectDependencies: Set<string>;
  recommendations: string[];
  securityContext: SecurityContext;
  apiVersion: string;
}

export class FlowAnalyzer {
  private analyzeSecurityContext(metadata: any): SecurityContext {
    const securityContext: SecurityContext = {
      isSystemMode: metadata.runInMode?.[0] === 'SYSTEM' || false,
      enforceObjectPermissions: metadata.runInMode?.[0] === 'USER' || false,
      enforceFieldPermissions: metadata.runInMode?.[0] === 'USER' || false,
      enforceSharingRules: metadata.runInMode?.[0] === 'USER' || false,
      requiredPermissions: new Set<string>(),
      requiredObjects: new Set<string>(),
      requiredFields: new Map<string, Set<string>>()
    };

    // Analyze required permissions from each element
    for (const elementType of Object.values(FlowElementType)) {
      if (metadata[elementType]) {
        const elements = Array.isArray(metadata[elementType]) ? metadata[elementType] : [metadata[elementType]];
        
        elements.forEach((element: any) => {
          // Object permissions
          if (element.object?.[0]) {
            const objectName = element.object[0];
            securityContext.requiredObjects.add(objectName);

            // Add CRUD permissions based on operation type
            if (elementType === FlowElementType.RECORD_CREATE) {
              securityContext.requiredPermissions.add(`Create_${objectName}`);
            }
            if (elementType === FlowElementType.RECORD_UPDATE) {
              securityContext.requiredPermissions.add(`Edit_${objectName}`);
            }
            if (elementType === FlowElementType.RECORD_DELETE) {
              securityContext.requiredPermissions.add(`Delete_${objectName}`);
            }
            if (elementType === FlowElementType.RECORD_LOOKUP) {
              securityContext.requiredPermissions.add(`Read_${objectName}`);
            }
          }

          // Field permissions
          if (element.fields) {
            const objectName = element.object?.[0];
            if (objectName) {
              const fields = new Set<string>();
              element.fields.forEach((field: any) => {
                fields.add(field);
              });
              securityContext.requiredFields.set(objectName, fields);
            }
          }
        });
      }
    }

    return securityContext;
  }
  private async getOrgInfo(targetOrg?: string): Promise<{alias: string; username: string; instanceUrl: string}> {
    try {
      // Get current default org
      let orgCmd = 'sf org display';
      if (targetOrg) {
        orgCmd += ` -o ${targetOrg}`;
        Logger.info('FlowAnalyzer', `Using specified org: ${targetOrg}`);
      }

      // Get detailed org info
      const orgDetails = execSync(`${orgCmd} --json`, { encoding: 'utf8' });
      const details = JSON.parse(orgDetails);
      
      return {
        alias: details.result.alias || 'Unknown',
        username: details.result.username,
        instanceUrl: details.result.instanceUrl
      };
    } catch (error) {
      Logger.error('FlowAnalyzer', 'Failed to get org info', error);
      throw new Error('Failed to get org info. Make sure you are logged in with "sf org login web"');
    }
  }

  private async fetchFlowFromOrg(flowName: string, targetOrg?: string): Promise<any> {
    try {
      // Get org info first
      const orgInfo = await this.getOrgInfo(targetOrg);
      Logger.info('FlowAnalyzer', `Connected to org: ${orgInfo.alias} (${orgInfo.username})`);
      Logger.info('FlowAnalyzer', `Instance URL: ${orgInfo.instanceUrl}`);
      Logger.info('FlowAnalyzer', `Fetching flow ${flowName} from org`);
      
      // Create temp directory
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-analysis-'));
      const manifestPath = path.join(tempDir, 'package.xml');
      
      // Create package.xml
      const packageXml = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types>
        <members>${flowName}</members>
        <name>Flow</name>
    </types>
    <version>58.0</version>
</Package>`;
      
      fs.writeFileSync(manifestPath, packageXml);
      
      // Retrieve flow using sf cli
      Logger.debug('FlowAnalyzer', 'Executing sf cli retrieve command');
      execSync(`sf project retrieve start -x "${manifestPath}"`, {
        stdio: 'inherit'
      });
      
      // Read the retrieved flow
      const flowPath = path.join('force-app', 'main', 'default', 'flows', `${flowName}.flow-meta.xml`);
      if (!fs.existsSync(flowPath)) {
        throw new Error(`Flow ${flowName} not found in org or not active`);
      }
      
      const flowContent = fs.readFileSync(flowPath, 'utf8');
      
      // Clean up
      fs.rmSync(tempDir, { recursive: true, force: true });
      
      // Parse XML
      const flowMetadata = await parseStringPromise(flowContent);
      return flowMetadata;
      
    } catch (error) {
      Logger.error('FlowAnalyzer', `Failed to fetch flow from org: ${(error as Error).message}`, error);
      throw error;
    }
  }
  constructor(
    private connection: Connection,
    private schemaManager: SchemaManager,
    private subflowManager: SubflowManager
  ) {}

  async analyzeFlowFromOrg(flowName: string, targetOrg?: string): Promise<ComprehensiveFlowAnalysis> {
    const flowMetadata = await this.fetchFlowFromOrg(flowName, targetOrg);
    return this.analyzeFlowComprehensive(flowMetadata);
  }

  async analyzeFlowComprehensive(flowMetadata: any): Promise<ComprehensiveFlowAnalysis> {
    Logger.info('FlowAnalyzer', 'Starting flow analysis');
    Logger.debug('FlowAnalyzer', 'Flow metadata received', flowMetadata);

    const metadata = flowMetadata.Metadata || flowMetadata.metadata;
    if (!metadata) {
      Logger.error('FlowAnalyzer', 'Invalid metadata structure', flowMetadata);
      throw new Error('Invalid flow metadata structure');
    }
    
    const analysis: ComprehensiveFlowAnalysis = {
      flowName: flowMetadata.definition.DeveloperName,
      processType: flowMetadata.definition.ProcessType || 'Flow',
      totalElements: 0,
      dmlOperations: 0,
      soqlQueries: 0,
      bulkificationScore: 100,
      elements: new Map(),
      objectDependencies: new Set(),
      recommendations: [],
      securityContext: this.analyzeSecurityContext(metadata),
      apiVersion: metadata.apiVersion?.[0] || '58.0'
    };

    try {
      Logger.info('FlowAnalyzer', 'Parsing flow elements');
      await this.parseAllElements(metadata, analysis);

      Logger.info('FlowAnalyzer', 'Calculating metrics');
      this.calculateMetrics(analysis);

      Logger.info('FlowAnalyzer', 'Generating recommendations');
      this.generateRecommendations(analysis);

      Logger.info('FlowAnalyzer', 'Analysis complete', {
        flowName: analysis.flowName,
        totalElements: analysis.totalElements,
        dmlOperations: analysis.dmlOperations,
        soqlQueries: analysis.soqlQueries,
        bulkificationScore: analysis.bulkificationScore
      });
    } catch (error) {
      Logger.error('FlowAnalyzer', 'Error during flow analysis', error);
      throw error;
    }
    
    return analysis;
  }

  private async parseAllElements(metadata: any, analysis: ComprehensiveFlowAnalysis): Promise<void> {
    Logger.debug('FlowAnalyzer', 'Starting element parsing');
    for (const elementType of Object.values(FlowElementType)) {
      if (metadata[elementType]) {
        const elements = Array.isArray(metadata[elementType]) 
          ? metadata[elementType] 
          : [metadata[elementType]];
        
        analysis.totalElements += elements.length;
        
        if (elementType === FlowElementType.RECORD_CREATE ||
            elementType === FlowElementType.RECORD_UPDATE ||
            elementType === FlowElementType.RECORD_DELETE) {
          analysis.dmlOperations += elements.length;
        }
        
        if (elementType === FlowElementType.RECORD_LOOKUP) {
          analysis.soqlQueries += elements.length;
        }

        elements.forEach(element => {
          const flowElement: FlowElement = {
            type: elementType as FlowElementType,
            name: element.name?.[0] || 'Unnamed',
            properties: this.parseProperties(element),
            connectors: this.parseConnectors(element)
          };
          
          analysis.elements.set(flowElement.name, flowElement);
          
          if (element.object) {
            analysis.objectDependencies.add(element.object[0]);
          }
        });
      }
    }
  }

  private parseProperties(element: any): Record<string, any> {
    const properties: Record<string, any> = {};
    Object.keys(element).forEach(key => {
      if (key !== 'name' && key !== 'connector' && element[key]) {
        properties[key] = Array.isArray(element[key]) ? element[key][0] : element[key];
      }
    });
    return properties;
  }

  private parseConnectors(element: any): FlowConnector[] {
    if (!element.connector) return [];
    
    const connectors = Array.isArray(element.connector) 
      ? element.connector 
      : [element.connector];
    
    return connectors.map((conn: any) => ({
      targetReference: conn.targetReference?.[0] || '',
      conditionLogic: conn.conditionLogic?.[0],
      conditions: this.parseConditions(conn.conditions)
    }));
  }

  private parseConditions(conditions: any): FlowCondition[] {
    if (!conditions) return [];
    
    const condArray = Array.isArray(conditions) ? conditions : [conditions];
    return condArray.map(cond => ({
      leftValueReference: cond.leftValueReference?.[0] || '',
      operator: cond.operator?.[0] || '',
      rightValue: cond.rightValue?.[0] ? {
        stringValue: cond.rightValue[0].stringValue?.[0],
        numberValue: cond.rightValue[0].numberValue?.[0] ? 
          parseFloat(cond.rightValue[0].numberValue[0]) : undefined,
        booleanValue: cond.rightValue[0].booleanValue?.[0] === 'true'
      } : undefined
    }));
  }

  private calculateMetrics(analysis: ComprehensiveFlowAnalysis): void {
    let score = 100;
    
    // Penalize for DML operations
    score -= Math.max(0, analysis.dmlOperations - 1) * 10;
    
    // Penalize for SOQL queries
    score -= Math.max(0, analysis.soqlQueries - 1) * 5;
    
    // Check for operations in loops
    analysis.elements.forEach(element => {
      if (element.type === FlowElementType.LOOP) {
        const hasNestedDML = this.hasNestedOperation(element, analysis, 
          [FlowElementType.RECORD_CREATE, FlowElementType.RECORD_UPDATE, FlowElementType.RECORD_DELETE]);
        const hasNestedSOQL = this.hasNestedOperation(element, analysis, 
          [FlowElementType.RECORD_LOOKUP]);
        
        if (hasNestedDML) score -= 30;
        if (hasNestedSOQL) score -= 20;
      }
    });
    
    analysis.bulkificationScore = Math.max(0, score);
  }

  private hasNestedOperation(
    element: FlowElement, 
    analysis: ComprehensiveFlowAnalysis,
    operationTypes: FlowElementType[]
  ): boolean {
    const visited = new Set<string>();
    
    const checkElement = (elementName: string): boolean => {
      if (visited.has(elementName)) return false;
      visited.add(elementName);
      
      const currentElement = analysis.elements.get(elementName);
      if (!currentElement) return false;
      
      if (operationTypes.includes(currentElement.type)) return true;
      
      return currentElement.connectors.some(conn => 
        conn.targetReference && checkElement(conn.targetReference)
      );
    };
    
    return element.connectors.some(conn => 
      conn.targetReference && checkElement(conn.targetReference)
    );
  }

  private generateRecommendations(analysis: ComprehensiveFlowAnalysis): void {
    if (analysis.bulkificationScore < 70) {
      analysis.recommendations.push('Critical: Flow requires significant bulkification');
    }
    
    analysis.elements.forEach(element => {
      if (element.type === FlowElementType.LOOP) {
        const hasNestedDML = this.hasNestedOperation(element, analysis, 
          [FlowElementType.RECORD_CREATE, FlowElementType.RECORD_UPDATE, FlowElementType.RECORD_DELETE]);
        const hasNestedSOQL = this.hasNestedOperation(element, analysis, 
          [FlowElementType.RECORD_LOOKUP]);
        
        if (hasNestedDML) {
          analysis.recommendations.push(`Move DML operations outside of loop in element: ${element.name}`);
        }
        if (hasNestedSOQL) {
          analysis.recommendations.push(`Move SOQL queries outside of loop in element: ${element.name}`);
        }
      }
    });
    
    if (analysis.dmlOperations > 1) {
      analysis.recommendations.push('Consider consolidating multiple DML operations');
    }
    
    if (analysis.soqlQueries > 1) {
      analysis.recommendations.push('Consider combining SOQL queries where possible');
    }
  }
}