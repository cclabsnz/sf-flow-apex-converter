import { Connection } from 'jsforce';
import { FlowMetadata } from '../types/elements';
import { SubflowReference } from './interfaces/SubflowTypes';
import { MetadataFetcher } from './fetchers/MetadataFetcher';
import { ReferenceExtractor } from './parsers/subflow/ReferenceExtractor';
import { ElementCounter } from './parsers/subflow/ElementCounter';
import { XMLParser } from './parsers/XMLParser';

export class SubflowParser {
  private metadataFetcher: MetadataFetcher;
  private referenceExtractor: ReferenceExtractor;

  constructor(private connection: Connection | null) {
    this.metadataFetcher = new MetadataFetcher(connection);
    this.referenceExtractor = new ReferenceExtractor(this.getSubflowMetadata.bind(this));
  }

  async getSubflowMetadata(subflowName: string, requireActive: boolean = true, xmlContent?: string): Promise<FlowMetadata> {
    const metadata = await this.metadataFetcher.getSubflowMetadata(subflowName, requireActive, xmlContent);
    
    if (!metadata._flowVersion) {
      metadata._flowVersion = {
        version: '1.0',
        status: 'Active',
        lastModified: new Date().toISOString()
      };
    }
    
    return metadata;
  }

  async extractSubflowReferences(metadata: FlowMetadata, depth: number = 0): Promise<SubflowReference[]> {
    return this.referenceExtractor.extractSubflowReferences(metadata, depth);
  }
}