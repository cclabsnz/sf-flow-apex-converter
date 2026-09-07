import { Scope } from '../../src/apex/scope.js';

describe('Scope', () => {
  it('returns the preferred name when it is free', () => {
    expect(new Scope().allocate('relatedRecords')).toBe('relatedRecords');
  });

  it('never returns the same name twice', () => {
    // Two record lookups both wanted `relatedRecords`, and the generator
    // declared it twice in one method.
    const s = new Scope();
    expect(s.allocate('relatedRecords')).toBe('relatedRecords');
    expect(s.allocate('relatedRecords')).toBe('relatedRecords2');
    expect(s.allocate('relatedRecords')).toBe('relatedRecords3');
  });

  it('sanitises a name into a valid Apex identifier', () => {
    expect(new Scope().allocate('Get Pricing-Streams')).toBe('Get_Pricing_Streams');
  });

  it('prefixes a name that starts with a digit', () => {
    expect(new Scope().allocate('2ndPass')).toBe('v2ndPass');
  });

  it('falls back when a name sanitises to nothing', () => {
    expect(new Scope().allocate('---')).toBe('v');
  });

  it('reports what it has allocated', () => {
    const s = new Scope();
    s.allocate('total');
    expect(s.has('total')).toBe(true);
    expect(s.has('other')).toBe(false);
  });

  it('a child sees the parent names and cannot shadow them', () => {
    const parent = new Scope();
    parent.allocate('record');
    expect(parent.child().allocate('record')).toBe('record2');
  });

  it('a child allocation does not leak into the parent', () => {
    const parent = new Scope();
    parent.child().allocate('temp');
    expect(parent.has('temp')).toBe(false);
  });

  it('removes leading punctuation and collapse underscore runs', () => {
    // Flow element labels commonly carry parenthetical or leading-punctuation
    // prefixes. The identifier must start with a letter, and double underscores
    // should not appear.
    const result = new Scope().allocate('(Sync) Update');
    expect(/^[A-Za-z]/.test(result)).toBe(true);
    expect(result).not.toContain('__');
  });

  it('prefixes a name that starts with an underscore', () => {
    const result = new Scope().allocate('_leading');
    expect(/^[A-Za-z]/.test(result)).toBe(true);
  });

  it('falls back when a name is only underscores', () => {
    expect(new Scope().allocate('__')).toBe('v');
  });

  it('never returns an Apex reserved word', () => {
    // A Flow element genuinely named "Update" or "Case" sanitises to a keyword,
    // and `Integer update = ...` does not compile. Verified against the compiler:
    // every word in RESERVED was rejected as a local variable name.
    for (const word of ['public', 'class', 'update', 'delete', 'case', 'list', 'limit']) {
      expect(new Scope().allocate(word)).not.toBe(word);
    }
  });

  it('guards reserved words case-insensitively, because Apex is', () => {
    // `Integer PUBLIC = 1;` and `Integer List = 1;` are both rejected.
    expect(new Scope().allocate('PUBLIC')).not.toBe('PUBLIC');
    expect(new Scope().allocate('List')).not.toBe('List');
    expect(new Scope().allocate('Return')).not.toBe('Return');
  });

  it('produces a compilable identifier when guarding a reserved word', () => {
    expect(new Scope().allocate('update')).toBe('vupdate');
  });

  it('leaves words the compiler actually accepts alone', () => {
    // Checked against the compiler rather than assumed: these are NOT reserved,
    // and guarding them would rename identifiers for no reason.
    for (const word of ['id', 'order', 'count', 'type', 'transient', 'sharing']) {
      expect(new Scope().allocate(word)).toBe(word);
    }
  });

  it('only guards whole-word collisions, not names containing a keyword', () => {
    expect(new Scope().allocate('updateContact')).toBe('updateContact');
    expect(new Scope().allocate('Case Number')).toBe('Case_Number');
  });

  it('keeps a guarded name unique against the name it guards to', () => {
    const s = new Scope();
    expect(s.allocate('vupdate')).toBe('vupdate');
    expect(s.allocate('update')).toBe('vupdate2');
  });
});
