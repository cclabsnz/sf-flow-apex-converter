import { Logger } from './Logger.js';
import { SecurityContext, ComprehensiveFlowAnalysis } from './FlowAnalyzer.js';
import { TestClassGenerator } from './TestClassGenerator.js';
import { DeploymentManager, DeploymentResult } from './DeploymentManager.js';
import { OrgValidator } from './OrgValidator.js';
import { BulkPatternGenerator } from './BulkPatternGenerator.js';
import { FlowBulkificationException } from './FlowBulkificationException.js';
import { Connection } from 'jsforce';

export class ApexGenerator {
  private static testGenerator: TestClassGenerator = new TestClassGenerator();
  private static deploymentManager: DeploymentManager = new DeploymentManager();
  private static orgSchemas: Map<string, any> = new Map();
  private static bulkGenerator: BulkPatternGenerator = new BulkPatternGenerator();

  static generateApex(flowAnalysis: ComprehensiveFlowAnalysis): string {
    Logger.info('ApexGenerator', 'Starting Apex generation');
    Logger.debug('ApexGenerator', 'Flow analysis input', flowAnalysis);

    try {
      const className = this.formatClassName(flowAnalysis.flowName);
      const classContent = this.generateClassContent(className, flowAnalysis);
      return classContent;
    } catch (error) {
      Logger.error('ApexGenerator', 'Failed to generate Apex code', error);
      throw error;
    }
  }

  static async deployApex(
    flowAnalysis: ComprehensiveFlowAnalysis,
    validateOnly: boolean = false,
    targetOrg?: string,
    connection?: Connection
  ): Promise<DeploymentResult> {
    // Validate against org first
    if (connection) {
      const validator = new OrgValidator(connection);
      const validationResult = await validator.validateForOrg(flowAnalysis, targetOrg);
      
      if (!validationResult.isValid) {
        return {
          success: false,
          errors: validationResult.errors,
          testResults: []
        };
      }

      // Add validation warnings and recommendations to the generation
      validationResult.warnings.forEach(warning => {
        Logger.warn('ApexGenerator', warning);
      });
      validationResult.recommendations.forEach(rec => {
        Logger.info('ApexGenerator', `Recommendation: ${rec}`);
      });

      // Use org schema for better type mapping
      this.orgSchemas = validationResult.objectSchemas;
    }
    const className = this.formatClassName(flowAnalysis.flowName);
    const classContent = this.generateApex(flowAnalysis);
    const testClassName = `${className}_Test`;
    const testClassContent = this.testGenerator.generateTestClass(
      className,
      flowAnalysis.securityContext,
      flowAnalysis.apiVersion
    );

    return this.deploymentManager.deployApexClass(
      className,
      classContent,
      testClassName,
      testClassContent,
      targetOrg
    );
  }

  private static formatClassName(flowName: string): string {
    // Remove spaces and special characters, ensure valid Apex class name
    return flowName.replace(/[^a-zA-Z0-9]/g, '_');
  }

  private static generateClassContent(className: string, analysis: ComprehensiveFlowAnalysis): string {
    const securityAnnotations = this.generateSecurityAnnotations(analysis.securityContext);
    const sharingKeyword = analysis.securityContext.enforceSharingRules ? 'with sharing' : 'without sharing';
    
    return `${securityAnnotations}
public ${sharingKeyword} class ${className} {
    public static void execute() {
        // Security checks
        ${this.generateSecurityChecks(analysis.securityContext)}

        // Bulkified flow logic
        try {
            ${this.bulkGenerator.generateBulkCode(analysis)}
        } catch (FlowBulkificationException e) {
            throw new FlowBulkificationException('Flow execution failed: ' + e.getMessage());
        }
    }

    private static void checkAccess() {
        ${this.generateAccessChecks(analysis.securityContext)}
    }

    // Input data structure for bulk processing
    private class FlowInputRecord {
        private Map<String, Object> values = new Map<String, Object>();
        
        public Object get(String field) {
            return values.get(field);
        }
        
        public void put(String field, Object value) {
            values.put(field, value);
        }
    }

    // Custom exception for bulkification errors
    public class FlowBulkificationException extends Exception {}
}`;
  }

  private static generateSecurityAnnotations(context: SecurityContext): string {
    const annotations = [];
    
    if (context.enforceObjectPermissions) {
      annotations.push('@SuppressWarnings(\'PMD.ApexCRUDViolation\')');
    }
    
    return annotations.join('\n');
  }

  private static generateSecurityChecks(context: SecurityContext): string {
    if (!context.enforceObjectPermissions) {
      return '// Running in system mode - no security checks needed';
    }

    return 'checkAccess();';
  }

  private static generateAccessChecks(context: SecurityContext): string {
    if (!context.enforceObjectPermissions) {
      return '';
    }

    const checks = [];
    context.requiredObjects.forEach(obj => {
      const perms = Array.from(context.requiredPermissions)
        .filter(p => p.endsWith(`_${obj}`))
        .map(p => p.split('_')[0].toLowerCase());

      if (perms.length > 0) {
        checks.push(`
        if (!Schema.${obj}.SObjectType.isAccessible()) {
            throw new System.NoAccessException('Insufficient access rights on ${obj}');
        }`);
      }
    });

    return checks.join('\n');
  }

  private static generateFlowLogic(analysis: ComprehensiveFlowAnalysis): string {
    // TODO: Implement actual flow logic generation
    return '// TODO: Implement flow logic';
  }
}