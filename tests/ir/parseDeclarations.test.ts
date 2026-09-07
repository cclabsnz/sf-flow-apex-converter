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
  // FlowTextTemplate has no <expression> and no <dataType> in the real Flow metadata
  // schema — its body is <text>. A fixture with `expression:` here would match the
  // schema xml2js never actually produces.
  texttemplates: {
    name: 'EmailBody',
    text: 'Hello {!Contact.FirstName}, your account is {!Loop.Status__c}.',
  },
};

describe('parseDeclarations', () => {
  it('reads every declaration kind', () => {
    const kinds = parseDeclarations(flowData).map((d) => d.kind).sort();
    expect(kinds).toEqual(['constant', 'formula', 'textTemplate', 'variable', 'variable']);
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

  it('reads a textTemplate body from <text>, not <expression>', () => {
    const t = parseDeclarations(flowData).find((d) => d.kind === 'textTemplate')!;
    expect(t.name).toBe('EmailBody');
    expect(t.kind).toBe('textTemplate');
    expect(t.expression).toBe('Hello {!Contact.FirstName}, your account is {!Loop.Status__c}.');
  });

  it('gives a textTemplate dataType String, since that is what it evaluates to', () => {
    // The schema has no <dataType> for textTemplate at all — 'String' is not read
    // from the XML, it is the only correct value a template can produce.
    const t = parseDeclarations(flowData).find((d) => d.kind === 'textTemplate')!;
    expect(t.dataType).toBe('String');
  });

  it('reads apexValue, sobjectValue, formulaExpression and setupReference value variants', () => {
    const data = {
      variables: [
        { name: 'ApexVar', datatype: 'Apex', value: { apexvalue: 'new MyClass()' } },
        { name: 'SObjVar', datatype: 'SObject', value: { sobjectvalue: 'Account' } },
        { name: 'FormulaVar', datatype: 'String', value: { formulaexpression: '{!Account.Name}' } },
        { name: 'SetupVar', datatype: 'String', value: { setupreference: '$Setup.MySetting__c.Field__c' } },
      ],
    };
    const decls = parseDeclarations(data);
    expect(decls.find((d) => d.name === 'ApexVar')!.value).toEqual({ kind: 'apex', raw: 'new MyClass()' });
    expect(decls.find((d) => d.name === 'SObjVar')!.value).toEqual({ kind: 'sobject', raw: 'Account' });
    expect(decls.find((d) => d.name === 'FormulaVar')!.value).toEqual({
      kind: 'formula',
      raw: '{!Account.Name}',
    });
    expect(decls.find((d) => d.name === 'SetupVar')!.value).toEqual({
      kind: 'setupReference',
      raw: '$Setup.MySetting__c.Field__c',
    });
  });

  it('reads objectType and apexClass, using shapes from exampleflow.xml', () => {
    const data = {
      variables: [
        {
          name: 'LoansInPP',
          dataType: 'SObject',
          isCollection: 'true',
          isInput: 'true',
          isOutput: 'false',
          objecttype: 'LLC_BI__Loan__c',
        },
        {
          name: 'ValidationMessage',
          apexclass: 'ValidationMessage',
          datatype: 'Apex',
          iscollection: 'false',
          isinput: 'false',
          isoutput: 'false',
        },
      ],
    };
    const decls = parseDeclarations(data);
    expect(decls.find((d) => d.name === 'LoansInPP')!.objectType).toBe('LLC_BI__Loan__c');
    expect(decls.find((d) => d.name === 'ValidationMessage')!.apexClass).toBe('ValidationMessage');
  });

  it('skips a declaration with no name, e.g. an empty <variables/>', () => {
    // xml2js parses a self-closing <variables/> to an empty string, not an object.
    const decls = parseDeclarations({ variables: '' });
    expect(decls).toHaveLength(0);
  });
});
