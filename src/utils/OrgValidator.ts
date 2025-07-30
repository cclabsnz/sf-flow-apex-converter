import { Connection } from 'jsforce';
import { Logger } from './Logger.js';
import { ComprehensiveFlowAnalysis } from './FlowAnalyzer.js';
import { execSync } from 'child_process';

interface ObjectSchema {
  fields: Map<string, FieldSchema>;
  isCustom: boolean;
  hasRecordTypes: boolean;
  sharingModel: string;
}

interface FieldSchema {
  type: string;
  length?: number;
  isCustom: boolean;
  isRequired: boolean;
  referenceTo?: string[];
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  recommendations: string[];
  objectSchemas: Map<string, ObjectSchema>;
}

export class OrgValidator {
  private objectSchemas: Map<string, ObjectSchema> = new Map();

  constructor(private connection: Connection) {}

  async validateForOrg(
    analysis: ComprehensiveFlowAnalysis,
    targetOrg?: string
  ): Promise<ValidationResult> {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      recommendations: [],
      objectSchemas: this.objectSchemas
    };

    try {
      // Check org limits
      await this.checkOrgLimits(result, targetOrg);

      // Validate objects and fields
      await this.validateObjects(analysis, result);

      // Check naming conventions
      this.validateNamingConventions(analysis, result);

      // Check code coverage requirements
      await this.checkCodeCoverage(result, targetOrg);

      // Validate API version compatibility
      await this.validateApiVersion(analysis, result, targetOrg);

      result.isValid = result.errors.length === 0;
    } catch (error) {
      Logger.error('OrgValidator', 'Validation failed', error);
      result.isValid = false;
      result.errors.push(`Validation error: ${(error as Error).message}`);
    }

    return result;
  }

  private async checkOrgLimits(result: ValidationResult, targetOrg?: string): Promise<void> {
    try {
      // Get org limits using SF CLI
      const limitsCmd = `sf limits api display --json${targetOrg ? ` -o ${targetOrg}` : ''}`;
      const limitsOutput = execSync(limitsCmd, { encoding: 'utf8' });
      const limits = JSON.parse(limitsOutput);

      // Check relevant limits
      const criticalLimits = [
        'ApexClassesUsed',
        'ApexTestsQueued',
        'DataStorageMB',
        'DailyApiRequests'
      ];

      criticalLimits.forEach(limit => {
        const limitInfo = limits.result.find((l: any) => l.name === limit);
        if (limitInfo) {
          const usagePercentage = (limitInfo.used / limitInfo.max) * 100;
          if (usagePercentage > 90) {
            result.warnings.push(`${limit} is at ${usagePercentage.toFixed(1)}% of limit`);
          }
        }
      });
    } catch (error) {
      Logger.warn('OrgValidator', 'Failed to check org limits', error);
    }
  }

  private async validateObjects(
    analysis: ComprehensiveFlowAnalysis,
    result: ValidationResult
  ): Promise<void> {
    const requiredObjects = Array.from(analysis.objectDependencies);

    // Get object schemas
    for (const objectName of requiredObjects) {
      try {
        const describe = await this.connection.describe(objectName);
        const schema: ObjectSchema = {
          fields: new Map(),
          isCustom: Boolean(describe.custom),
          hasRecordTypes: describe.recordTypeInfos?.length > 0 || false,
          sharingModel: describe.custom ? 'Private' : 'Public'
        };

        describe.fields.forEach(field => {
          schema.fields.set(field.name, {
            type: field.type,
            length: field.length,
            isCustom: field.custom,
            isRequired: field.nillable === false && field.defaultedOnCreate === false,
            referenceTo: field.referenceTo || []
          });
        });

        this.objectSchemas.set(objectName, schema);

        // Validate sharing model compatibility
        if (analysis.securityContext.enforceSharingRules && 
            schema.sharingModel === 'Private') {
          result.warnings.push(
            `Object ${objectName} has Private sharing model but flow runs in User mode`
          );
        }

      } catch (error) {
        result.errors.push(`Failed to describe object ${objectName}: ${(error as Error).message}`);
      }
    }

    // Validate field references
    analysis.securityContext.requiredFields.forEach((fields, objectName) => {
      const schema = this.objectSchemas.get(objectName);
      if (schema) {
        fields.forEach(fieldName => {
          if (!schema.fields.has(fieldName)) {
            result.errors.push(`Field ${objectName}.${fieldName} not found in org`);
          } else {
            const field = schema.fields.get(fieldName)!;
            if (field.isRequired) {
              result.warnings.push(
                `Required field ${objectName}.${fieldName} must be handled in the generated code`
              );
            }
          }
        });
      }
    });
  }

  private validateNamingConventions(
    analysis: ComprehensiveFlowAnalysis,
    result: ValidationResult
  ): void {
    // Check class name follows conventions
    const className = analysis.flowName.replace(/[^a-zA-Z0-9]/g, '_');
    if (!/^[A-Z][a-zA-Z0-9_]*$/.test(className)) {
      result.errors.push('Class name must start with a capital letter and contain only alphanumeric characters');
    }
    if (className.length > 40) {
      result.warnings.push('Class name should be less than 40 characters');
    }

    // Reserved keywords
    const reservedWords = ['switch', 'class', 'interface', 'void', 'abstract'];
    if (reservedWords.includes(className.toLowerCase())) {
      result.errors.push(`Class name '${className}' is a reserved word in Apex`);
    }
  }

  private async checkCodeCoverage(result: ValidationResult, targetOrg?: string): Promise<void> {
    try {
      // Check org's code coverage requirements
      const settingsCmd = `sf org list apex-test-settings${targetOrg ? ` -o ${targetOrg}` : ''}`;
      const settingsOutput = execSync(settingsCmd, { encoding: 'utf8' });
      
      if (settingsOutput.includes('Disable Parallel Testing')) {
        result.warnings.push('Parallel testing is disabled in the org - deployments may take longer');
      }

      result.recommendations.push(
        'Ensure test class provides at least 75% code coverage',
        'Include positive and negative test scenarios',
        'Use proper @isTest annotation and TestSetup methods'
      );
    } catch (error) {
      Logger.warn('OrgValidator', 'Failed to check code coverage settings', error);
    }
  }

  private async validateApiVersion(
    analysis: ComprehensiveFlowAnalysis,
    result: ValidationResult,
    targetOrg?: string
  ): Promise<void> {
    try {
      // Get org's API version
      const versionCmd = `sf org list api-versions${targetOrg ? ` -o ${targetOrg}` : ''}`;
      const versionOutput = execSync(versionCmd, { encoding: 'utf8' });
      const versions = versionOutput.split('\n').filter(v => v.trim());
      const latestVersion = versions[0];

      const flowVersion = parseInt(analysis.apiVersion);
      const orgVersion = parseInt(latestVersion);

      if (flowVersion > orgVersion) {
        result.errors.push(`Flow API version ${flowVersion} is higher than org API version ${orgVersion}`);
      } else if (flowVersion < orgVersion - 4) {
        result.warnings.push(`Flow API version ${flowVersion} is significantly older than org API version ${orgVersion}`);
      }
    } catch (error) {
      Logger.warn('OrgValidator', 'Failed to validate API version', error);
    }
  }
}