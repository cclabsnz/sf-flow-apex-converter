import { FlowElement } from '../../types';

interface BaseBulkOperation {
  elements: FlowElement[];
  type: 'QUERY' | 'DML';
}

export interface QueryOperation extends BaseBulkOperation {
  type: 'QUERY';
  objectType: string;
  fields: string[];
  conditions: string[];
  sortOrder?: string[];
}

export interface DMLOperation extends BaseBulkOperation {
  type: 'DML';
  objectType: string;
  operation: string;
  fields: string[];
}

export type BulkOperation = QueryOperation | DMLOperation;