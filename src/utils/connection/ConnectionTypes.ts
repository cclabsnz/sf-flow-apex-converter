import { Connection as SfConnection } from '@salesforce/core';
import { Connection as JsforceConnection, Schema } from 'jsforce';

export type SalesforceConnection = JsforceConnection<Schema>;
export { SfConnection };