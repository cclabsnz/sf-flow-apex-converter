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
  | { kind: 'Object' }
  /** The type of the `null` literal. Assignable to everything; orderable against nothing. */
  | { kind: 'Null' };

export const ID: ApexType = { kind: 'Id' };
export const STRING: ApexType = { kind: 'String' };
export const BOOLEAN: ApexType = { kind: 'Boolean' };
export const DECIMAL: ApexType = { kind: 'Decimal' };
export const INTEGER: ApexType = { kind: 'Integer' };
export const DATE: ApexType = { kind: 'Date' };
export const DATETIME: ApexType = { kind: 'Datetime' };
export const OBJECT: ApexType = { kind: 'Object' };
export const NULL: ApexType = { kind: 'Null' };

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
    case 'Null':
      // A null literal needs no type in Apex source. If this ever renders, a
      // caller has used NULL as a declared type, which is a bug in the caller.
      return 'Object';
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


/** Apex identifiers and object names are case-insensitive; comparisons must be too. */
export function sameName(a: string | undefined, b: string | undefined): boolean {
  return a?.toLowerCase() === b?.toLowerCase();
}

/**
 * True when Apex will assign a value of `source` to a slot of `target`.
 *
 * The permitted widenings were confirmed against the compiler, not assumed:
 * Integer -> Decimal, Id <-> String and Date -> Datetime all assign cleanly,
 * while Decimal -> Integer and Integer -> String are rejected outright
 * ("Illegal assignment from String to Decimal").
 *
 * Object is asymmetric on purpose. Everything assigns TO Object, but Object
 * assigns to nothing without an explicit cast — which is the same defence
 * isUntyped provides for comparisons, applied to assignment.
 */
export function isAssignable(target: ApexType, source: ApexType): boolean {
  if (target.kind === 'Object') return true;
  // Verified against the compiler: Decimal, Integer, Boolean, Date, Id, SObject
  // and List all accept `= null`.
  if (source.kind === 'Null') return true;
  if (source.kind === 'Object') return false;
  if (target.kind === 'List' && source.kind === 'List') {
    // Related in EITHER direction. Verified against the compiler, which is more
    // permissive than Java here: List<Account> -> List<SObject> assigns, and so
    // does List<SObject> -> List<Account>, as does List<Integer> -> List<Decimal>.
    // Only unrelated elements are refused (List<Account> -> List<Contact>).
    return isAssignable(target.of, source.of) || isAssignable(source.of, target.of);
  }
  if (target.kind === 'SObject' && source.kind === 'SObject') {
    // The abstract SObject accepts any concrete one; a concrete one accepts only
    // itself, compared case-insensitively because Apex is: `Account a; account b = a;`
    // compiles. The two names reaching here come from different places — Flow XML
    // as the admin typed it, and a describe in canonical casing — so they differ
    // in practice, and a case-sensitive match would reject a valid conversion.
    return target.name === undefined || sameName(target.name, source.name);
  }
  if (target.kind === source.kind) return true;
  const widenings: ReadonlyArray<readonly [string, string]> = [
    ['Integer', 'Decimal'],
    ['Id', 'String'],
    ['String', 'Id'],
    ['Date', 'Datetime'],
  ];
  return widenings.some(([from, to]) => source.kind === from && target.kind === to);
}
