import { parseStringPromise } from 'xml2js';
import { Logger } from '../Logger.js';
import { FlowMetadata } from '../interfaces/SubflowTypes.js';

export enum MetadataFormat {
  JSON = 'JSON',
  XML = 'XML',
  UNKNOWN = 'UNKNOWN'
}

export class MetadataParser {
  static detectFormat(metadata: any): MetadataFormat {
    if (!metadata) return MetadataFormat.UNKNOWN;
    
    // Check if it's already a parsed JSON object
    if (typeof metadata === 'object' && !Buffer.isBuffer(metadata)) {
      Logger.debug('MetadataParser', 'Detected JSON format');
      return MetadataFormat.JSON;
    }

    // Check if it's an XML string
    if (typeof metadata === 'string' && metadata.trim().startsWith('<?xml')) {
      Logger.debug('MetadataParser', 'Detected XML format');
      return MetadataFormat.XML;
    }

    // Check if it's a string that might be XML without declaration
    if (typeof metadata === 'string' && metadata.trim().startsWith('<')) {
      Logger.debug('MetadataParser', 'Detected potential XML format without declaration');
      return MetadataFormat.XML;
    }

    Logger.warn('MetadataParser', 'Unknown metadata format', { 
      type: typeof metadata,
      sample: typeof metadata === 'string' ? metadata.substring(0, 100) : metadata 
    });
    return MetadataFormat.UNKNOWN;
  }

  static async parseMetadata(metadata: any): Promise<FlowMetadata> {
    const format = this.detectFormat(metadata);
    Logger.info('MetadataParser', `Parsing metadata as ${format}`);

    switch (format) {
      case MetadataFormat.JSON:
        return this.parseJsonMetadata(metadata);
      case MetadataFormat.XML:
        return this.parseXmlMetadata(metadata);
      default:
        throw new Error(`Unsupported metadata format: ${format}`);
    }
  }

  private static async parseXmlMetadata(xmlData: string): Promise<FlowMetadata> {
    try {
      const parsed = await parseStringPromise(xmlData, {
        explicitArray: true,
        normalizeTags: true,
        valueProcessors: [
          (value: string) => {
            // Convert 'true'/'false' strings to booleans
            if (value.toLowerCase() === 'true') return true;
            if (value.toLowerCase() === 'false') return false;
            return value;
          }
        ],
        preserveChildrenOrder: true,
        mergeAttrs: false,
        ignoreAttrs: false
      });

      Logger.debug('MetadataParser', 'Successfully parsed XML metadata');
      return parsed.Flow || parsed;
    } catch (error) {
      Logger.error('MetadataParser', 'Failed to parse XML metadata', error);
      throw new Error(`Failed to parse XML metadata: ${error.message}`);
    }
  }

  private static parseJsonMetadata(jsonData: any): FlowMetadata {
    try {
      // If it's a string that might be JSON, try to parse it
      if (typeof jsonData === 'string') {
        try {
          jsonData = JSON.parse(jsonData);
        } catch (e) {
          Logger.warn('MetadataParser', 'Failed to parse JSON string, treating as raw metadata');
        }
      }

      // Ensure we have a Flow property if needed
      const metadata = jsonData.Flow || jsonData;

      // Normalize arrays
      return this.normalizeArrays(metadata);
    } catch (error) {
      Logger.error('MetadataParser', 'Failed to parse JSON metadata', error);
      throw new Error(`Failed to parse JSON metadata: ${error.message}`);
    }
  }

  private static normalizeArrays(metadata: any): any {
    if (!metadata || typeof metadata !== 'object') {
      return metadata;
    }

    // Known array fields in Flow metadata
    const arrayFields = [
      'recordLookups',
      'recordCreates',
      'recordUpdates',
      'recordDeletes',
      'decisions',
      'loops',
      'assignments',
      'actionCalls',
      'subflows',
      'steps',
      'nodes',
      'inputAssignments',
      'outputAssignments',
      'processMetadataValues'
    ];

    const normalized: any = Array.isArray(metadata) ? [] : {};

    for (const [key, value] of Object.entries(metadata)) {
      if (arrayFields.includes(key) && value && !Array.isArray(value)) {
        // Convert to array if it's a known array field
        normalized[key] = [this.normalizeArrays(value)];
      } else if (Array.isArray(value)) {
        // Recursively normalize array elements
        normalized[key] = value.map(item => this.normalizeArrays(item));
      } else if (value && typeof value === 'object') {
        // Recursively normalize nested objects
        normalized[key] = this.normalizeArrays(value);
      } else {
        // Keep primitive values as is
        normalized[key] = value;
      }
    }

    return normalized;
  }
}