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

import { FlowElementType } from './interfaces/FlowTypes.js';
import { FlowElement, FlowMetadata } from '../types/elements';
import { ComprehensiveFlowAnalysis, SubflowAnalysis, SubflowInfo } from './interfaces/FlowAnalysisTypes.js';

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
      name: flowMetadata.definition.DeveloperName,
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

      // Log detailed analysis to file
      Logger.debug('FlowAnalyzer', 'Complete analysis details', analysis);
      
      // Create and log a concise summary
      const summary = {
        flow: {
          name: analysis.flowName,
          type: analysis.processType,
          elements: analysis.totalElements,
          score: analysis.bulkificationScore
        },
        operations: {
          dml: {
            total: analysis.operationSummary.totalOperations.dml.total,
            inLoop: analysis.operationSummary.totalOperations.dml.inLoop
          },
          soql: {
            total: analysis.operationSummary.totalOperations.soql.total,
            inLoop: analysis.operationSummary.totalOperations.soql.inLoop
          }
        },
        loops: analysis.loops.length,
        bulkification: analysis.shouldBulkify ? {
          needed: true,
          reason: analysis.bulkificationReason
        } : {
          needed: false
        },
        recommendations: analysis.recommendations.length
      };

      Logger.info('FlowAnalyzer', `Analysis complete for ${analysis.flowName}`);
      Logger.info('FlowAnalyzer', 'Summary:', summary);
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

            if (elementType === FlowElementType.SUBFLOW || elementType === FlowElementType.ACTION_CALL) {
              Logger.debug('FlowAnalyzer', `Processing ${elementType}: ${JSON.stringify(element.name)}`);
              Logger.debug('FlowAnalyzer', `Flow element details: ${JSON.stringify(flowElement)}`);
              Logger.debug('FlowAnalyzer', `Loop context: ${JSON.stringify(loopContext.get(flowElement.name))}`);
              Logger.debug('FlowAnalyzer', `Current element keys: ${Object.keys(element).join(', ')}`);
              const subflowName = Array.isArray(element.flowname) ? element.flowname[0] : undefined;
              const subflowDetails = {
                name: subflowName,
                inputMappings: element.inputAssignments || [],
                outputMappings: element.outputAssignments || [],
                isInLoop: flowElement.isInLoop,
                loopName: flowElement.loopContext || 'N/A'
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

                  const flowContext = loopContext.get(flowElement.name);
                  Logger.debug('FlowAnalyzer', `Subflow ${subflowName} context: ${JSON.stringify(flowContext)}`);
                  
                  // Check if any element in the path is a loop
                  const isInNestedLoop = flowContext?.path?.some((element, index) => {
                    const elementType = flowContext.pathTypes?.[index];
                    return elementType === FlowElementType.LOOP;
                  }) || false;
                  
                  const subflowAnalysis = await this.subflowManager.analyzeSubflow(
                    subflowName, 
                    0, 
                    subflowXml, 
                    Array.isArray(element.flowname) ? element.flowname[0] : undefined,
                    isInNestedLoop ? {
                      isInLoop: true,
                      loopReferenceName: flowContext?.loopReferenceName || '',
                      path: flowContext?.path || [],
                      pathTypes: flowContext?.pathTypes || [],
                      depth: flowContext?.depth || 1
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