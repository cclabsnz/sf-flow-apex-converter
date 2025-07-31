import { Connection } from 'jsforce';
import { Logger } from '../Logger.js';
import { FlowMetadata, FlowElementMetadata, SubflowReference, FlowElements } from '../interfaces/SubflowTypes.js';
import { MetadataParser } from './MetadataParser.js';

export class SubflowParser {
  private processedFlows = new Set<string>();
  private static readonly MAX_DEPTH = 10;

  constructor(private connection: Connection) {}

  async getSubflowMetadata(subflowName: string, requireActive: boolean = true): Promise<FlowMetadata> {
    const query = `
      SELECT Id, Metadata, VersionNumber, Status, LastModifiedDate 
      FROM Flow 
      WHERE DeveloperName = '${subflowName}'
      ${requireActive ? "AND Status = 'Active'" : ""}
      ORDER BY VersionNumber DESC
    `;
    
    Logger.debug('SubflowParser', `Fetching metadata for flow: ${subflowName}`, { query });
    const result = await this.connection.tooling.query(query);
    
    if (result.records.length === 0) {
      const errorMsg = requireActive 
        ? `Flow ${subflowName} not found or not active`
        : `Flow ${subflowName} not found`;
      Logger.warn('SubflowParser', errorMsg);
      throw new Error(errorMsg);
    }

    const flow = result.records[0];
    Logger.info('SubflowParser', `Found flow: ${subflowName}`, {
      version: flow.VersionNumber,
      status: flow.Status,
      lastModified: flow.LastModifiedDate
    });

    // Parse the metadata based on its format
    const metadata = await MetadataParser.parseMetadata(flow.Metadata);

    // Add version info
    return {
      ...metadata,
      _flowVersion: {
        version: flow.VersionNumber,
        status: flow.Status,
        lastModified: flow.LastModifiedDate
      }
    };
  }

  private countElements(metadata: FlowMetadata): FlowElements {
    const elements: FlowElements = { total: 0 };
    
    const elementTypes = [
      { key: 'recordLookups', name: 'Record Lookups' },
      { key: 'recordCreates', name: 'Record Creates' },
      { key: 'recordUpdates', name: 'Record Updates' },
      { key: 'recordDeletes', name: 'Record Deletes' },
      { key: 'decisions', name: 'Decisions' },
      { key: 'loops', name: 'Loops' },
      { key: 'assignments', name: 'Assignments' },
      { key: 'actionCalls', name: 'Apex Actions' },
      { key: 'subflows', name: 'Subflows' }
    ];

    for (const type of elementTypes) {
      if (metadata[type.key]) {
        const count = Array.isArray(metadata[type.key]) ? metadata[type.key].length : 1;
        elements[type.key] = count;
        elements.total += count;
        Logger.debug('SubflowParser', `Found ${count} ${type.name}`);
      }
    }

    return elements;
  }

  private countDMLOperations(metadata: FlowMetadata): number {
    let count = 0;
    if (metadata.recordCreates) count += Array.isArray(metadata.recordCreates) ? metadata.recordCreates.length : 1;
    if (metadata.recordUpdates) count += Array.isArray(metadata.recordUpdates) ? metadata.recordUpdates.length : 1;
    if (metadata.recordDeletes) count += Array.isArray(metadata.recordDeletes) ? metadata.recordDeletes.length : 1;
    return count;
  }

  private countSOQLQueries(metadata: FlowMetadata): number {
    let count = 0;
    if (metadata.recordLookups) count += Array.isArray(metadata.recordLookups) ? metadata.recordLookups.length : 1;
    if (metadata.dynamicChoiceSets) count += Array.isArray(metadata.dynamicChoiceSets) ? metadata.dynamicChoiceSets.length : 1;
    // Count implicit query for record-triggered flows
    if (metadata.trigger && metadata.trigger[0]?.type?.[0] === 'RecordAfterSave') count++;
    return count;
  }

  private calculateComplexity(metadata: FlowMetadata): number {
    let complexity = 1;

    // Add complexity for decisions
    if (metadata.decisions) {
      complexity += (Array.isArray(metadata.decisions) ? metadata.decisions.length : 1) * 2;
    }

    // Add complexity for loops
    if (metadata.loops) {
      complexity += (Array.isArray(metadata.loops) ? metadata.loops.length : 1) * 3;
    }

    // Add complexity for DML
    complexity += this.countDMLOperations(metadata) * 2;

    // Add complexity for SOQL
    complexity += this.countSOQLQueries(metadata) * 2;

    // Add complexity for subflows
    if (metadata.subflows) {
      complexity += (Array.isArray(metadata.subflows) ? metadata.subflows.length : 1) * 2;
    }

    return complexity;
  }

  private isInLoop(element: FlowElementMetadata, loopElements: Set<string>): boolean {
    if (!element.processMetadataValues) return false;
    
    const processValues = Array.isArray(element.processMetadataValues) 
      ? element.processMetadataValues 
      : [element.processMetadataValues];

    for (const value of processValues) {
      if (value.name?.[0] === 'BuilderContext' && value.value?.[0]) {
        try {
          const context = JSON.parse(value.value[0]);
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
    
    Logger.debug('SubflowParser', 'Starting subflow extraction', { depth });

    // Don't exceed max depth
    if (depth >= SubflowParser.MAX_DEPTH) {
      Logger.warn('SubflowParser', `Maximum recursion depth ${SubflowParser.MAX_DEPTH} reached`);
      return references;
    }

    // First, identify all loop elements
    if (metadata.loops) {
      const loops = Array.isArray(metadata.loops) ? metadata.loops : [metadata.loops];
      loops.forEach((loop: FlowElementMetadata) => {
        if (loop.name) loopElements.add(loop.name[0]);
      });
    }

    // Process direct subflow references and all possible subflow locations
    if (metadata.subflows || metadata.steps || metadata.nodes || metadata.flow) {
      // Try different possible locations where subflows might be defined
      const potentialSubflows = [
        ...(metadata.subflows ? (Array.isArray(metadata.subflows) ? metadata.subflows : [metadata.subflows]) : []),
        ...(metadata.steps?.filter((step: any) => step.type?.[0] === 'Subflow') || []),
        ...(metadata.nodes?.filter((node: any) => node.type?.[0] === 'Subflow') || []),
        ...(metadata.flow?.subflows ? (Array.isArray(metadata.flow.subflows) ? metadata.flow.subflows : [metadata.flow.subflows]) : [])
      ];

      Logger.info('SubflowParser', `Found ${potentialSubflows.length} potential subflows to analyze`);

      // Process each potential subflow
      for (const subflow of potentialSubflows) {
        const flowName = subflow.flowName?.[0] || '';
        if (!flowName || this.processedFlows.has(flowName)) {
          Logger.debug('SubflowParser', `Skipping already processed subflow: ${flowName}`);
          continue;
        }
        
        Logger.info('SubflowParser', `Processing subflow: ${flowName} (depth: ${depth})`);
        this.processedFlows.add(flowName);

        try {
          // Fetch and analyze the referenced subflow
          const subflowMetadata = await this.getSubflowMetadata(flowName);
          const subflowElements = this.countElements(subflowMetadata);
          const dmlOperations = this.countDMLOperations(subflowMetadata);
          const soqlQueries = this.countSOQLQueries(subflowMetadata);
          const complexity = this.calculateComplexity(subflowMetadata);
          
          // Get nested subflows recursively
          const nestedSubflows = await this.extractSubflowReferences(subflowMetadata, depth + 1);
          
          const reference: SubflowReference = {
            name: flowName,
            isInLoop: this.isInLoop(subflow, loopElements),
            parentElement: subflow.name?.[0],
            metadata: subflowMetadata,
            analysis: {
              elements: subflowElements,
              dmlOperations,
              soqlQueries,
              complexity,
              nestedSubflows
            }
          };

          // Extract input assignments
          if (subflow.inputAssignments) {
            const inputs = Array.isArray(subflow.inputAssignments) 
              ? subflow.inputAssignments 
              : [subflow.inputAssignments];
            
            reference.inputAssignments = inputs.map((input: FlowElementMetadata) => ({
              name: input.name?.[0] || '',
              value: input.value?.[0] || '',
              dataType: input.dataType?.[0] || 'String'
            }));
          }

          // Extract output assignments
          if (subflow.outputAssignments) {
            const outputs = Array.isArray(subflow.outputAssignments) 
              ? subflow.outputAssignments 
              : [subflow.outputAssignments];
            
            reference.outputAssignments = outputs.map((output: FlowElementMetadata) => ({
              name: output.name?.[0] || '',
              value: output.value?.[0] || '',
              dataType: output.dataType?.[0] || 'String'
            }));
          }

          references.push(reference);
          Logger.info('SubflowParser', `Successfully analyzed subflow: ${flowName}`, {
            elements: subflowElements.total,
            dmlOperations,
            soqlQueries,
            complexity,
            nestedSubflowCount: nestedSubflows.length,
            isInLoop: reference.isInLoop,
            inputParams: reference.inputAssignments?.length || 0,
            outputParams: reference.outputAssignments?.length || 0
          });
        } catch (error) {
          Logger.error('SubflowParser', `Failed to analyze subflow: ${flowName}`, error);
        }
      }
    }

    return references;
  }
}