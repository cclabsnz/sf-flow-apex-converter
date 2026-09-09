import { emitExpr } from '../../src/apex/emit.js';
import { Scope } from '../../src/apex/scope.js';
import { BOOLEAN, DECIMAL, isAssignable, sobjectType } from '../../src/apex/types.js';
import { FlowIR } from '../../src/ir/types.js';
import { LowerContext } from '../../src/lower/context.js';
import { declarationTypeSource } from '../../src/lower/typeSource.js';
import { literal } from '../../src/apex/expr.js';
import { UnsupportedConstructError, lowerReference, lowerValue } from '../../src/lower/value.js';

const literalTrue = () => literal(BOOLEAN, 'true');

function ctx(ir?: Partial<FlowIR>): LowerContext {
  const full: FlowIR = {
    flowName: 'T', processType: 'AutoLaunchedFlow', declarations: [], nodes: [],
    unsupported: [], ...ir,
  };
  return {
    ir: full, types: declarationTypeSource(full), scope: new Scope(),
    names: new Map(), notes: [], stubs: new Map(), formulas: new Map(),
  };
}

describe('lowerValue', () => {
  it('escapes a string value rather than interpolating it', () => {
    // The O'Brien case, arriving from real Flow data for the first time.
    expect(emitExpr(lowerValue({ kind: 'string', raw: "O'Brien" }, ctx())))
      .toBe("'O\\'Brien'");
  });

  it('lowers a number', () => {
    expect(emitExpr(lowerValue({ kind: 'number', raw: '1000' }, ctx()))).toBe('1000');
  });

  it('lowers a negative number', () => {
    expect(emitExpr(lowerValue({ kind: 'number', raw: '-2.5' }, ctx()))).toBe('-2.5');
  });

  it('lowers booleans', () => {
    expect(emitExpr(lowerValue({ kind: 'boolean', raw: 'true' }, ctx()))).toBe('true');
    expect(emitExpr(lowerValue({ kind: 'boolean', raw: 'false' }, ctx()))).toBe('false');
  });

  it('lowers none to null', () => {
    expect(emitExpr(lowerValue({ kind: 'none' }, ctx()))).toBe('null');
  });

  it('lowers none to a null assignable to any type', () => {
    const e = lowerValue({ kind: 'none' }, ctx());
    expect(emitExpr(e)).toBe('null');
    expect(isAssignable(DECIMAL, e.type)).toBe(true);
    expect(isAssignable(sobjectType('Account'), e.type)).toBe(true);
  });

  it('lowers a plain reference to the allocated identifier', () => {
    const c = ctx({
      declarations: [{
        name: 'IsBrokerDeal', kind: 'variable', dataType: 'Boolean', isCollection: false,
        isInput: false, isOutput: false, sourceJson: '{}',
      }],
    });
    expect(emitExpr(lowerValue({ kind: 'reference', raw: 'IsBrokerDeal' }, c)))
      .toBe('IsBrokerDeal');
  });

  it('renames a reference that collides with an Apex keyword', () => {
    const c = ctx({
      declarations: [{
        name: 'List', kind: 'variable', dataType: 'String', isCollection: false,
        isInput: false, isOutput: false, sourceJson: '{}',
      }],
    });
    expect(emitExpr(lowerValue({ kind: 'reference', raw: 'List' }, c))).toBe('vList');
  });

  it('lowers a dotted reference to a cast field read', () => {
    const c = ctx({
      declarations: [{
        name: 'Acct', kind: 'variable', dataType: 'SObject', objectType: 'Account',
        isCollection: false, isInput: false, isOutput: false, sourceJson: '{}',
      }],
    });
    expect(emitExpr(lowerValue({ kind: 'reference', raw: 'Acct.Id' }, c)))
      .toBe("((Id)Acct.get('Id'))");
  });

  it('records a note when a field type was guessed', () => {
    const c = ctx({
      declarations: [{
        name: 'Acct', kind: 'variable', dataType: 'SObject', objectType: 'Account',
        isCollection: false, isInput: false, isOutput: false, sourceJson: '{}',
      }],
    });
    lowerValue({ kind: 'reference', raw: 'Acct.NC_Amount__c' }, c);
    expect(c.notes.filter((n) => n.kind === 'guess')).toHaveLength(1);
    expect(c.notes[0].detail).toContain('NC_Amount__c');
  });

  it('lowers a custom permission reference to a platform call', () => {
    expect(emitExpr(lowerValue({ kind: 'reference', raw: '$Permission.NC_RBNZ_TDTI' }, ctx())))
      .toBe("FeatureManagement.checkPermission('NC_RBNZ_TDTI')");
  });

  it('refuses an unmapped global reference by name rather than guessing', () => {
    expect(() => lowerValue({ kind: 'reference', raw: '$Setup.MyThing__c.Field__c' }, ctx()))
      .toThrow(UnsupportedConstructError);
  });

  it('resolves a formula reference to its registered expression', () => {
    // Formulas are not declared as variables. Without this a reference emits a
    // bare identifier for a local that is never declared, and the class will
    // not compile.
    const c = ctx();
    c.formulas.set('IsCreditAction', literalTrue());
    expect(emitExpr(lowerValue({ kind: 'reference', raw: 'IsCreditAction' }, c))).toBe('true');
  });

  it('refuses a value kind with no mapping', () => {
    expect(() => lowerValue({ kind: 'setupReference', raw: 'x' }, ctx()))
      .toThrow(UnsupportedConstructError);
  });
});


describe('lowerReference and relationship traversal', () => {
  it('refuses a reference with more than one dot', () => {
    // `{!CaseVar.Contact.Email}` emitted ((String)CaseVar.get('Contact.Email')),
    // which COMPILES and throws System.SObjectException at run time — the
    // acceptance gate cannot see it. Worse, the header listed it as a guessed
    // TYPE, implying the field is real.
    const c = ctx({ declarations: [{
      name: 'CaseVar', kind: 'variable', dataType: 'SObject', objectType: 'Case',
      isCollection: false, isInput: false, isOutput: false, sourceJson: '{}',
    }] });
    expect(() => lowerReference('CaseVar.Contact.Email', c))
      .toThrow(UnsupportedConstructError);
    expect(() => lowerReference('CaseVar.Contact.Email', c))
      .toThrow(/CaseVar\.Contact\.Email/);
    expect(() => lowerReference('CaseVar.Contact.Email', c))
      .toThrow(/relationship/i);
  });

  it('records no guess for a reference it refuses', () => {
    // The note would otherwise claim a type for a field that was never read.
    const c = ctx({ declarations: [{
      name: 'CaseVar', kind: 'variable', dataType: 'SObject', objectType: 'Case',
      isCollection: false, isInput: false, isOutput: false, sourceJson: '{}',
    }] });
    expect(() => lowerReference('CaseVar.Contact.Email', c)).toThrow();
    expect(c.notes).toEqual([]);
  });

  it('still lowers a single-dot field read', () => {
    const c = ctx({ declarations: [{
      name: 'CaseVar', kind: 'variable', dataType: 'SObject', objectType: 'Case',
      isCollection: false, isInput: false, isOutput: false, sourceJson: '{}',
    }] });
    expect(emitExpr(lowerReference('CaseVar.Subject', c)))
      .toBe("((String)CaseVar.get('Subject'))");
  });
});
