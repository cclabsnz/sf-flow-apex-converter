export type ApexType =
  | { kind: 'Id' }
  | { kind: 'String' }
  | { kind: 'Boolean' }
  | { kind: 'Decimal' }
  | { kind: 'Integer' }
  | { kind: 'Date' }
  | { kind: 'Datetime' }
  /** A concrete SObject when `name` is set; the abstract `SObject` when it is not. */
  | { kind: 'SObject'; name?: string }
  | { kind: 'List'; of: ApexType }
  /** What `record.get()` returns. Deliberately near-useless: see isComparable. */
  | { kind: 'Object' };

export const ID: ApexType = { kind: 'Id' };
export const STRING: ApexType = { kind: 'String' };
export const BOOLEAN: ApexType = { kind: 'Boolean' };
export const DECIMAL: ApexType = { kind: 'Decimal' };
export const INTEGER: ApexType = { kind: 'Integer' };
export const DATE: ApexType = { kind: 'Date' };
export const DATETIME: ApexType = { kind: 'Datetime' };
export const OBJECT: ApexType = { kind: 'Object' };

export function sobjectType(name?: string): ApexType {
  return { kind: 'SObject', name };
}

export function listOf(of: ApexType): ApexType {
  return { kind: 'List', of };
}

export function renderType(type: ApexType): string {
  switch (type.kind) {
    case 'SObject':
      return type.name ?? 'SObject';
    case 'List':
      return `List<${renderType(type.of)}>`;
    default:
      return type.kind;
  }
}

/**
 * Types Apex will accept either side of `<`, `>`, `<=`, `>=`.
 *
 * String is deliberately excluded: Apex's ordering operators cover numeric and
 * date types, and string ordering goes through `compareTo()`. Confidence note —
 * this was checked against secondary sources rather than the official operator
 * reference, which returned 403; if `'a' < 'b'` does compile, add 'String' here
 * and the rest of the module is unaffected. The error message already points a
 * caller at compareTo, so the failure mode is a clear refusal, not wrong output.
 */
export function isComparable(type: ApexType): boolean {
  return ['Decimal', 'Integer', 'Date', 'Datetime'].includes(type.kind);
}

/**
 * True for the one type that carries no information. `record.get()` returns Object,
 * and every relational comparison the 2.0.x generator emitted was against one.
 */
export function isUntyped(type: ApexType): boolean {
  return type.kind === 'Object';
}
