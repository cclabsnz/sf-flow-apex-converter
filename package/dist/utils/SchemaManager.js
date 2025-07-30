export class SchemaManager {
    constructor(connection) {
        this.connection = connection;
        this.schemaCache = new Map();
    }
    async getObjectSchema(objectName) {
        if (this.schemaCache.has(objectName)) {
            return this.schemaCache.get(objectName);
        }
        try {
            const describe = await this.connection.describe(objectName);
            const schema = {
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
        }
        catch (error) {
            const err = error;
            throw new Error(`Failed to fetch schema for ${objectName}: ${err.message}`);
        }
    }
    async validateField(objectName, fieldName) {
        try {
            const schema = await this.getObjectSchema(objectName);
            return schema.fields.has(fieldName);
        }
        catch {
            return false;
        }
    }
    async getFieldType(objectName, fieldName) {
        try {
            const schema = await this.getObjectSchema(objectName);
            return schema.fields.get(fieldName)?.type || null;
        }
        catch {
            return null;
        }
    }
    async getRelationshipFields(objectName) {
        const relationships = new Map();
        try {
            const schema = await this.getObjectSchema(objectName);
            schema.fields.forEach(field => {
                if (field.referenceTo && field.referenceTo.length > 0) {
                    field.referenceTo.forEach(refObject => {
                        if (!relationships.has(refObject)) {
                            relationships.set(refObject, []);
                        }
                        relationships.get(refObject).push(field.name);
                    });
                }
            });
        }
        catch (error) {
            const err = error;
            console.warn(`Error getting relationships for ${objectName}: ${err.message}`);
        }
        return relationships;
    }
}
//# sourceMappingURL=SchemaManager.js.map