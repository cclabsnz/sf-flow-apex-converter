import { Connection } from 'jsforce';
import { MetadataParser } from './parsers/MetadataParser.js';
import { SchemaManager } from './SchemaManager.js';
import { SubflowManager } from './SubflowManager.js';
import { Logger } from './Logger.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { FlowElementType, FlowElement, FlowConnector, FlowCondition } from './interfaces/FlowTypes.js';
import { SecurityContext } from './interfaces/SecurityTypes.js';
import { ComprehensiveFlowAnalysis, SubflowAnalysis } from './interfaces/FlowAnalysisTypes.js';

export class FlowAnalyzer {
  private analyzeSecurityContext(metadata: Record<string, unknown>): SecurityContext {
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
      const parsedMetadata = await MetadataParser.parseMetadata(flowContent);
      
      // Wrap the parsed metadata in the expected structure
      return {
        Metadata: parsedMetadata,
        definition: {
          DeveloperName: flowName,
          ProcessType: parsedMetadata?.processType?.[0] || 'Flow'
        }
      };
      
    } catch (error) {
      Logger.error('FlowAnalyzer', `Failed to fetch flow from org: ${(error as Error).message}`, error);
      throw error;
    }
  }
  constructor(
    private connection: Connection,
    private schemaManager: SchemaManager,
    private subflowManager: SubflowManager,
    private getFlowXml?: (flowName: string) => string | undefined
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
      apiVersion: metadata.apiVersion?.[0] || '58.0',
      subflows: []
    };

    try {
      Logger.info('FlowAnalyzer', 'Parsing flow elements');
      await this.parseAllElements(metadata, analysis);

      Logger.info('FlowAnalyzer', 'Calculating metrics');
      this.calculateMetrics(analysis);

      Logger.info('FlowAnalyzer', 'Generating recommendations');
      this.generateRecommendations(analysis);

      // Prepare operation summary
      const summary = {
        flow: {
          name: analysis.flowName,
          type: analysis.processType,
          totalElements: analysis.totalElements,
          bulkificationScore: analysis.bulkificationScore,
          apiVersion: analysis.apiVersion
        },
        operations: {
          dml: {
            total: analysis.operationSummary.totalOperations.dml.total,
            inLoop: analysis.operationSummary.totalOperations.dml.inLoop,
            sources: analysis.operationSummary.dmlOperations.map(op => ({
              flow: op.sourceFlow,
              count: op.count,
              inLoop: op.inLoop,
              locations: op.sources
            }))
          },
          soql: {
            total: analysis.operationSummary.totalOperations.soql.total,
            inLoop: analysis.operationSummary.totalOperations.soql.inLoop,
            sources: analysis.operationSummary.soqlQueries.map(op => ({
              flow: op.sourceFlow,
              count: op.count,
              inLoop: op.inLoop,
              locations: op.sources
            }))
          }
        },
        bulkificationNeeded: analysis.shouldBulkify,
        reason: analysis.bulkificationReason,
        recommendations: analysis.recommendations
      };

      Logger.info('FlowAnalyzer', 'Analysis complete', summary);
    } catch (error) {
      Logger.error('FlowAnalyzer', 'Error during flow analysis', error);
      throw error;
    }
    
    return analysis;
  }

  private buildLoopContext(metadata: any): Map<string, string> {
    const loopContext = new Map<string, string>();
    
    // Check for loops and collect their target references
    if (metadata.loops) {
      const loops = Array.isArray(metadata.loops) ? metadata.loops : [metadata.loops];
      for (const loop of loops) {
        if (loop.name && loop.connector) {
          const connectors = Array.isArray(loop.connector) ? loop.connector : [loop.connector];
          for (const connector of connectors) {
            if (connector.targetreference) {
              const target = connector.targetreference[0];
              loopContext.set(target, loop.name[0]);
            }
          }
        }
      }
    }

    return loopContext;
  }

  private isElementInLoop(elementName: string, loopContext: Map<string, string>, visitedElements: Set<string> = new Set()): string | undefined {
    // Prevent infinite recursion
    if (visitedElements.has(elementName)) return undefined;
    visitedElements.add(elementName);

    // Check if element is directly in a loop
    return loopContext.get(elementName);
  }

  private async parseAllElements(metadata: any, analysis: ComprehensiveFlowAnalysis): Promise<void> {
    Logger.debug('FlowAnalyzer', 'Starting element parsing');
    Logger.debug('FlowAnalyzer', `Metadata keys: ${Object.keys(metadata)}`);
    
    // Build loop context
    const loopContext = this.buildLoopContext(metadata);
    Logger.debug('FlowAnalyzer', `Found loops: ${Array.from(loopContext.entries()).map(([target, loop]) => `${loop} -> ${target}`).join(', ')}`);
    
    // Map of flow types to their possible XML tag names
    const typeToTags = {
      [FlowElementType.RECORD_CREATE]: ['recordcreates', 'recordCreates'],
      [FlowElementType.RECORD_UPDATE]: ['recordupdates', 'recordUpdates'],
      [FlowElementType.RECORD_DELETE]: ['recorddeletes', 'recordDeletes'],
      [FlowElementType.RECORD_LOOKUP]: ['recordlookups', 'recordLookups'],
      [FlowElementType.RECORD_ROLLBACK]: ['recordrollbacks', 'recordRollbacks'],
      [FlowElementType.ASSIGNMENT]: ['assignments'],
      [FlowElementType.DECISION]: ['decisions'],
      [FlowElementType.LOOP]: ['loops'],
      [FlowElementType.SUBFLOW]: ['subflows'],
      [FlowElementType.SCREEN]: ['screens']
    };

    for (const elementType of Object.values(FlowElementType)) {
      Logger.debug('FlowAnalyzer', `Checking element type: ${elementType}`);
      
      // Get possible tag names for this type
      const possibleTags = typeToTags[elementType] || [elementType.toLowerCase()];
      Logger.debug('FlowAnalyzer', `Possible tags for ${elementType}: ${possibleTags.join(', ')}`);
      
      // Check all possible tags
      for (const tag of possibleTags) {
        Logger.debug('FlowAnalyzer', `Checking tag: ${tag}, exists: ${!!metadata[tag]}`);
        if (metadata[tag]) {
          Logger.debug('FlowAnalyzer', `Found elements of type: ${elementType} with tag: ${tag}`);
          const elements = Array.isArray(metadata[tag]) 
            ? metadata[tag] 
            : [metadata[tag]];
        
          analysis.totalElements += elements.length;
          
          if (elementType === FlowElementType.RECORD_CREATE ||
              elementType === FlowElementType.RECORD_UPDATE ||
              elementType === FlowElementType.RECORD_DELETE) {
            analysis.dmlOperations += elements.length;
          }
          
          if (elementType === FlowElementType.RECORD_LOOKUP) {
            analysis.soqlQueries += elements.length;
          }

          for (const element of elements) {
            const elementName = element.name?.[0] || 'Unnamed';
            const elementLoopContext = this.isElementInLoop(elementName, loopContext);
            
            const flowElement: FlowElement = {
              type: elementType as FlowElementType,
              name: elementName,
              properties: this.parseProperties(element),
              connectors: this.parseConnectors(element),
              isInLoop: !!elementLoopContext,
              loopContext: elementLoopContext
            };
            
            analysis.elements.set(flowElement.name, flowElement);
            
            if (element.object) {
              analysis.objectDependencies.add(element.object[0]);
            }

            if (elementType === FlowElementType.SUBFLOW) {
              const subflowName = element.flowname?.[0];
              Logger.debug('FlowAnalyzer', `Found subflow reference: ${subflowName}`);
              if (subflowName) {
                try {
                  // Try to get local XML file first
                  let subflowXml: string | undefined;
                  if (this.getFlowXml) {
                    subflowXml = this.getFlowXml(subflowName);
                    Logger.debug('FlowAnalyzer', `Subflow XML found: ${!!subflowXml}`);
                    if (!subflowXml) {
                      Logger.info('FlowAnalyzer', `Skipping missing subflow ${subflowName} in local mode`);
                      continue;
                    }
                  }
                  
                  const subflowAnalysis = await this.subflowManager.analyzeSubflow(
                  subflowName, 
                  0, 
                  subflowXml, 
                  element.flowname?.[0],
                  elementLoopContext ? {
                    isInLoop: true,
                    loopContext: elementLoopContext
                  } : undefined
                );
                  analysis.subflows.push(subflowAnalysis);
                  
                  // Aggregate metrics from subflow
                  analysis.totalElements += subflowAnalysis.totalElementsWithSubflows;
                  analysis.dmlOperations += subflowAnalysis.cumulativeDmlOperations;
                  analysis.soqlQueries += subflowAnalysis.cumulativeSoqlQueries;
                  
                  // Update operation totals
                  const subflowOps = subflowAnalysis.operationSummary.totalOperations;
                  const mainOps = analysis.operationSummary.totalOperations;
                  
                  mainOps.dml.total += subflowOps.dml.total;
                  mainOps.dml.inLoop += subflowOps.dml.inLoop;
                  mainOps.soql.total += subflowOps.soql.total;
                  mainOps.soql.inLoop += subflowOps.soql.inLoop;
                } catch (error) {
                  Logger.warn('FlowAnalyzer', `Could not analyze subflow ${subflowName}: ${(error as Error).message}`);
                }
              }
            }
          }
        }
      }
    }
  }

  private parseProperties(element: Record<string, unknown>): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    Object.keys(element).forEach(key => {
      if (key !== 'name' && key !== 'connector' && element[key]) {
        properties[key] = Array.isArray(element[key]) ? element[key][0] : element[key];
      }
    });
    return properties;
  }

  private parseConnectors(element: Record<string, unknown>): ElementRef[] {
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
    let bulkificationReason = '';
    
    // Penalize for DML operations
    const dmlPenalty = Math.max(0, analysis.dmlOperations - 1) * 10;
    if (dmlPenalty > 0) {
      score -= dmlPenalty;
      bulkificationReason += `Multiple DML operations (${analysis.dmlOperations}) should be bulkified. `;
    }
    
    // Penalize for SOQL queries
    const soqlPenalty = Math.max(0, analysis.soqlQueries - 1) * 5;
    if (soqlPenalty > 0) {
      score -= soqlPenalty;
      bulkificationReason += `Multiple SOQL queries (${analysis.soqlQueries}) should be consolidated. `;
    }
    
    // Check for operations in loops
    analysis.loops.forEach(loop => {
      // DML in loops
      if (loop.containsDML) {
        score -= 30;
        bulkificationReason += `DML operations found inside loop processing ${loop.loopVariables.inputCollection}. `;
      }
      
      // SOQL in loops
      if (loop.containsSOQL) {
        score -= 20;
        bulkificationReason += `SOQL queries found inside loop processing ${loop.loopVariables.inputCollection}. `;
      }
      
      // Subflows in loops
      if (loop.containsSubflows) {
        score -= 15;
        bulkificationReason += `Subflow calls found inside loop processing ${loop.loopVariables.inputCollection}. `;
      }
      
      // Nested elements count
      const totalNested = loop.nestedElements.dml + loop.nestedElements.soql + 
                         loop.nestedElements.subflows + loop.nestedElements.other;
      if (totalNested > 5) {
        score -= Math.min(20, (totalNested - 5) * 2);
        bulkificationReason += `High number of operations (${totalNested}) inside loop. `;
      }
    });
    
    analysis.bulkificationScore = Math.max(0, score);
    analysis.shouldBulkify = score < 80;
    if (analysis.shouldBulkify) {
      analysis.bulkificationReason = bulkificationReason.trim();
    }
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