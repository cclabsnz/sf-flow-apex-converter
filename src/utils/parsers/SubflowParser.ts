import { Connection } from 'jsforce';
import { FlowMetadata } from '../../types/elements';
import { SubflowReference } from '../interfaces/SubflowTypes.js';
import { MetadataFetcher } from './subflow/MetadataFetcher.js';
import { ReferenceExtractor } from './subflow/ReferenceExtractor.js';

export class SubflowParser {
  private metadataFetcher: MetadataFetcher;
  private referenceExtractor: ReferenceExtractor;

  constructor(private connection: Connection | null) {
    this.metadataFetcher = new MetadataFetcher(connection);
    this.referenceExtractor = new ReferenceExtractor(
      (name: string, active?: boolean, xml?: string) => 
        this.metadataFetcher.getSubflowMetadata(name, active, xml)
    );
  }

  async getSubflowMetadata(
    subflowName: string, 
    requireActive: boolean = true, 
    xmlContent?: string
  ): Promise<FlowMetadata> {
    return this.metadataFetcher.getSubflowMetadata(
      subflowName, 
      requireActive, 
      xmlContent
    );
  }

  async extractSubflowReferences(
    metadata: FlowMetadata, 
    depth: number = 0
  ): Promise<SubflowReference[]> {
    return this.referenceExtractor.extractSubflowReferences(metadata, depth);
  }
}