import { Connection } from 'jsforce';

export interface FieldDefinition {
  name: string;
  type: string;
  label: string;
  referenceTo?: string[];
  relationshipName?: string;
  required: boolean;
}

export interface ObjectSchema {
  name: string;
  label: string;
  fields: Map<string, FieldDefinition>;
  recordTypes: Map<string, string>;
}

export class SchemaManager {
  private schemaCache = new Map<string, ObjectSchema>();

  constructor(private connection: Connection) {}

  async getObjectSchema(objectName: string): Promise<ObjectSchema> {
    if (this.schemaCache.has(objectName)) {
      return this.schemaCache.get(objectName)!;
    }

    try {
      const describe = await this.connection.describe(objectName);
      
      const schema: ObjectSchema = {
        name: describe.name,
        label: describe.label,
        fields: new Map(),
        recordTypes: new Map()
      };

      // Process fields
      describe.fields.forEach(field => {
        schema.fields.set(field.name, {
          name: field.name,
          type: field.type,
          label: field.label,
          referenceTo: field.referenceTo || undefined,
          relationshipName: field.relationshipName || undefined,
          required: field.nillable === false && !field.defaultedOnCreate
        });
      });

      // Process record types
      describe.recordTypeInfos.forEach(rt => {
        if (rt.available && !rt.master) {
          schema.recordTypes.set(rt.name, rt.recordTypeId);
        }
      });

      this.schemaCache.set(objectName, schema);
      return schema;

    } catch (error) {
      const err = error as Error;
      throw new Error(`Failed to fetch schema for ${objectName}: ${err.message}`);
    }
  }

  async validateField(objectName: string, fieldName: string): Promise<boolean> {
    try {
      const schema = await this.getObjectSchema(objectName);
      return schema.fields.has(fieldName);
    } catch {
      return false;
    }
  }

  async getFieldType(objectName: string, fieldName: string): Promise<string | null> {
    try {
      const schema = await this.getObjectSchema(objectName);
      return schema.fields.get(fieldName)?.type || null;
    } catch {
      return null;
    }
  }

  async getRelationshipFields(objectName: string): Promise<Map<string, string[]>> {
    const relationships = new Map<string, string[]>();
    
    try {
      const schema = await this.getObjectSchema(objectName);
      
      schema.fields.forEach(field => {
        if (field.referenceTo && field.referenceTo.length > 0) {
          field.referenceTo.forEach(refObject => {
            if (!relationships.has(refObject)) {
              relationships.set(refObject, []);
            }
            relationships.get(refObject)!.push(field.name);
          });
        }
      });
      
    } catch (error) {
      const err = error as Error;
      console.warn(`Error getting relationships for ${objectName}: ${err.message}`);
    }
    
    return relationships;
  }
}