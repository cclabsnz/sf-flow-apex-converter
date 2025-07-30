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
export declare class SchemaManager {
    private connection;
    private schemaCache;
    constructor(connection: Connection);
    getObjectSchema(objectName: string): Promise<ObjectSchema>;
    validateField(objectName: string, fieldName: string): Promise<boolean>;
    getFieldType(objectName: string, fieldName: string): Promise<string | null>;
    getRelationshipFields(objectName: string): Promise<Map<string, string[]>>;
}
