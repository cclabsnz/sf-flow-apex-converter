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
});
