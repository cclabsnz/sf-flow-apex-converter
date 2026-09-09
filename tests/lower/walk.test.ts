import { emitStmt } from '../../src/apex/emit.js';
import { Scope } from '../../src/apex/scope.js';
import { FlowDeclaration, FlowIR, FlowNode } from '../../src/ir/types.js';
import { buildCfg } from '../../src/lower/cfg.js';
import { LowerContext } from '../../src/lower/context.js';
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
  });
});
