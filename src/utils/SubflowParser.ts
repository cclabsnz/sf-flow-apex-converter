import { Connection } from 'jsforce';
import { parseStringPromise } from 'xml2js';
import { Logger } from './Logger.js';
import { FlowMetadata, FlowElementMetadata, SubflowReference } from './interfaces/SubflowTypes.js';

export class SubflowParser {
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

    // Parse XML with options to handle arrays consistently
    const metadata = await parseStringPromise(flow.Metadata, {
      explicitArray: true,
      normalizeTags: true,
      valueProcessors: [
        (value: string) => {
          // Convert 'true'/'false' strings to booleans
          if (value.toLowerCase() === 'true') return true;
          if (value.toLowerCase() === 'false') return false;
          return value;
        }
      ]
    });

    // Normalize metadata structure
    const normalizedMetadata = metadata.Flow || metadata;
    
    // Add version info
    return {
      ...normalizedMetadata,
      _flowVersion: {
        version: flow.VersionNumber,
        status: flow.Status,
        lastModified: flow.LastModifiedDate
      }
    };
  }

  extractSubflowReferences(metadata: FlowMetadata): SubflowReference[] {
    const references: SubflowReference[] = [];
    const loopElements = new Set<string>();

    // First, identify all loop elements
    if (metadata.loops) {
      const loops = Array.isArray(metadata.loops) ? metadata.loops : [metadata.loops];
      loops.forEach((loop: FlowElementMetadata) => {
        if (loop.name) loopElements.add(loop.name[0]);
      });
    }

    // Helper to check if an element is in a loop
    const isInLoop = (element: FlowElementMetadata): boolean => {
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
    };

    // Process direct subflow references
    if (metadata.subflows) {
      const subflows = Array.isArray(metadata.subflows) ? metadata.subflows : [metadata.subflows];
      subflows.forEach((subflow: FlowElementMetadata) => {
        const reference: SubflowReference = {
          name: subflow.flowName?.[0] || '',
          isInLoop: isInLoop(subflow),
          parentElement: subflow.name?.[0]
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
      });
    }

    // Process subflows in loops
    if (metadata.loops) {
      const loops = Array.isArray(metadata.loops) ? metadata.loops : [metadata.loops];
      loops.forEach((loop: FlowElementMetadata) => {
        if (loop.elements) {
          const elements = Array.isArray(loop.elements) ? loop.elements : [loop.elements];
          elements.forEach((element: FlowElementMetadata) => {
            if (element.subflow || element.type?.[0] === 'Subflow' || 
                (element.type && !Array.isArray(element.type) && element.type === 'Subflow') || 
                (element.type && Array.isArray(element.type) && element.type.includes('Subflow'))) {
              
              const reference: SubflowReference = {
                name: element.subflow?.[0]?.flowName?.[0] || 
                      element.flowName?.[0] || 
                      element.subflow?.flowName?.[0] || 
                      (element.subflow && typeof element.subflow === 'string' ? element.subflow : ''),
                isInLoop: true,
                parentElement: loop.name?.[0]
              };

              if (element.inputAssignments) {
                const inputs = Array.isArray(element.inputAssignments) 
                  ? element.inputAssignments 
                  : [element.inputAssignments];
                
                reference.inputAssignments = inputs.map((input: FlowElementMetadata) => ({
                  name: input.name?.[0] || '',
                  value: input.value?.[0] || '',
                  dataType: input.dataType?.[0] || 'String'
                }));
              }

              if (element.outputAssignments) {
                const outputs = Array.isArray(element.outputAssignments) 
                  ? element.outputAssignments 
                  : [element.outputAssignments];
                
                reference.outputAssignments = outputs.map((output: FlowElementMetadata) => ({
                  name: output.name?.[0] || '',
                  value: output.value?.[0] || '',
                  dataType: output.dataType?.[0] || 'String'
                }));
              }

              references.push(reference);
            }
          });
        }
      });
    }

    return references;
  }
}