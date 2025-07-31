export type XMLArray<T> = Array<T>;

export interface XMLFlowVersion {
  version: string;
  status: string;
  lastModified: string;
}

export type XMLValue = string | number | boolean;

export interface XMLNodeBase {
  _flowVersion?: XMLFlowVersion;
  [key: string]: XMLValue | Record<string, any> | XMLArray<any> | undefined;
}

export interface XMLNode extends XMLNodeBase {}