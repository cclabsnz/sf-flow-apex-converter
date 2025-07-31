import { Logger } from './Logger.js';
import { FlowMetadata } from './interfaces/types.js';
import { SubflowAnalysis } from './interfaces/analysis/FlowAnalysis.js';
import { FlowElement } from '../types';
import { ElementCounter } from './analyzers/subflow/ElementCounter.js';
import { ComplexityAnalyzer } from './analyzers/subflow/ComplexityAnalyzer.js';
import { BulkificationAnalyzer } from './analyzers/subflow/BulkificationAnalyzer.js';
import { RecommendationGenerator } from './analyzers/subflow/RecommendationGenerator.js';

export class SubflowAnalyzer {
  async analyzeMetadata(
    metadata: FlowMetadata,
    depth: number = 0
  ): Promise<SubflowAnalysis> {
    let dmlOperations = 0;
    let soqlQueries = 0;
    let soqlInLoop = false;
    const parameters = new Map<string, any>();
    const soqlSources = new Set<string>();
    const flowVersion = metadata._flowVersion;
    const subflowDetails: any[] = [];
    let totalElementsWithSubflows = 0;
    const processedSubflows = new Set<string>();

    Logger.info('SubflowAnalyzer', `Analyzing flow version ${flowVersion.version}`, {
      status: flowVersion.status,
      lastModified: flowVersion.lastModified
    });

    // Count DML operations
    if (metadata.recordCreates) dmlOperations += ElementCounter.countElements(metadata.recordCreates);
    if (metadata.recordUpdates) dmlOperations += ElementCounter.countElements(metadata.recordUpdates);
    if (metadata.recordDeletes) dmlOperations += ElementCounter.countElements(metadata.recordDeletes);

    // Record Lookups (Get Records)
    if (metadata.recordLookups) {
      const lookups = Array.isArray(metadata.recordLookups) ? metadata.recordLookups : [metadata.recordLookups];
      soqlQueries += lookups.length;
      soqlSources.add('Record Lookups');
    }

    // Dynamic Choice Sets
    if (metadata.dynamicChoiceSets) {
      const choiceSets = Array.isArray(metadata.dynamicChoiceSets) ? metadata.dynamicChoiceSets : [metadata.dynamicChoiceSets];
      soqlQueries += choiceSets.length;
      soqlSources.add('Dynamic Choice Sets');
    }

    // Record-Triggered Flow
    if (Array.isArray(metadata.trigger?.[0]?.type) && metadata.trigger[0].type[0] === 'RecordAfterSave') {
      soqlQueries++; // Count implicit query for the triggering record
      soqlSources.add('Record-Triggered Flow');
    }

    // Formula Elements with Cross-Object References
    if (metadata.formulas) {
      const formulas = Array.isArray(metadata.formulas) ? metadata.formulas : [metadata.formulas];
      for (const formula of formulas) {
        if (typeof formula.expression?.[0] === 'string' && formula.expression[0].includes('.')) {
          soqlQueries++; // Count cross-object reference queries
          soqlSources.add('Cross-Object Formula References');
        }
      }
    }

    // Calculate complexity
    const complexity = ComplexityAnalyzer.calculateComplexity(metadata);
    const cumulativeComplexity = complexity;
    const cumulativeDmlOperations = dmlOperations;
    const cumulativeSoqlQueries = soqlQueries;

    // Extract parameters
    if (metadata.variables) {
      const variables = Array.isArray(metadata.variables) ? metadata.variables : [metadata.variables];
      variables.forEach((variable: any) => {
        if (variable.isInput?.[0] === 'true' || variable.isOutput?.[0] === 'true') {
          parameters.set(variable.name[0], {
            dataType: variable.dataType?.[0],
            isInput: variable.isInput?.[0] === 'true',
            isOutput: variable.isOutput?.[0] === 'true',
            isCollection: variable.isCollection?.[0] === 'true'
          });
        }
      });
    }

    const shouldBulkify = BulkificationAnalyzer.shouldBulkify(
      dmlOperations, 
      soqlQueries, 
      complexity, 
      metadata, 
      soqlInLoop
    );

    const apexRecommendation = RecommendationGenerator.getApexRecommendation(
      cumulativeComplexity,
      cumulativeDmlOperations,
      cumulativeSoqlQueries,
      subflowDetails,
      processedSubflows
    );

    const elements = new Map<string, FlowElement>();
    totalElementsWithSubflows = ElementCounter.countFlowElements(metadata).total;

    return {
      depth,
      flowName: metadata.name?.[0] || 'Unknown',
      shouldBulkify,
      bulkificationReason: BulkificationAnalyzer.getBulkificationReason(
        dmlOperations, 
        soqlQueries, 
        complexity, 
        metadata, 
        soqlInLoop
      ),
      complexity,
      cumulativeComplexity,
      dmlOperations,
      cumulativeDmlOperations,
      soqlQueries,
      cumulativeSoqlQueries,
      parameters,
      version: flowVersion,
      soqlSources: Array.from(soqlSources),
      elements,
      subflows: [],
      totalElementsWithSubflows,
      recommendations: [{...apexRecommendation}],
      processType: 'Flow',
      totalElements: totalElementsWithSubflows,
      bulkificationScore: 100,
      loops: [],
      loopContexts: new Map(),
      apiVersion: '58.0',
      operationSummary: {
        totalOperations: {
          dml: { total: 0, inLoop: 0 },
          soql: { total: 0, inLoop: 0 }
        },
        dmlOperations: [],
        soqlQueries: []
      }
    };
  }
}