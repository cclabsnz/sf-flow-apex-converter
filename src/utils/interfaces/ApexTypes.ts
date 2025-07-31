import { SecurityContext } from './SecurityTypes.js';

export interface ApexClass {
  name: string;
  content: string;
  securityContext: SecurityContext;
  apiVersion: string;
  isTest?: boolean;
}

export interface BulkifiedMethod {
  name: string;
  parameters: BulkMethodParameter[];
  returnType: string;
  body: string;
  bulkSize: number;
}

export interface BulkMethodParameter {
  name: string;
  type: string;
  isList: boolean;
}

export interface FlowInputType {
  name: string;
  fields: Map<string, string>;
}

export interface ApexSecurityConfig {
  enforceSecurity: boolean;
  sharingMode: 'with' | 'without';
  annotations: string[];
  securityChecks: string[];
}

export interface GeneratedApex {
  className: string;
  classContent: string;
  testClassName: string;
  testClassContent: string;
  securityConfig: ApexSecurityConfig;
  bulkMethods: BulkifiedMethod[];
  inputTypes: FlowInputType[];
}
