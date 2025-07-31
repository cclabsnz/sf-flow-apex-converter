import { FlowMetadata, FlowElementMetadata } from '../types/elements';
import { SecurityContext } from '../types/security';
import { Logger } from './Logger';

export class SecurityAnalyzer {
  analyzeSecurityContext(metadata: FlowMetadata): SecurityContext {
    Logger.debug('SecurityAnalyzer', 'Analyzing security context');
    
    const isSystemMode = Array.isArray(metadata.runInMode) && metadata.runInMode[0] === 'System';
    const enforceSharingRules = this.hasSharingRulesChecks(metadata);
    const enforceObjectPermissions = this.hasObjectPermissionChecks(metadata);
    const enforceFieldPermissions = this.hasFieldLevelSecurityChecks(metadata);
    const requiredPermissions = this.getCustomPermissions(metadata);
    const { requiredObjects, requiredFields } = this.getFieldAndObjectRequirements(metadata);
    
    return {
      isSystemMode,
      enforceObjectPermissions,
      enforceFieldPermissions,
      enforceSharingRules,
      requiredPermissions,
      requiredObjects,
      requiredFields
    };
  }

  private hasSharingRulesChecks(metadata: FlowMetadata): boolean {
    if (!metadata.sharingRules?.[0]?.enforced) return false;
    const enforced = metadata.sharingRules[0].enforced;
    return Array.isArray(enforced) && enforced[0] === 'true';
  }

  private hasObjectPermissionChecks(metadata: FlowMetadata): boolean {
    if (!metadata.objectPermissions?.[0]?.enforced) return false;
    const enforced = metadata.objectPermissions[0].enforced;
    return Array.isArray(enforced) && enforced[0] === 'true';
  }

  private hasFieldLevelSecurityChecks(metadata: FlowMetadata): boolean {
    if (!metadata.fieldPermissions?.[0]?.enforced) return false;
    const enforced = metadata.fieldPermissions[0].enforced;
    return Array.isArray(enforced) && enforced[0] === 'true';
  }

  private getCustomPermissions(metadata: FlowMetadata): Set<string> {
    const permissions = new Set<string>();
    
    if (metadata.customPermissions) {
      const perms = Array.isArray(metadata.customPermissions) 
        ? metadata.customPermissions 
        : [metadata.customPermissions];
      
      perms.forEach(perm => {
        if (Array.isArray(perm.name)) {
          permissions.add(perm.name[0]);
        }
      });
    }
    
    return permissions;
  }

  private getFieldAndObjectRequirements(metadata: FlowMetadata): {
    requiredObjects: Set<string>;
    requiredFields: Map<string, Set<string>>;
  } {
    const requiredObjects = new Set<string>();
    const requiredFields = new Map<string, Set<string>>();

    const addObjectField = (obj: string, field?: string) => {
      requiredObjects.add(obj);
      if (field) {
        if (!requiredFields.has(obj)) {
          requiredFields.set(obj, new Set());
        }
        requiredFields.get(obj)!.add(field);
      }
    };

    // Check record creates
    if (metadata.recordCreates) {
      const creates = Array.isArray(metadata.recordCreates) 
        ? metadata.recordCreates 
        : [metadata.recordCreates];
      
      creates.forEach((create: FlowElementMetadata) => {
        if (Array.isArray(create.object) && create.object[0]) {
          const obj = create.object[0];
          addObjectField(obj);
          
          if (Array.isArray(create.fields)) {
            create.fields.forEach((field: { name: string[] }) => {
              if (Array.isArray(field.name) && field.name[0]) {
                addObjectField(obj, field.name[0]);
              }
            });
          }
        }
      });
    }

    // Similar checks for recordUpdates, recordDeletes, recordLookups
    // [... similar code for other operations]

    return { requiredObjects, requiredFields };
  }
}