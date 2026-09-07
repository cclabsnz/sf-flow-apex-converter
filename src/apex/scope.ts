/**
 * Words the Apex compiler rejects as a local variable name.
 *
 * Verified empirically rather than copied from a doc page: each word below was
 * compiled as `Integer <word> = 1;` against a Developer Edition org (API 67) and
 * rejected. Words that a keyword list would suggest but the compiler actually
 * accepts — id, order, count, type, transient, with, sharing, without, native,
 * throws, assert, to, future, search, savepoint, runas — are deliberately absent,
 * because guarding them would rename identifiers for no reason.
 *
 * Stored lowercase and matched case-insensitively: Apex is a case-insensitive
 * language, and `Integer List = 1;` fails exactly as `Integer list = 1;` does.
 */
const RESERVED: ReadonlySet<string> = new Set([
  // Declaration and modifier keywords
  'abstract', 'class', 'const', 'enum', 'extends', 'final', 'global', 'implements',
  'interface', 'override', 'package', 'private', 'protected', 'public', 'static',
  'synchronized', 'testmethod', 'virtual', 'webservice',
  // Control flow
  'break', 'case', 'catch', 'continue', 'default', 'do', 'else', 'exit', 'finally',
  'for', 'goto', 'if', 'loop', 'return', 'switch', 'then', 'throw', 'try', 'when',
  'while',
  // Values and operators
  'as', 'cast', 'instanceof', 'new', 'null', 'super', 'this', 'true', 'false',
  // Types
  'any', 'array', 'blob', 'boolean', 'byte', 'char', 'currency', 'date', 'datetime',
  'decimal', 'double', 'float', 'int', 'integer', 'list', 'long', 'map', 'number',
  'object', 'set', 'short', 'string', 'time', 'void',
  // DML and SOQL
  'and', 'asc', 'begin', 'by', 'commit', 'delete', 'desc', 'export', 'from', 'group',
  'having', 'import', 'in', 'inner', 'insert', 'into', 'join', 'like', 'limit',
  'merge', 'not', 'of', 'on', 'or', 'outer', 'rollback', 'select', 'sort', 'undelete',
  'update', 'upsert', 'using', 'where',
  // Platform
  'exception', 'system', 'trigger',
]);

/**
 * Allocates Apex identifiers, guaranteeing each is valid and unique.
 *
 * Both of this project's identifier defects came from string concatenation with
 * no notion of a name: two lookups each declared `relatedRecords`, and a method
 * name was built by appending a suffix that the sanitiser had already added,
 * producing validateX_Bulkified_Bulkified. Allocation removes the possibility.
 */
export class Scope {
  private readonly taken = new Set<string>();

  constructor(private readonly parent?: Scope) {}

  /** True when this scope, or any ancestor, has allocated the name. */
  has(name: string): boolean {
    return this.taken.has(name) || (this.parent?.has(name) ?? false);
  }

  /**
   * A valid, unique Apex identifier close to `preferred`. Collisions get a numeric
   * suffix rather than being silently reused.
   */
  allocate(preferred: string): string {
    const base = Scope.sanitise(preferred);
    if (!this.has(base)) {
      this.taken.add(base);
      return base;
    }
    for (let n = 2; ; n += 1) {
      const candidate = `${base}${n}`;
      if (!this.has(candidate)) {
        this.taken.add(candidate);
        return candidate;
      }
    }
  }

  /** A nested scope: sees the parent's names, but does not add to them. */
  child(): Scope {
    return new Scope(this);
  }

  private static sanitise(name: string): string {
    const cleaned = name
      .replace(/[^A-Za-z0-9_]/g, '_')
      .replace(/_+/g, '_')  // Collapse underscore runs
      .replace(/_+$/, '');  // Strip trailing underscores
    if (cleaned === '' || /^_+$/.test(cleaned)) return 'v';
    // Prefix if starts with digit or underscore, removing any leading underscores
    if (/^[0-9_]/.test(cleaned)) {
      const noLeading = cleaned.replace(/^_+/, '');
      return `v${noLeading}`;
    }
    // Same prefix rule for a name that collides with a keyword. Prefixing can never
    // produce another reserved word, so one pass is enough.
    if (RESERVED.has(cleaned.toLowerCase())) return `v${cleaned}`;
    return cleaned;
  }
}
