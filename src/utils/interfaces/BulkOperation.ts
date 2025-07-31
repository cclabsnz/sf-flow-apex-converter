export interface BulkOperation {
  operation: string;
  conditions?: Record<string, unknown>;
}

export interface QueryOperation extends BulkOperation {
  conditions: Record<string, unknown>;
}

export interface DMLOperation extends BulkOperation {
  operation: string;
}