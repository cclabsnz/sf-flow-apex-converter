import { Logger } from '../../Logger.js';
import { FlowMetadata } from '../../../types/elements';
import { SubflowReference } from '../../interfaces/SubflowTypes';
import { FlowElementMetadata } from '../../../types';
import { ElementCounter } from './ElementCounter.js';
import { ComplexityAnalyzer } from '../../analyzers/subflow/ComplexityAnalyzer.js';
import { FlowElementsImpl } from '../../analyzers/FlowElementsImpl';

export class ReferenceExtractor {
  private static readonly MAX_DEPTH = 10;
  private processedFlows = new Set<string>();

  constructor(private getSubflowMetadata: (name: string) => Promise<FlowMetadata>) {}

  private getXMLValue<T>(value: unknown): T | undefined {
    if (Array.isArray(value) && value.length > 0) {
      return value[0] as T;
    }
    return undefined;
  }

  private isInLoop(element: FlowElementMetadata, loopElements: Set<string>): boolean {
    if (!element.processMetadataValues) return false;
    
    const processValues = Array.isArray(element.processMetadataValues) 
      ? element.processMetadataValues 
      : [element.processMetadataValues];

    for (const value of processValues) {
      const name = this.getXMLValue<string>(value.name);
      const valueStr = this.getXMLValue<string>(value.value);
      if (name === 'BuilderContext' && valueStr) {
        try {
          const context = JSON.parse(valueStr || '{}');
          return loopElements.has(context.containerId);
        } catch (e) {
          return false;
        }
      }
    }
    return false;
  }

  async extractSubflowReferences(metadata: FlowMetadata, depth: number = 0): Promise<SubflowReference[]> {
    const references: SubflowReference[] = [];
    const loopElements = new Set<string>();
    
    Logger.debug('ReferenceExtractor', 'Starting subflow extraction', { depth });

    if (depth >= ReferenceExtractor.MAX_DEPTH) {
      Logger.warn('ReferenceExtractor', `Maximum recursion depth ${ReferenceExtractor.MAX_DEPTH} reached`);
      return references;
    }

    if (metadata.loops) {
      const loops = Array.isArray(metadata.loops) ? metadata.loops : [metadata.loops];
      loops.forEach((loop: FlowElementMetadata) => {
        if (Array.isArray(loop.name) && loop.name[0]) {
          loopElements.add(loop.name[0]);
        }
      });
    }

    if (metadata.subflows || metadata.steps || metadata.nodes || metadata.flow) {
      const potentialSubflows = [
        ...(metadata.subflows ? (Array.isArray(metadata.subflows) ? metadata.subflows : [metadata.subflows]) : []),
        ...(metadata.steps?.filter((step: any) => Array.isArray(step.type) && step.type[0] === 'Subflow') || []),
        ...(metadata.nodes?.filter((node: any) => Array.isArray(node.type) && node.type[0] === 'Subflow') || []),
        ...(metadata.flow?.subflows ? (Array.isArray(metadata.flow.subflows) ? metadata.flow.subflows : [metadata.flow.subflows]) : [])
      ];

      Logger.info('ReferenceExtractor', `Found ${potentialSubflows.length} potential subflows to analyze`);

      for (const subflow of potentialSubflows) {
        const flowName = Array.isArray(subflow.flowName) ? subflow.flowName[0] : '';
        if (!flowName || this.processedFlows.has(flowName)) {
          Logger.debug('ReferenceExtractor', `Skipping already processed subflow: ${flowName}`);
          continue;
        }
        
        Logger.info('ReferenceExtractor', `Processing subflow: ${flowName} (depth: ${depth})`);
        this.processedFlows.add(flowName);

        try {
          const subflowMetadata = await this.getSubflowMetadata(flowName);
          const subflowElements = ElementCounter.countFlowElements(subflowMetadata);
          const dmlOperations = ElementCounter.countDMLOperations(subflowMetadata);
          const soqlQueries = ElementCounter.countSOQLQueries(subflowMetadata);
          const complexity = ComplexityAnalyzer.calculateComplexity(subflowMetadata);
          
          const nestedSubflows = await this.extractSubflowReferences(subflowMetadata, depth + 1);
          
          const reference: SubflowReference = {
            name: flowName,
            isInLoop: this.isInLoop(subflow, loopElements),
            parentElement: Array.isArray(subflow.name) ? subflow.name[0] : undefined,
            metadata: subflowMetadata,
            analysis: {
              elements: subflowElements,
              dmlOperations,
              soqlQueries,
              complexity,
              nestedSubflows
            }
          };

          if (subflow.inputAssignments) {
            const inputs = Array.isArray(subflow.inputAssignments) 
              ? subflow.inputAssignments 
              : [subflow.inputAssignments];
            
            reference.inputAssignments = inputs.map((input: any) => ({
              name: Array.isArray(input.name) ? input.name[0] : '',
              value: Array.isArray(input.value) ? input.value[0] : '',
              dataType: Array.isArray(input.dataType) ? input.dataType[0] : 'String'
            }));
          }

          if (subflow.outputAssignments) {
            const outputs = Array.isArray(subflow.outputAssignments) 
              ? subflow.outputAssignments 
              : [subflow.outputAssignments];
            
            reference.outputAssignments = outputs.map((output: any) => ({
              name: Array.isArray(output.name) ? output.name[0] : '',
              value: Array.isArray(output.value) ? output.value[0] : '',
              dataType: Array.isArray(output.dataType) ? output.dataType[0] : 'String'
            }));
          }

          references.push(reference);
          Logger.info('ReferenceExtractor', `Successfully analyzed subflow: ${flowName}`, {
            elements: subflowElements.total,
            dmlOperations,
            soqlQueries,
            complexity,
            nestedSubflowCount: nestedSubflows.length,
            isInLoop: reference.isInLoop,
            inputParams: reference.inputAssignments?.length || 0,
            outputParams: reference.outputAssignments?.length || 0
          });
        } catch (error: any) {
          Logger.error('ReferenceExtractor', `Failed to analyze subflow: ${flowName}`, error);
        }
      }
    }

    return references;
  }
}