import { ApexTypeError } from '../../src/apex/errors.js';
import { renderSoql, soql } from '../../src/apex/soql.js';

describe('soql', () => {
  it('requires an object — there is no default to fall back to', () => {
    // The 2.0.x generator emitted `FROM Account` for every Flow because the
    // object was a literal in a template. Here it is a required input.
    expect(() => soql({ object: '', fields: ['Id'] })).toThrow(ApexTypeError);
  });

  it('requires at least one field', () => {
    expect(() => soql({ object: 'Account', fields: [] })).toThrow(ApexTypeError);
  });

  it('always selects Id, and never twice', () => {
    expect(soql({ object: 'Account', fields: ['Name'] }).fields).toEqual(['Id', 'Name']);
    expect(soql({ object: 'Account', fields: ['Id', 'Name'] }).fields).toEqual(['Id', 'Name']);
  });

  it('deduplicates Id case-insensitively', () => {
    const fields = soql({ object: 'Account', fields: ['id', 'Name'] }).fields;
    const idCount = fields.filter(f => f.toLowerCase() === 'id').length;
    expect(idCount).toBe(1);
  });

  it('rejects a field name that is not an identifier', () => {
    expect(() => soql({ object: 'Account', fields: ["Name FROM User WHERE Id != null OR '1'='1"] }))
      .toThrow(ApexTypeError);
  });

  it('rejects an object name that is not an identifier', () => {
    expect(() => soql({ object: 'Account; DELETE', fields: ['Id'] })).toThrow(ApexTypeError);
  });
});

describe('renderSoql', () => {
  it('renders the object the caller named', () => {
    const q = soql({ object: 'LLC_BI__Pricing_Stream__c', fields: ['Id'] });
    expect(renderSoql(q)).toContain('FROM LLC_BI__Pricing_Stream__c');
  });

  it('always carries WITH USER_MODE', () => {
    // Spec decision: generated Apex targets API 58.0+ and runs in user mode.
    expect(renderSoql(soql({ object: 'Account', fields: ['Id'] }))).toContain('WITH USER_MODE');
  });

  it('binds an Id set rather than interpolating it', () => {
    const q = soql({ object: 'Account', fields: ['Id'], whereIdIn: 'recordIds' });
    expect(renderSoql(q)).toContain('WHERE Id IN :recordIds');
  });

  it('renders ORDER BY and LIMIT when asked', () => {
    const q = soql({
      object: 'Account', fields: ['Id'],
      orderBy: { field: 'CreatedDate', direction: 'DESC' }, limit: 1,
    });
    const sql = renderSoql(q);
    expect(sql).toContain('ORDER BY CreatedDate DESC');
    expect(sql).toContain('LIMIT 1');
  });

  it('puts the clauses in the order Apex requires', () => {
    const sql = renderSoql(soql({
      object: 'Account', fields: ['Id'], whereIdIn: 'ids',
      orderBy: { field: 'Name' }, limit: 5,
    }));
    const order = ['SELECT', 'FROM', 'WHERE', 'WITH USER_MODE', 'ORDER BY', 'LIMIT']
      .map((k) => sql.indexOf(k));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i >= 0)).toBe(true);
  });
});
