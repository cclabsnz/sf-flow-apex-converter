import { Connection } from 'jsforce';
import { SchemaManager } from './SchemaManager.js';
import { SubflowManager } from './SubflowManager.js';
import { Logger } from './Logger.js';
import { SecurityAnalyzer } from './analyzers/SecurityAnalyzer.js';
import { OrgMetadataFetcher } from './fetchers/OrgMetadataFetcher.js';
import { ElementParser } from './parsers/ElementParser.js';
import { MetricsCalculator } from './analyzers/MetricsCalculator.js';
import { RecommendationGenerator } from './analyzers/RecommendationGenerator.js';
import { toXML } from './types/toXML';
import { fromXML } from './types/fromXML';

import {
  FlowElementType,
  FlowElement,
  SecurityContext,
  ComprehensiveFlowAnalysis,
  SubflowAnalysis,
  FlowMetadata
} from '../types';

export class FlowAnalyzer {
  constructor(
    private connection: Connection,
    private schemaManager: SchemaManager,
    private subflowManager: SubflowManager,
    private securityAnalyzer: SecurityAnalyzer,
    private orgMetadataFetcher: OrgMetadataFetcher,
    private getFlowXml?: (flowName: string) => string | undefined
  ) {}

  async analyzeFlowFromOrg(flowName: string): Promise<ComprehensiveFlowAnalysis> {
    const flowMetadata = await this.orgMetadataFetcher.fetchFlowFromOrg(flowName);
    return this.analyzeFlowComprehensive(flowMetadata);
  }

  async analyzeFlowComprehensive(flowMetadata: { Metadata: FlowMetadata; definition: { DeveloperName: string; ProcessType: string; }}): Promise<ComprehensiveFlowAnalysis> {
    console.time('FlowAnalysis');
    Logger.info('FlowAnalyzer', 'Starting flow analysis');
    Logger.debug('FlowAnalyzer', 'Flow metadata received', flowMetadata);

    const metadata = flowMetadata.Metadata;
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
      elements: new Map<string, FlowElement>(),
      objectDependencies: new Set(),
      recommendations: [],
      securityContext: this.securityAnalyzer.analyzeSecurityContext(fromXML(toXML(metadata))),
      apiVersion: Array.isArray(metadata.apiVersion) && metadata.apiVersion[0] ? metadata.apiVersion[0] : '58.0',
      subflows: [],
      loops: [],
      loopContexts: new Map(),
      operationSummary: {
        totalOperations: {
          dml: { total: 0, inLoop: 0 },
          soql: { total: 0, inLoop: 0 }
        },
        dmlOperations: [],
        soqlQueries: []
      }
    };

    try {
      Logger.info('FlowAnalyzer', 'Parsing flow elements');
      await this.parseAllElements(metadata, analysis);

      Logger.info('FlowAnalyzer', 'Calculating metrics');
      const metrics = MetricsCalculator.calculateMetrics(fromXML(toXML(metadata)));
      analysis.loops = metrics.loops;

      Logger.info('FlowAnalyzer', 'Generating recommendations');
      RecommendationGenerator.generateRecommendations(analysis);

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
    
    console.timeEnd('FlowAnalysis');
    return analysis;
  }

  private async parseAllElements(metadata: FlowMetadata, analysis: ComprehensiveFlowAnalysis): Promise<void> {
    Logger.debug('FlowAnalyzer', 'Starting element parsing');
    Logger.debug('FlowAnalyzer', `Metadata keys: ${Object.keys(metadata)}`);
    
    const loopContext = ElementParser.buildLoopContext(metadata);
    Logger.debug('FlowAnalyzer', `Found loops: ${Array.from(loopContext.entries()).map(([target, loop]) => `${loop} -> ${target}`).join(', ')}`);
    
    for (const elementType of Object.values(FlowElementType)) {
      Logger.debug('FlowAnalyzer', `Checking element type: ${elementType}`);
      
      const possibleTags = ElementParser.getTagsForType(elementType);
      Logger.debug('FlowAnalyzer', `Possible tags for ${elementType}: ${possibleTags.join(', ')}`);
      
      for (const tag of possibleTags) {
        Logger.debug('FlowAnalyzer', `Checking tag: ${tag}, exists: ${!!metadata[tag]}`);
        if (metadata[tag]) {
          Logger.debug('FlowAnalyzer', `Found elements of type: ${elementType} with tag: ${tag}`);
          const elements = Array.isArray(metadata[tag]) 
            ? metadata[tag] as Array<any> 
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
            const flowElement = ElementParser.parseElement(element, elementType, loopContext);
            analysis.elements.set(flowElement.name, flowElement);
            
            if (Array.isArray(element.object)) {
              analysis.objectDependencies.add(element.object[0]);
            }

            if (elementType === FlowElementType.SUBFLOW) {
              const subflowName = Array.isArray(element.flowname) ? element.flowname[0] : undefined;
              const subflowDetails = {
                name: subflowName,
                inputMappings: element.inputAssignments || [],
                outputMappings: element.outputAssignments || []
              };
              Logger.info('FlowAnalyzer', `Found subflow: ${JSON.stringify(subflowDetails, null, 2)}`);
              if (subflowName) {
                try {
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
                    Array.isArray(element.flowname) ? element.flowname[0] : undefined,
                    flowElement.isInLoop ? {
                      isInLoop: true,
                      loopContext: flowElement.loopContext!
                    } : undefined
                  );
                  analysis.subflows.push(subflowAnalysis);
                  
                  analysis.totalElements += subflowAnalysis.totalElementsWithSubflows;
                  analysis.dmlOperations += subflowAnalysis.cumulativeDmlOperations;
                  analysis.soqlQueries += subflowAnalysis.cumulativeSoqlQueries;
                  
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
}