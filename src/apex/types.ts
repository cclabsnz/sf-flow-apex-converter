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
 * Settled against the compiler, not a doc page. Each candidate was compiled as
 * `x < y` in a Developer Edition org (API 67): Decimal, Integer, Date, Datetime,
 * String and Id compile; Boolean, Object and SObject are rejected outright.
 *
 * String was excluded here on an earlier unverified assumption that ordering went
 * through `compareTo()`. It does not — `'apple' < 'banana'` compiles and is true.
 * Worth knowing when reading generated output: the comparison is case-insensitive
 * (`'Z' < 'a'` is false), which is NOT what String.compareTo does.
 *
 * Object stays out on purpose. It is what record.get() returns, and refusing it
 * is the whole defence against `record.get('Amount') > 1000` — see isUntyped.
 */
export function isComparable(type: ApexType): boolean {
  return ['Decimal', 'Integer', 'Date', 'Datetime', 'String', 'Id'].includes(type.kind);
}

/**
 * True for the one type that carries no information. `record.get()` returns Object,
 * and every relational comparison the 2.0.x generator emitted was against one.
 */
export function isUntyped(type: ApexType): boolean {
  return type.kind === 'Object';
}
