import { Connection as SfConnection } from '@salesforce/core';
import { Connection as JsforceConnection, Schema } from 'jsforce';

export function adaptConnection(conn: SfConnection): JsforceConnection<Schema> {
  const jsforce = conn as unknown as { _jsforce: JsforceConnection<Schema> };
  return jsforce._jsforce;
}