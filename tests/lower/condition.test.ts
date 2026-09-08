import { emitExpr } from '../../src/apex/emit.js';
import { Scope } from '../../src/apex/scope.js';
import { FlowConditionIR, FlowDeclaration, FlowIR } from '../../src/ir/types.js';
import { LowerContext } from '../../src/lower/context.js';
import { declarationTypeSource } from '../../src/lower/typeSource.js';
import { UnsupportedConstructError } from '../../src/lower/value.js';
import { lowerCondition, lowerConditions, parseConditionLogic } from '../../src/lower/condition.js';

function decl(name: string, dataType: string, objectType?: string): FlowDeclaration {
  return {
    name, kind: 'variable', dataType, objectType, isCollection: false,
    isInput: false, isOutput: false, sourceJson: '{}',
  };
}

function ctx(declarations: FlowDeclaration[] = []): LowerContext {
  const ir: FlowIR = {
    flowName: 'T', processType: 'AutoLaunchedFlow', declarations, nodes: [], unsupported: [],
  };
  return {
    ir, types: declarationTypeSource(ir), scope: new Scope(),
    names: new Map(), notes: [], stubs: new Map(), formulas: new Map(),
  };
}

const cond = (left: string, operator: string, right: FlowConditionIR['right']): FlowConditionIR =>
  ({ left, operator, right });

describe('parseConditionLogic', () => {
  it('treats and as a conjunction of every condition', () => {
    expect(parseConditionLogic('and', 3)).toEqual({
      kind: 'and',
      children: [{ kind: 'index', index: 0 }, { kind: 'index', index: 1 }, { kind: 'index', index: 2 }],
    });
  });

  it('treats or as a disjunction of every condition', () => {
    expect(parseConditionLogic('or', 2).kind).toBe('or');
  });

  it('parses a custom expression with precedence and parentheses', () => {
    // AND binds tighter than OR, so 1 AND (2 OR 3) must keep the grouping.
    expect(parseConditionLogic('1 AND (2 OR 3)', 3)).toEqual({
      kind: 'and',
      children: [
        { kind: 'index', index: 0 },
        { kind: 'or', children: [{ kind: 'index', index: 1 }, { kind: 'index', index: 2 }] },
      ],
    });
  });

  it('gives AND higher precedence than OR without parentheses', () => {
    expect(parseConditionLogic('1 OR 2 AND 3', 3)).toEqual({
      kind: 'or',
      children: [
        { kind: 'index', index: 0 },
        { kind: 'and', children: [{ kind: 'index', index: 1 }, { kind: 'index', index: 2 }] },
      ],
    });
  });

  it('refuses an index outside the condition list', () => {
    expect(() => parseConditionLogic('1 AND 5', 2)).toThrow(UnsupportedConstructError);
  });

  it('refuses malformed logic rather than guessing', () => {
    expect(() => parseConditionLogic('1 AND', 2)).toThrow(UnsupportedConstructError);
    expect(() => parseConditionLogic('1 AND (2', 2)).toThrow(UnsupportedConstructError);
  });
});

describe('lowerCondition', () => {
  it('lowers EqualTo to ==', () => {
    const c = ctx([decl('IsBrokerDeal', 'Boolean')]);
    expect(emitExpr(lowerCondition(cond('IsBrokerDeal', 'EqualTo', { kind: 'boolean', raw: 'true' }), c)))
      .toBe('IsBrokerDeal == true');
  });

  it('lowers NotEqualTo to !=', () => {
    const c = ctx([decl('IsBrokerDeal', 'Boolean')]);
    expect(emitExpr(lowerCondition(cond('IsBrokerDeal', 'NotEqualTo', { kind: 'boolean', raw: 'true' }), c)))
      .toBe('IsBrokerDeal != true');
  });

  it('lowers IsNull true to a null test', () => {
    const c = ctx([decl('Amount', 'Number')]);
    expect(emitExpr(lowerCondition(cond('Amount', 'IsNull', { kind: 'boolean', raw: 'true' }), c)))
      .toBe('Amount == null');
  });

  it('lowers IsNull false to a not-null test', () => {
    const c = ctx([decl('Amount', 'Number')]);
    expect(emitExpr(lowerCondition(cond('Amount', 'IsNull', { kind: 'boolean', raw: 'false' }), c)))
      .toBe('Amount != null');
  });

  it('lowers IsBlank through String.isBlank and isNotBlank', () => {
    // The AST has no unary NOT, and Apex supplies isNotBlank, so the negation
    // is expressed by picking the other method rather than wrapping.
    const c = ctx([decl('Name', 'String')]);
    expect(emitExpr(lowerCondition(cond('Name', 'IsBlank', { kind: 'boolean', raw: 'true' }), c)))
      .toBe('String.isBlank(Name)');
    expect(emitExpr(lowerCondition(cond('Name', 'IsBlank', { kind: 'boolean', raw: 'false' }), c)))
      .toBe('String.isNotBlank(Name)');
  });

  it('lowers ordering operators', () => {
    const c = ctx([decl('Amount', 'Number')]);
    expect(emitExpr(lowerCondition(cond('Amount', 'GreaterThan', { kind: 'number', raw: '1000' }), c)))
      .toBe('Amount > 1000');
  });

  it('lowers Contains to a method call', () => {
    const c = ctx([decl('Name', 'String')]);
    expect(emitExpr(lowerCondition(cond('Name', 'Contains', { kind: 'string', raw: 'Ltd' }), c)))
      .toBe("Name.contains('Ltd')");
  });

  it('refuses an operator with no mapping, by name', () => {
    const c = ctx([decl('Name', 'String')]);
    expect(() => lowerCondition(cond('Name', 'WasSet', { kind: 'boolean', raw: 'true' }), c))
      .toThrow(/WasSet/);
  });
});

describe('lowerConditions', () => {
  it('joins conditions with &&', () => {
    const c = ctx([decl('A', 'Boolean'), decl('B', 'Boolean')]);
    const out = emitExpr(lowerConditions('and', [
      cond('A', 'EqualTo', { kind: 'boolean', raw: 'true' }),
      cond('B', 'EqualTo', { kind: 'boolean', raw: 'true' }),
    ], c));
    expect(out).toBe('(A == true) && (B == true)');
  });

  it('honours custom logic grouping in the emitted expression', () => {
    const c = ctx([decl('A', 'Boolean'), decl('B', 'Boolean'), decl('C', 'Boolean')]);
    const out = emitExpr(lowerConditions('1 AND (2 OR 3)', [
      cond('A', 'EqualTo', { kind: 'boolean', raw: 'true' }),
      cond('B', 'EqualTo', { kind: 'boolean', raw: 'true' }),
      cond('C', 'EqualTo', { kind: 'boolean', raw: 'true' }),
    ], c));
    // The parenthesisation is what makes this correct rather than 1 AND 2 OR 3.
    expect(out).toBe('(A == true) && ((B == true) || (C == true))');
  });

  it('returns the single condition unwrapped', () => {
    const c = ctx([decl('A', 'Boolean')]);
    expect(emitExpr(lowerConditions('and', [cond('A', 'EqualTo', { kind: 'boolean', raw: 'true' })], c)))
      .toBe('A == true');
  });
});
