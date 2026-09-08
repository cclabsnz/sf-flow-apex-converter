import { emitClass, ApexClass } from '../../src/apex/class.js';
import { literal } from '../../src/apex/expr.js';
import { assign, declare } from '../../src/apex/stmt.js';
import { BOOLEAN, DECIMAL, STRING, listOf, sobjectType } from '../../src/apex/types.js';

function emptyClass(over: Partial<ApexClass> = {}): ApexClass {
  return {
    name: 'MyHandler', sharing: 'with sharing', doc: [],
    fields: [], methods: [], inner: [], ...over,
  };
}

describe('emitClass', () => {
  it('emits an empty class with its sharing mode', () => {
    expect(emitClass(emptyClass())).toBe('public with sharing class MyHandler {\n}');
  });

  it('emits without sharing when the Flow says so', () => {
    expect(emitClass(emptyClass({ sharing: 'without sharing' })))
      .toContain('public without sharing class MyHandler {');
  });

  it('emits an ApexDoc header', () => {
    const out = emitClass(emptyClass({ doc: ['Generated from Flow: MyFlow.', 'Do not edit.'] }));
    expect(out).toContain('/**\n * Generated from Flow: MyFlow.\n * Do not edit.\n */');
    expect(out.indexOf('/**')).toBeLessThan(out.indexOf('class MyHandler'));
  });

  it('emits a static final constant', () => {
    const out = emitClass(emptyClass({
      fields: [{
        visibility: 'private', isStatic: true, isFinal: true,
        type: STRING, name: 'FIELD_NAME', init: literal(STRING, "'Amount__c'"),
      }],
    }));
    expect(out.split('\n')).toContain("    private static final String FIELD_NAME = 'Amount__c';");
  });

  it('emits a field with no initialiser', () => {
    const out = emitClass(emptyClass({
      fields: [{
        visibility: 'public', isStatic: false, isFinal: false,
        type: STRING, name: 'Message', init: null,
      }],
    }));
    expect(out.split('\n')).toContain('    public String Message;');
  });

  it('emits a void method with parameters and an indented body', () => {
    const out = emitClass(emptyClass({
      methods: [{
        visibility: 'public', isStatic: true, returnType: null, name: 'execute',
        params: [{ type: listOf(sobjectType('Account')), name: 'records' }],
        body: [declare(DECIMAL, 'total', literal(DECIMAL, '0'))],
        doc: [],
      }],
    }));
    expect(out.split('\n')).toContain('    public static void execute(List<Account> records) {');
    expect(out.split('\n')).toContain('        Decimal total = 0;');
    expect(out.split('\n')).toContain('    }');
  });

  it('emits a method with a return type and several parameters', () => {
    const out = emitClass(emptyClass({
      methods: [{
        visibility: 'private', isStatic: true, returnType: BOOLEAN, name: 'isReady',
        params: [{ type: STRING, name: 'stage' }, { type: DECIMAL, name: 'amount' }],
        body: [assign('flag', literal(BOOLEAN, 'true'))],
        doc: [],
      }],
    }));
    expect(out.split('\n')).toContain('    private static Boolean isReady(String stage, Decimal amount) {');
  });

  it('emits a method with an empty body without a stray blank line', () => {
    const out = emitClass(emptyClass({
      methods: [{
        visibility: 'public', isStatic: true, returnType: null, name: 'noop',
        params: [], body: [], doc: [],
      }],
    }));
    expect(out).toContain('    public static void noop() {\n    }');
  });

  it('emits an ApexDoc block above a method', () => {
    const out = emitClass(emptyClass({
      methods: [{
        visibility: 'private', isStatic: true, returnType: BOOLEAN, name: 'stubbed',
        params: [], body: [], doc: ['TODO: formula not translated.'],
      }],
    }));
    expect(out).toContain('    /**\n     * TODO: formula not translated.\n     */');
  });

  it('emits an inner class indented inside its parent', () => {
    const out = emitClass(emptyClass({
      inner: [{
        name: 'Result', sharing: 'with sharing', doc: [], inner: [], methods: [],
        fields: [{
          visibility: 'public', isStatic: false, isFinal: false,
          type: STRING, name: 'message', init: null,
        }],
      }],
    }));
    expect(out.split('\n')).toContain('    public with sharing class Result {');
    expect(out.split('\n')).toContain('        public String message;');
  });
});
