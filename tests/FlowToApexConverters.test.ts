import {
  SimplifiedFlowAnalyzer,
  FlowAssignment,
  FlowDecision,
  FlowDMLOperation,
} from '../src/utils/SimplifiedFlowAnalyzer.js';

/**
 * The Flow-to-Apex converters were reconstructed from the published 2.0.3 build and
 * proved faithful by output parity — but the bundled example Flow has no decisions,
 * assignments or DML inside its subflows, so parity never exercised them.
 *
 * These tests exercise them directly. Apex is a typed language: a converter that emits
 * a syntactically plausible string which does not compile is worse than one that emits
 * nothing, because the failure surfaces at deploy time in someone else's org.
 */

const analyzer = new SimplifiedFlowAnalyzer();

const decision = (over: Partial<FlowDecision> = {}): FlowDecision => ({
  name: 'Check_Amount',
  logicType: 'AND',
  conditions: [
    { leftValue: 'Loop_over_Loans.LLC_BI__Amount__c', operator: 'GreaterThan', rightValue: '1000', dataType: 'Decimal' },
  ],
  ...over,
});

describe('convertDecisionToApex', () => {
  test('reads a dotted Flow reference off the record', () => {
    expect(analyzer.convertDecisionToApex(decision())).toContain("record.get('LLC_BI__Amount__c')");
  });

  test('joins multiple conditions with the decision logic type', () => {
    const d = decision({
      logicType: 'OR',
      conditions: [
        { leftValue: 'A.F1__c', operator: 'EqualTo', rightValue: 'x', dataType: 'String' },
        { leftValue: 'A.F2__c', operator: 'EqualTo', rightValue: 'y', dataType: 'String' },
      ],
    });
    expect(analyzer.convertDecisionToApex(d)).toContain(' or ');
  });

  test('a comparison against an untyped field read is cast, not compared raw', () => {
    // record.get() returns Object. `(Object) > 1000` does not compile in Apex, so a
    // relational operator has to carry a cast for the emitted code to be deployable.
    const apex = analyzer.convertDecisionToApex(decision());
    expect(apex).toMatch(/\((Decimal|Integer|Double)\)\s*record\.get/);
  });

  test('a null check does not leave a dangling right-hand value', () => {
    // 'IsNull' maps to the complete operator '== null'; appending rightValue after it
    // yields `x == null 1000`.
    const d = decision({
      conditions: [{ leftValue: 'A.F__c', operator: 'IsNull', rightValue: '', dataType: 'String' }],
    });
    expect(analyzer.convertDecisionToApex(d).trim()).toMatch(/==\s*null$/);
  });

  test('Contains emits a method call, not an infix word', () => {
    const d = decision({
      conditions: [{ leftValue: 'A.Name', operator: 'Contains', rightValue: "'x'", dataType: 'String' }],
    });
    // `a contains 'x'` is not Apex.
    expect(analyzer.convertDecisionToApex(d)).toMatch(/\.contains\(/);
  });
});

describe('convertAssignmentToApex', () => {
  const assign = (over: Partial<FlowAssignment> = {}): FlowAssignment => ({
    variable: 'total', operator: 'Assign', value: '0', dataType: 'Decimal', isCollection: false, ...over,
  });

  test('renders a scalar assignment', () => {
    expect(analyzer.convertAssignmentToApex(assign())).toBe('total = 0;');
  });

  test('renders arithmetic operators', () => {
    expect(analyzer.convertAssignmentToApex(assign({ operator: 'Add', value: '5' }))).toBe('total += 5;');
    expect(analyzer.convertAssignmentToApex(assign({ operator: 'Subtract', value: '5' }))).toBe('total -= 5;');
  });

  test('collection Add becomes .add()', () => {
    const a = assign({ variable: 'loans', operator: 'Add', value: 'Loop_over_Loans.Id', isCollection: true });
    expect(analyzer.convertAssignmentToApex(a)).toBe("loans.add(record.get('Id'));");
  });

  test('collection RemoveFirst guards before removing', () => {
    const a = assign({ variable: 'loans', operator: 'RemoveFirst', isCollection: true });
    expect(analyzer.convertAssignmentToApex(a)).toContain('isEmpty()');
  });
});

describe('convertDMLToApex', () => {
  const dml = (over: Partial<FlowDMLOperation> = {}): FlowDMLOperation => ({
    type: 'update', object: 'LLC_BI__Loan__c', fields: new Map(), ...over,
  });

  test('never emits a DML statement — that is the whole point of bulkifying', () => {
    for (const type of ['insert', 'update', 'delete', 'upsert'] as const) {
      const apex = analyzer.convertDMLToApex(dml({ type }));
      expect(apex).not.toMatch(/^\s*(insert|update|delete|upsert)\s/m);
      expect(apex).toMatch(/recordsTo(Insert|Update|Delete)\.add\(record\);/);
    }
  });

  test('wraps a conditional DML in its condition', () => {
    const apex = analyzer.convertDMLToApex(
      dml({ conditions: [{ leftValue: 'A.Stage__c', operator: 'EqualTo', rightValue: "'Closed'", dataType: 'String' }] })
    );
    expect(apex).toMatch(/^if \(/);
    expect(apex.trim()).toMatch(/}$/);
  });

  test('applies the field values the Flow set before adding the record', () => {
    // A Flow update element sets fields; dropping them silently produces code that
    // collects records for update without making the change the Flow described.
    const apex = analyzer.convertDMLToApex(
      dml({ fields: new Map([['LLC_BI__Stage__c', "'Funded'"]]) })
    );
    expect(apex).toContain("record.put('LLC_BI__Stage__c'");
  });
});
