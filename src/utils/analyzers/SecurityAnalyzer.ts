import { SecurityContext } from '../../types';
import { FlowElementType } from '../../types';
import { XMLNode } from '../types/XMLNode';

export class SecurityAnalyzer {
  private getXMLValue<T>(value: unknown): T | undefined {
    if (Array.isArray(value) && value.length > 0) {
      return value[0] as T;
    }
    return undefined;
  }

  analyzeSecurityContext(metadata: XMLNode | Record<string, any>): SecurityContext {
    const securityContext: SecurityContext = {
      isSystemMode: this.getXMLValue<string>(metadata.runInMode) === 'SYSTEM' || false,
      enforceObjectPermissions: this.getXMLValue<string>(metadata.runInMode) === 'USER' || false,
      enforceFieldPermissions: this.getXMLValue<string>(metadata.runInMode) === 'USER' || false,
      enforceSharingRules: this.getXMLValue<string>(metadata.runInMode) === 'USER' || false,
      requiredPermissions: new Set<string>(),
      requiredObjects: new Set<string>(),
      requiredFields: new Map<string, Set<string>>()
    };

    for (const elementType of Object.values(FlowElementType)) {
      if (metadata[elementType]) {
        const elements = Array.isArray(metadata[elementType]) ? metadata[elementType] : [metadata[elementType]];
        
        elements.forEach((element: any) => {
          const objectName = this.getXMLValue<string>(element.object);
          if (objectName) {
            securityContext.requiredObjects.add(objectName);

            if (elementType === FlowElementType.RECORD_CREATE) {
              securityContext.requiredPermissions.add(`Create_${objectName}`);
            }
            if (elementType === FlowElementType.RECORD_UPDATE) {
              securityContext.requiredPermissions.add(`Edit_${objectName}`);
            }
            if (elementType === FlowElementType.RECORD_DELETE) {
              securityContext.requiredPermissions.add(`Delete_${objectName}`);
            }
            if (elementType === FlowElementType.RECORD_LOOKUP) {
              securityContext.requiredPermissions.add(`Read_${objectName}`);
            }
          }

          if (element.fields) {
            const objectName = element.object?.[0];
            if (objectName) {
              const fields = new Set<string>();
              element.fields.forEach((field: any) => {
                fields.add(field);
              });
              securityContext.requiredFields.set(objectName, fields);
            }
          }
        });
      }
    }

    return securityContext;
  }
}