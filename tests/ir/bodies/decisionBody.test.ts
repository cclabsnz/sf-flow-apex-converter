import { parseDecisionBody } from '../../../src/ir/bodies/decisionBody.js';

describe('parseDecisionBody', () => {
  // Shape taken from exampleflow.xml.
  const decision = {
    name: 'Check_BS20',
    defaultconnector: { targetreference: 'Continue' },
    defaultconnectorlabel: 'No',
    rules: {
      name: 'Yes_BS20_Exception',
      conditionlogic: 'and',
      conditions: [
        { leftvaluereference: 'BS20ErrorMessages', operator: 'IsNull', rightvalue: { booleanvalue: 'false' } },
        { leftvaluereference: 'Loop_over_Loans.Amount__c', operator: 'GreaterThan', rightvalue: { numbervalue: 1000 } },
      ],
      connector: { targetreference: 'Flag_Exception' },
      label: 'Yes',
    },
  };

  it('reads a single rule, which xml2js does not wrap in an array', () => {
    expect(parseDecisionBody(decision).rules).toHaveLength(1);
  });

  it('reads the rule name, label, logic and branch target', () => {
    const rule = parseDecisionBody(decision).rules[0];
    expect(rule.name).toBe('Yes_BS20_Exception');
    expect(rule.label).toBe('Yes');
    expect(rule.conditionLogic).toBe('and');
    expect(rule.target).toBe('Flag_Exception');
  });

  it('reads every condition of a rule', () => {
    const rule = parseDecisionBody(decision).rules[0];
    expect(rule.conditions).toHaveLength(2);
    expect(rule.conditions[1].left).toBe('Loop_over_Loans.Amount__c');
    expect(rule.conditions[1].operator).toBe('GreaterThan');
    expect(rule.conditions[1].right).toEqual({ kind: 'number', raw: '1000' });
  });

  it('reads the default branch', () => {
    const body = parseDecisionBody(decision);
    expect(body.defaultTarget).toBe('Continue');
    expect(body.defaultLabel).toBe('No');
  });

  it('yields an empty rule list for a decision with none', () => {
    expect(parseDecisionBody({ name: 'D' }).rules).toEqual([]);
  });

  it('preserves rule order for a multi-rule decision, since order is if/else-if branch precedence', () => {
    // Every decision in exampleflow.xml has exactly one <rules>, so toArray's array
    // branch never executes there and nothing asserts order is preserved. Two rules
    // here, in a realistic if/else-if shape (a first-match-wins bulkification check).
    const decision = {
      name: 'Check_Amount_Tier',
      rules: [
        {
          name: 'High_Amount',
          label: 'High Amount',
          conditionlogic: 'and',
          conditions: [
            { leftvaluereference: 'Loop_over_Loans.LLC_BI__Amount__c', operator: 'GreaterThan', rightvalue: { numbervalue: 1000000 } },
          ],
          connector: { targetreference: 'Flag_High_Amount' },
        },
        {
          name: 'Medium_Amount',
          label: 'Medium Amount',
          conditionlogic: 'and',
          conditions: [
            { leftvaluereference: 'Loop_over_Loans.LLC_BI__Amount__c', operator: 'GreaterThan', rightvalue: { numbervalue: 100000 } },
          ],
          connector: { targetreference: 'Flag_Medium_Amount' },
        },
      ],
      defaultconnector: { targetreference: 'Continue' },
    };

    const rules = parseDecisionBody(decision).rules;
    expect(rules).toHaveLength(2);
    expect(rules.map((r) => r.name)).toEqual(['High_Amount', 'Medium_Amount']);
    expect(rules[0].target).toBe('Flag_High_Amount');
    expect(rules[1].target).toBe('Flag_Medium_Amount');
  });
});
