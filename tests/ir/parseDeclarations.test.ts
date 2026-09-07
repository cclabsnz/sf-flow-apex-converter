import { parseDeclarations } from '../../src/ir/parseDeclarations.js';

/** xml2js is configured normalizeTags, so every key arrives lowercased. */
const flowData = {
  variables: [
    {
      name: 'ErrorMessage',
      datatype: 'String',
      iscollection: 'false',
      isinput: 'false',
      isoutput: 'false',
      value: { stringvalue: 'Amount cannot be null.' },
    },
    { name: 'Loans', datatype: 'SObject', iscollection: 'true', isinput: 'true', isoutput: 'false' },
  ],
  constants: {
    name: 'FIELD_NAME',
    datatype: 'String',
    value: { stringvalue: 'Amount for Commission Calculation' },
  },
  formulas: {
    name: 'IsContingent',
    datatype: 'Boolean',
    expression: "ISPICKVAL({!Loop.Product_Type__c}, 'Contingent Liability')",
  },
};

describe('parseDeclarations', () => {
  it('reads every declaration kind', () => {
    const kinds = parseDeclarations(flowData).map((d) => d.kind).sort();
    expect(kinds).toEqual(['constant', 'formula', 'variable', 'variable']);
  });

  it('parses a single (non-array) declaration, which xml2js does not wrap', () => {
    expect(parseDeclarations(flowData).filter((d) => d.kind === 'constant')).toHaveLength(1);
  });

  it('coerces the string booleans xml2js produces', () => {
    const loans = parseDeclarations(flowData).find((d) => d.name === 'Loans')!;
    expect(loans.isCollection).toBe(true);
    expect(loans.isInput).toBe(true);
    expect(loans.isOutput).toBe(false);
  });

  it('keeps a formula expression untranslated', () => {
    const f = parseDeclarations(flowData).find((d) => d.kind === 'formula')!;
    expect(f.expression).toBe("ISPICKVAL({!Loop.Product_Type__c}, 'Contingent Liability')");
  });

  it('reads a literal value', () => {
    const v = parseDeclarations(flowData).find((d) => d.name === 'ErrorMessage')!;
    expect(v.value).toEqual({ kind: 'string', raw: 'Amount cannot be null.' });
  });

  it('defaults a declaration with no value to kind none', () => {
    const loans = parseDeclarations(flowData).find((d) => d.name === 'Loans')!;
    expect(loans.value).toEqual({ kind: 'none' });
  });
});
