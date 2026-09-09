import { emitStmt } from '../../src/apex/emit.js';
import { ApexTypeError } from '../../src/apex/errors.js';
import { Scope } from '../../src/apex/scope.js';
import { FlowDeclaration, FlowIR, FlowNode } from '../../src/ir/types.js';
import { buildCfg } from '../../src/lower/cfg.js';
import { LowerContext, LoweringRefusal } from '../../src/lower/context.js';
import { declarationTypeSource } from '../../src/lower/typeSource.js';
import { lowerFrom } from '../../src/lower/walk.js';

// Copied from tests/lower/cfg.test.ts rather than imported, so the two suites
// stay independent.

function node(name: string, over: Partial<FlowNode> = {}): FlowNode {
  return { name, kind: 'assignments', connectors: [], sourceJson: '{}', raw: {}, ...over };
}

function decision(name: string, ruleTarget: string, defaultTarget: string): FlowNode {
  return node(name, {
    kind: 'decisions',
    // Flow writes branch targets into BOTH rules and connectors. Reading both
    // emits every branch twice, so the CFG must take one and ignore the other.
    connectors: [
      { target: ruleTarget, isFault: false },
      { target: defaultTarget, isFault: false },
    ],
    body: {
      kind: 'decision',
      rules: [{
        name: 'r1', conditionLogic: 'and',
        conditions: [{ left: 'flag', operator: 'IsNull', right: { kind: 'boolean', raw: 'false' } }],
        target: ruleTarget,
      }],
      defaultTarget,
    },
  });
}

function loop(name: string, bodyTarget: string, afterTarget?: string): FlowNode {
  return node(name, {
    kind: 'loops',
    connectors: [{ target: bodyTarget, isFault: false }],
    body: { kind: 'loop', collection: 'items', bodyTarget, afterTarget },
  });
}

function ir(nodes: FlowNode[], entry: string): FlowIR {
  return {
    flowName: 'T', processType: 'AutoLaunchedFlow', declarations: [], nodes,
    unsupported: [],
    start: { triggerKind: 'autolaunched', connector: { target: entry, isFault: false }, sourceJson: '{}' },
  };
}

function makeCtx(ir: FlowIR): LowerContext {
  return {
    ir, types: declarationTypeSource(ir), scope: new Scope(),
    names: new Map(), notes: [], stubs: new Map(), formulas: new Map(),
  };
}

function assignNode(name: string, next: string | undefined, target: string): FlowNode {
  return {
    name, kind: 'assignments', sourceJson: '{}', raw: {},
    connectors: next ? [{ target: next, isFault: false }] : [],
    body: {
      kind: 'assignment',
      items: [{ target, operator: 'Assign', value: { kind: 'string', raw: 'x' } }],
    },
  };
}

const decl = (name: string): FlowDeclaration => ({
  name, kind: 'variable', dataType: 'String', isCollection: false,
  isInput: false, isOutput: false, sourceJson: '{}',
});

describe('lowerFrom', () => {
  it('emits a straight-line sequence in order', () => {
    const flow = ir([assignNode('A', 'B', 'x'), assignNode('B', undefined, 'y')], 'A');
    flow.declarations = [decl('x'), decl('y')];
    const out = lowerFrom(buildCfg(flow), 'A', undefined, makeCtx(flow)).map((s) => emitStmt(s));
    expect(out).toEqual(["x = 'x';", "y = 'x';"]);
  });

  it('stops at the stop node', () => {
    const flow = ir([assignNode('A', 'B', 'x'), assignNode('B', undefined, 'y')], 'A');
    flow.declarations = [decl('x'), decl('y')];
    const out = lowerFrom(buildCfg(flow), 'A', 'B', makeCtx(flow)).map((s) => emitStmt(s));
    expect(out).toEqual(["x = 'x';"]);
  });

  it('emits a decision as if/else and continues once after the join', () => {
    const flow = ir([
      decision('D', 'T', 'F'),
      assignNode('T', 'J', 'x'),
      assignNode('F', 'J', 'y'),
      assignNode('J', undefined, 'z'),
    ], 'D');
    flow.declarations = [decl('x'), decl('y'), decl('z'), decl('flag')];
    const out = lowerFrom(buildCfg(flow), 'D', undefined, makeCtx(flow))
      .map((s) => emitStmt(s)).join('\n');
    expect(out).toContain('if (');
    expect(out).toContain('} else {');
    // The join is emitted once, after the if/else — not duplicated into both.
    expect(out.match(/z = 'x';/g)).toHaveLength(1);
    expect(out.trimEnd().endsWith("z = 'x';")).toBe(true);
  });

  it('emits a loop with its body, then continues after it', () => {
    const flow = ir([
      loop('L', 'B', 'A'),
      assignNode('B', 'L', 'x'),
      assignNode('A', undefined, 'y'),
    ], 'L');
    flow.declarations = [
      decl('x'), decl('y'),
      { name: 'items', kind: 'variable', dataType: 'SObject', objectType: 'Account',
        isCollection: true, isInput: false, isOutput: false, sourceJson: '{}' },
    ];
    const out = lowerFrom(buildCfg(flow), 'L', undefined, makeCtx(flow))
      .map((s) => emitStmt(s)).join('\n');
    expect(out).toContain('for (Account ');
    expect(out).toContain("x = 'x';");
    // The after-target belongs outside the loop.
    expect(out.indexOf("y = 'x';")).toBeGreaterThan(out.indexOf('}'));
  });

  it('wraps an element with a fault connector in try/catch', () => {
    const faulty: FlowNode = {
      ...assignNode('A', 'B', 'x'),
      connectors: [{ target: 'B', isFault: false }, { target: 'F', isFault: true }],
    };
    const flow = ir([faulty, assignNode('B', undefined, 'y'), assignNode('F', undefined, 'z')], 'A');
    flow.declarations = [decl('x'), decl('y'), decl('z')];
    const out = lowerFrom(buildCfg(flow), 'A', undefined, makeCtx(flow))
      .map((s) => emitStmt(s)).join('\n');
    expect(out).toContain('try {');
    expect(out).toContain('} catch (Exception e) {');
    expect(out).toContain("z = 'x';");
    // The element's own statement must be INSIDE the try. Asserting only that the
    // output contains 'try {' passes even when the try body is empty.
    expect(out.indexOf("x = 'x';")).toBeGreaterThan(out.indexOf('try {'));
    expect(out.indexOf("x = 'x';")).toBeLessThan(out.indexOf('} catch'));
    expect(out.indexOf("z = 'x';")).toBeGreaterThan(out.indexOf('} catch'));
  });

  it('emits the tail after a rejoining fault path exactly once', () => {
    // A --fault--> F --> C, alongside A --> B --> C. Lowering the fault path
    // with the ENCLOSING stopAt emitted C inside the catch AND again after it,
    // so on the fault path C ran twice and F's own assignments were
    // overwritten. The correct shape is try { A; B; } catch (Exception e) { F; } C;
    const faulty: FlowNode = {
      ...assignNode('A', 'B', 'x'),
      connectors: [{ target: 'B', isFault: false }, { target: 'F', isFault: true }],
    };
    const flow = ir([
      faulty,
      assignNode('B', 'C', 'y'),
      assignNode('F', 'C', 'z'),
      assignNode('C', undefined, 'tail'),
    ], 'A');
    flow.declarations = [decl('x'), decl('y'), decl('z'), decl('tail')];
    const out = lowerFrom(buildCfg(flow), 'A', undefined, makeCtx(flow))
      .map((s) => emitStmt(s)).join('\n');
    expect(out.match(/tail = 'x';/g)).toHaveLength(1);
    // The tail is the join of the success and fault paths, so it sits AFTER the
    // whole try/catch, not inside either arm.
    expect(out.indexOf("tail = 'x';")).toBeGreaterThan(out.lastIndexOf('}'));
  });

  it('puts the success path inside the try and the fault path inside the catch', () => {
    const faulty: FlowNode = {
      ...assignNode('A', 'B', 'x'),
      connectors: [{ target: 'B', isFault: false }, { target: 'F', isFault: true }],
    };
    const flow = ir([
      faulty,
      assignNode('B', 'C', 'y'),
      assignNode('F', 'C', 'z'),
      assignNode('C', undefined, 'tail'),
    ], 'A');
    flow.declarations = [decl('x'), decl('y'), decl('z'), decl('tail')];
    const out = lowerFrom(buildCfg(flow), 'A', undefined, makeCtx(flow))
      .map((s) => emitStmt(s)).join('\n');
    const catchAt = out.indexOf('} catch (Exception e) {');
    expect(catchAt).toBeGreaterThan(-1);
    // A and its success continuation B are both in the try.
    expect(out.indexOf("x = 'x';")).toBeLessThan(catchAt);
    expect(out.indexOf("y = 'x';")).toBeLessThan(catchAt);
    // F is in the catch, and appears only there.
    expect(out.indexOf("z = 'x';")).toBeGreaterThan(catchAt);
    expect(out.match(/z = 'x';/g)).toHaveLength(1);
    expect(out.match(/y = 'x';/g)).toHaveLength(1);
  });

  it('refuses a decision element with a fault connector rather than dropping it', () => {
    const base = decision('D', 'T', 'F');
    const withFault: FlowNode = {
      ...base,
      connectors: [...base.connectors, { target: 'Err', isFault: true }],
    };
    const flow = ir([
      withFault,
      assignNode('T', undefined, 'x'),
      assignNode('F', undefined, 'y'),
      assignNode('Err', undefined, 'z'),
    ], 'D');
    flow.declarations = [decl('x'), decl('y'), decl('z'), decl('flag')];
    expect(() => lowerFrom(buildCfg(flow), 'D', undefined, makeCtx(flow)))
      .toThrow(LoweringRefusal);
  });

  it('refuses a loop element with a fault connector rather than dropping it', () => {
    const base = loop('L', 'B', 'A');
    const withFault: FlowNode = {
      ...base,
      connectors: [...base.connectors, { target: 'Err', isFault: true }],
    };
    const flow = ir([
      withFault,
      assignNode('B', 'L', 'x'),
      assignNode('A', undefined, 'y'),
      assignNode('Err', undefined, 'z'),
    ], 'L');
    flow.declarations = [
      decl('x'), decl('y'), decl('z'),
      { name: 'items', kind: 'variable', dataType: 'SObject', objectType: 'Account',
        isCollection: true, isInput: false, isOutput: false, sourceJson: '{}' },
    ];
    expect(() => lowerFrom(buildCfg(flow), 'L', undefined, makeCtx(flow)))
      .toThrow(LoweringRefusal);
  });

  it('builds a multi-rule decision back to front: rule 1 outermost, rule 3 innermost, default last', () => {
    const cond = (field: string) => (
      [{ left: field, operator: 'IsNull', right: { kind: 'boolean' as const, raw: 'false' } }]
    );
    const multiRule: FlowNode = node('D', {
      kind: 'decisions',
      connectors: [
        { target: 'R1', isFault: false },
        { target: 'R2', isFault: false },
        { target: 'R3', isFault: false },
        { target: 'DEF', isFault: false },
      ],
      body: {
        kind: 'decision',
        rules: [
          { name: 'r1', conditionLogic: 'and', conditions: cond('a'), target: 'R1' },
          { name: 'r2', conditionLogic: 'and', conditions: cond('b'), target: 'R2' },
          { name: 'r3', conditionLogic: 'and', conditions: cond('c'), target: 'R3' },
        ],
        defaultTarget: 'DEF',
      },
    });
    const flow = ir([
      multiRule,
      assignNode('R1', 'J', 'r1out'),
      assignNode('R2', 'J', 'r2out'),
      assignNode('R3', 'J', 'r3out'),
      assignNode('DEF', 'J', 'defout'),
      assignNode('J', undefined, 'j'),
    ], 'D');
    flow.declarations = [
      decl('r1out'), decl('r2out'), decl('r3out'), decl('defout'), decl('j'),
      decl('a'), decl('b'), decl('c'),
    ];
    const out = lowerFrom(buildCfg(flow), 'D', undefined, makeCtx(flow))
      .map((s) => emitStmt(s)).join('\n');

    const iR1 = out.indexOf("r1out = 'x';");
    const iR2 = out.indexOf("r2out = 'x';");
    const iR3 = out.indexOf("r3out = 'x';");
    const iDef = out.indexOf("defout = 'x';");
    expect(iR1).toBeGreaterThanOrEqual(0);
    expect(iR2).toBeGreaterThanOrEqual(0);
    expect(iR3).toBeGreaterThanOrEqual(0);
    expect(iDef).toBeGreaterThanOrEqual(0);
    // Nested if/else-if/else in Flow's own rule order: rule 1's statement is
    // emitted first (outermost if body), rule 3's last among the rules
    // (innermost else-if body), and the default after all of them.
    expect(iR1).toBeLessThan(iR2);
    expect(iR2).toBeLessThan(iR3);
    expect(iR3).toBeLessThan(iDef);
  });
});

describe('lowerFrom and the element-name boundary for ApexTypeError', () => {
  it("names the decision when a rule's condition cannot be built", () => {
    // Real Flow, real CLI: `{!Acct.AnnualRevenue} > 1000`. The naming heuristic
    // misses AnnualRevenue and guesses String, the comparison constructor
    // refuses String > Decimal, and the error escaped lowerElement's boundary
    // because lowerConditions is called from lowerFrom, not from lowerElement.
    const d = node('D', {
      kind: 'decisions',
      connectors: [{ target: 'T', isFault: false }, { target: 'F', isFault: false }],
      body: {
        kind: 'decision',
        rules: [{
          name: 'Big', conditionLogic: 'and', target: 'T',
          conditions: [{
            left: 'Acct.AnnualRevenue', operator: 'GreaterThan',
            right: { kind: 'number', raw: '1000' },
          }],
        }],
        defaultTarget: 'F',
      },
    });
    const flow = ir([d, assignNode('T', undefined, 'x'), assignNode('F', undefined, 'y')], 'D');
    flow.declarations = [
      { name: 'Acct', kind: 'variable', dataType: 'SObject', objectType: 'Account',
        isCollection: false, isInput: false, isOutput: false, sourceJson: '{}' },
      decl('x'), decl('y'),
    ];
    try {
      lowerFrom(buildCfg(flow), 'D', undefined, makeCtx(flow));
      throw new Error('expected lowerFrom to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ApexTypeError);
      expect((error as Error).message).toContain("While lowering 'D' (decisions)");
    }
  });

  it('names the loop when building it cannot resolve a type', () => {
    // types.resolve is documented never to throw, so this drives the boundary
    // through the TypeSource seam rather than pretending otherwise. The loop
    // branch now also calls assign(), which can throw, and anything added to
    // that branch later should not have to remember to annotate itself.
    const flow = ir([loop('L', 'B', 'A'), assignNode('B', 'L', 'x'), assignNode('A', undefined, 'y')], 'L');
    flow.declarations = [decl('x'), decl('y')];
    const c = makeCtx(flow);
    c.types = {
      resolve: () => {
        throw new ApexTypeError('no type for that');
      },
    };
    try {
      lowerFrom(buildCfg(flow), 'L', undefined, c);
      throw new Error('expected lowerFrom to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ApexTypeError);
      expect((error as Error).message).toContain("While lowering 'L' (loops)");
    }
  });
});

describe('lowerFrom and element-owned names that are also Flow declarations', () => {
  function loopWithVariable(name: string, bodyTarget: string, iterationVariable: string): FlowNode {
    return node(name, {
      kind: 'loops',
      connectors: [{ target: bodyTarget, isFault: false }],
      body: { kind: 'loop', collection: 'items', bodyTarget, iterationVariable },
    });
  }

  const accounts = (name: string, isCollection: boolean): FlowDeclaration => ({
    name, kind: 'variable', dataType: 'SObject', objectType: 'Account',
    isCollection, isInput: false, isOutput: false, sourceJson: '{}',
  });

  it('iterates a separate identifier and copies into a declared loop variable', () => {
    // The Flow declares `Item` itself, so lowerFlow gives it a top-level
    // declaration. Declaring it again in the for-each header is "Variable
    // already defined"; declaring it ONLY there puts it out of scope for
    // anything after the loop.
    const flow = ir([
      loopWithVariable('L', 'B', 'Item'),
      assignNode('B', 'L', 'x'),
    ], 'L');
    flow.declarations = [accounts('items', true), accounts('Item', false), decl('x')];
    const out = lowerFrom(buildCfg(flow), 'L', undefined, makeCtx(flow))
      .map((s) => emitStmt(s)).join('\n');
    expect(out).not.toContain('for (Account Item : items)');
    expect(out).toMatch(/for \(Account (\w+) : items\) \{\n\s+Item = \1;/);
  });

  it('declares an element-internal loop variable in the for-each header', () => {
    // Nothing else declares this name, so the loop owns it outright.
    const flow = ir([
      loopWithVariable('L', 'B', 'Item'),
      assignNode('B', 'L', 'x'),
    ], 'L');
    flow.declarations = [accounts('items', true), decl('x')];
    const out = lowerFrom(buildCfg(flow), 'L', undefined, makeCtx(flow))
      .map((s) => emitStmt(s)).join('\n');
    expect(out).toContain('for (Account Item : items)');
  });
});
