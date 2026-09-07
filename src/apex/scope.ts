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
    return cleaned;
  }
}
