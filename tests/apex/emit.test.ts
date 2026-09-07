import { emitExpr, emitStmt } from '../../src/apex/emit.js';
import { comparison, equality, fieldRead, literal, methodCall, nullTest, variable } from '../../src/apex/expr.js';
import { soql } from '../../src/apex/soql.js';
import {
  assign, collectInto, declare, dmlBulk, fieldWrite, forEach, ifThen, queryInto,
} from '../../src/apex/stmt.js';
import { DECIMAL, ID, STRING, listOf, sobjectType } from '../../src/apex/types.js';

describe('emitExpr', () => {
  it('emits a field read with its cast', () => {
    expect(emitExpr(fieldRead('record', 'LLC_BI__Amount__c', DECIMAL)))
      .toBe("((Decimal)record.get('LLC_BI__Amount__c'))");
  });

  it('emits a comparison that compiles', () => {
    const e = comparison(fieldRead('record', 'Amount__c', DECIMAL), '>', literal(DECIMAL, '1000'));
    expect(emitExpr(e)).toBe("((Decimal)record.get('Amount__c')) > 1000");
  });

  it('emits a null test with nothing after null', () => {
    expect(emitExpr(nullTest(variable(STRING, 'name'), false))).toBe('name == null');
    expect(emitExpr(nullTest(variable(STRING, 'name'), true))).toBe('name != null');
  });

  it('emits contains as a call', () => {
    const e = methodCall(variable(STRING, 'name'), 'contains', [literal(STRING, "'x'")], STRING);
    expect(emitExpr(e)).toBe("name.contains('x')");
  });

  it('emits equality', () => {
    expect(emitExpr(equality(variable(ID, 'a'), '!=', literal(ID, 'null')))).toBe('a != null');
  });
});

describe('emitStmt', () => {
  it('declares a typed variable', () => {
    expect(emitStmt(declare(listOf(sobjectType('Account')), 'accts', null)))
      .toBe('List<Account> accts;');
  });

  it('declares with an initialiser', () => {
    expect(emitStmt(declare(DECIMAL, 'total', literal(DECIMAL, '0'))))
      .toBe('Decimal total = 0;');
  });

  it('assigns to an existing variable', () => {
    expect(emitStmt(assign('total', literal(DECIMAL, '1')))).toBe('total = 1;');
  });

  it('writes a field onto a record', () => {
    // The 2.0.x generator computed these and then dropped them.
    expect(emitStmt(fieldWrite('record', 'Stage__c', literal(STRING, "'Funded'"))))
      .toBe("record.put('Stage__c', 'Funded');");
  });

  it('collects a record rather than issuing DML', () => {
    expect(emitStmt(collectInto('recordsToUpdate', 'record')))
      .toBe('recordsToUpdate.add(record);');
  });

  it('assigns a query result to a named variable', () => {
    const q = soql({ object: 'Account', fields: ['Id'], whereIdIn: 'ids' });
    const emitted = emitStmt(queryInto(listOf(sobjectType('Account')), 'accts', q));
    expect(emitted).toContain('List<Account> accts = [');
    expect(emitted).toContain('FROM Account');
    expect(emitted).toContain('WITH USER_MODE');
    expect(emitted.trimEnd().endsWith('];')).toBe(true);
  });

  it('emits DML in user mode, guarded by an emptiness check', () => {
    const emitted = emitStmt(dmlBulk('update', 'recordsToUpdate'));
    expect(emitted).toContain('if (!recordsToUpdate.isEmpty())');
    expect(emitted).toContain('Database.update(recordsToUpdate, AccessLevel.USER_MODE);');
  });

  it('emits an if with its body indented', () => {
    const cond = equality(variable(ID, 'a'), '==', literal(ID, 'null'));
    const emitted = emitStmt(ifThen(cond, [assign('total', literal(DECIMAL, '1'))]));
    expect(emitted).toBe('if (a == null) {\n    total = 1;\n}');
  });

  it('emits a for-each over a collection', () => {
    const emitted = emitStmt(
      forEach(sobjectType('Account'), 'acct', 'accts', [collectInto('toUpdate', 'acct')])
    );
    expect(emitted).toBe('for (Account acct : accts) {\n    toUpdate.add(acct);\n}');
  });

  it('nests indentation correctly', () => {
    const inner = ifThen(equality(variable(ID, 'x'), '==', literal(ID, 'null')), [
      collectInto('toUpdate', 'acct'),
    ]);
    const emitted = emitStmt(forEach(sobjectType('Account'), 'acct', 'accts', [inner]));
    expect(emitted).toContain('\n        toUpdate.add(acct);');
  });
});
