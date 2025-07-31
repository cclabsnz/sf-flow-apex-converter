export interface XMLNode {
  [key: string]: XMLNode | XMLArray<XMLNode | string | number | boolean> | undefined;
}

export type XMLArray<T> = Array<T>;

export type XMLParsedValue<T> = T extends string ? XMLArray<string>
  : T extends number ? XMLArray<number>
  : T extends boolean ? XMLArray<boolean>
  : T extends XMLNode ? XMLArray<T>
  : never;

export interface XMLSerializable {
  toXML(): string;
}