export interface SecurityContext {
  isSystemMode: boolean;
  enforceObjectPermissions: boolean;
  enforceFieldPermissions: boolean;
  enforceSharingRules: boolean;
  requiredPermissions: Set<string>;
  requiredObjects: Set<string>;
  requiredFields: Map<string, Set<string>>;
}