import { ApexTypeError } from '../../src/apex/errors.js';
import { emitExpr, emitStmt } from '../../src/apex/emit.js';
import { comparison, fieldRead, literal, methodCall, nullTest, variable } from '../../src/apex/expr.js';
import { Scope } from '../../src/apex/scope.js';
import { renderSoql, soql } from '../../src/apex/soql.js';
import { collectInto, dmlBulk, fieldWrite } from '../../src/apex/stmt.js';
import { DECIMAL, OBJECT, STRING } from '../../src/apex/types.js';

/**
 * Every test here corresponds to Apex this project once generated and shipped.
 * They are phrased as "cannot be built" rather than "is built correctly",
 * because the milestone's claim is about the class of defect, not one instance.
 */
describe('defects that are now unrepresentable', () => {
  test('DEFECT 1: record.get() compared with > does not typecheck', () => {
    // Shipped as: record.get('LLC_BI__Amount__c') > 1000
    expect(() =>
      comparison(variable(OBJECT, "record.get('Amount__c')"), '>', literal(DECIMAL, '1000'))
    ).toThrow(ApexTypeError);

    // And a field read cannot be created untyped in the first place.
    expect(() => fieldRead('record', 'Amount__c', OBJECT)).toThrow(ApexTypeError);

    // The only buildable form carries the cast.
    expect(emitExpr(comparison(fieldRead('record', 'Amount__c', DECIMAL), '>', literal(DECIMAL, '1000'))))
      .toBe("((Decimal)record.get('Amount__c')) > 1000");
  });

  test('DEFECT 2: contains has no infix form to abuse', () => {
    // Shipped as: a contains 'x'
    const only = methodCall(variable(STRING, 'name'), 'contains', [literal(STRING, "'x'")], STRING);
    expect(emitExpr(only)).toBe("name.contains('x')");
    // There is no operator named 'contains' anywhere in the expression union;
    // comparison() accepts only the four ordering operators, enforced by its type.
  });

  test("DEFECT 2b: a null test cannot carry a dangling right-hand value", () => {
    // Shipped as: x == null 1000
    expect(emitExpr(nullTest(variable(STRING, 'x'), false))).toBe('x == null');
  });

  test('DEFECT 3: a query cannot be built without naming its object', () => {
    // Shipped as: SELECT Id, Name FROM Account — for every Flow, whatever it declared.
    expect(() => soql({ object: '', fields: ['Id'] })).toThrow(ApexTypeError);

    const q = soql({ object: 'LLC_BI__Pricing_Stream__c', fields: ['Id'] });
    expect(renderSoql(q)).toContain('FROM LLC_BI__Pricing_Stream__c');
    expect(renderSoql(q)).not.toContain('FROM Account');
  });

  test('DEFECT 4: a field write is a statement, not an interpolation that can vanish', () => {
    // Shipped as: an update that collected the record without its field writes.
    expect(emitStmt(fieldWrite('record', 'Stage__c', literal(STRING, "'Funded'"))))
      .toBe("record.put('Stage__c', 'Funded');");
  });

  test('DEFECT 5: two lookups cannot share a variable name', () => {
    // Shipped as: List<SObject> relatedRecords declared twice in one method.
    const scope = new Scope();
    expect(scope.allocate('relatedRecords')).toBe('relatedRecords');
    expect(scope.allocate('relatedRecords')).toBe('relatedRecords2');
  });

  test('DEFECT 6: a suffix cannot be applied twice by accident', () => {
    // Shipped as: validateKey_Loan_Date_Validation_Bulkified_Bulkified
    const scope = new Scope();
    const first = scope.allocate('validateKey_Loan_Date_Validation_Bulkified');
    const second = scope.allocate('validateKey_Loan_Date_Validation_Bulkified');
    expect(first).toBe('validateKey_Loan_Date_Validation_Bulkified');
    expect(second).toBe('validateKey_Loan_Date_Validation_Bulkified2');
    expect(second).not.toContain('_Bulkified_Bulkified');
  });

  test('per-record DML has no representation at all', () => {
    // The tool exists to remove DML from loops. The tree offers only collection
    // then bulk DML — there is no single-record DML statement to construct.
    expect(emitStmt(collectInto('recordsToUpdate', 'record'))).toBe('recordsToUpdate.add(record);');
    expect(emitStmt(dmlBulk('update', 'recordsToUpdate'))).toContain('AccessLevel.USER_MODE');
  });
});
