import { FlowIR, FlowNode } from '../../src/ir/types.js';
import { buildCfg, checkStructure, immediatePostDominator } from '../../src/lower/cfg.js';

function node(name: string, over: Partial<FlowNode> = {}): FlowNode {
  return { name, kind: 'assignments', connectors: [], sourceJson: '{}', raw: {}, ...over };
}

function plain(name: string, next?: string): FlowNode {
  return node(name, { connectors: next ? [{ target: next, isFault: false }] : [] });
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
      rules: [{ name: 'r1', conditionLogic: 'and', conditions: [], target: ruleTarget }],
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

describe('buildCfg', () => {
  it('takes decision edges from rules, not from duplicated connectors', () => {
    const cfg = buildCfg(ir([decision('D', 'A', 'B'), plain('A'), plain('B')], 'D'));
    const kinds = cfg.successors('D').map((e) => `${e.kind}:${e.to}`).sort();
    expect(kinds).toEqual(['default:B', 'rule:A']);
  });

  it('takes loop edges from bodyTarget and afterTarget', () => {
    const cfg = buildCfg(ir([loop('L', 'A', 'B'), plain('A', 'L'), plain('B')], 'L'));
    const kinds = cfg.successors('L').map((e) => `${e.kind}:${e.to}`).sort();
    expect(kinds).toEqual(['after:B', 'body:A']);
  });

  it('keeps fault edges as a separate kind', () => {
    const n = node('A', {
      connectors: [
        { target: 'B', isFault: false },
        { target: 'F', isFault: true },
      ],
    });
    const cfg = buildCfg(ir([n, plain('B'), plain('F')], 'A'));
    expect(cfg.successors('A').map((e) => e.kind).sort()).toEqual(['fault', 'next']);
  });

  it('records the entry from the start element', () => {
    expect(buildCfg(ir([plain('A')], 'A')).entry).toBe('A');
  });

  it('computes predecessors', () => {
    const cfg = buildCfg(ir([decision('D', 'A', 'B'), plain('A', 'B'), plain('B')], 'D'));
    expect(cfg.predecessors('B').map((e) => e.from).sort()).toEqual(['A', 'D']);
  });
});

describe('immediatePostDominator', () => {
  it('finds the join where two branches reconverge', () => {
    // D -> A -> J, D -> J. The join is J.
    const cfg = buildCfg(ir([decision('D', 'A', 'J'), plain('A', 'J'), plain('J')], 'D'));
    expect(immediatePostDominator(cfg, 'D')).toBe('J');
  });

  it('finds the join when both branches have bodies', () => {
    const cfg = buildCfg(ir(
      [decision('D', 'A', 'B'), plain('A', 'J'), plain('B', 'J'), plain('J')], 'D'));
    expect(immediatePostDominator(cfg, 'D')).toBe('J');
  });

  it('returns undefined when branches never reconverge', () => {
    const cfg = buildCfg(ir([decision('D', 'A', 'B'), plain('A'), plain('B')], 'D'));
    expect(immediatePostDominator(cfg, 'D')).toBeUndefined();
  });

  it('skips a node that only one branch passes through', () => {
    // D -> A -> J, D -> J. A post-dominates nothing, so it is not the join.
    const cfg = buildCfg(ir([decision('D', 'A', 'J'), plain('A', 'J'), plain('J')], 'D'));
    expect(immediatePostDominator(cfg, 'D')).not.toBe('A');
  });

  it('finds the join inside a loop that has no afterTarget', () => {
    // A loop with no "after last" connector never adds a node with zero real
    // successors to the live graph: the loop body cycles back into the loop
    // forever, and there is nothing else after it. Without a virtual exit for
    // that implicit termination, the O(n^2) fixpoint never shrinks below "all
    // nodes reachable", and immediatePostDominator returns whichever node
    // happens to be first in declaration order instead of the loop itself —
    // which is why the loop node is declared last here, not first.
    const cfg = buildCfg(ir(
      [plain('A', 'L'), plain('B', 'L'), decision('D', 'A', 'B'), loop('L', 'D')], 'L'));
    expect(immediatePostDominator(cfg, 'D')).toBe('L');
  });

  it('picks the nearest join when several nodes post-dominate', () => {
    // pdom(D) = {D, J, K}: both J and K are candidates, and only the selection
    // rule distinguishes them. Without this, swapping .every for .some in
    // immediatePostDominator passes every other test in this file.
    const cfg = buildCfg(ir([
      decision('D', 'A', 'B'),
      plain('A', 'J'),
      plain('B', 'J'),
      plain('J', 'K'),
      plain('K'),
    ], 'D'));
    expect(immediatePostDominator(cfg, 'D')).toBe('J');
  });
});

describe('checkStructure', () => {
  it('accepts a decision whose branches join', () => {
    const cfg = buildCfg(ir(
      [decision('D', 'A', 'B'), plain('A', 'J'), plain('B', 'J'), plain('J')], 'D'));
    expect(checkStructure(cfg).ok).toBe(true);
  });

  it('accepts a decision whose branches both terminate', () => {
    const cfg = buildCfg(ir([decision('D', 'A', 'B'), plain('A'), plain('B')], 'D'));
    expect(checkStructure(cfg).ok).toBe(true);
  });

  it('accepts a loop whose body returns to the loop node', () => {
    const cfg = buildCfg(ir([loop('L', 'A', 'B'), plain('A', 'L'), plain('B')], 'L'));
    expect(checkStructure(cfg).ok).toBe(true);
  });

  it('refuses a back-edge that does not target a loop node', () => {
    // A -> B -> A is a cycle with no loop element to structure it.
    const cfg = buildCfg(ir([plain('A', 'B'), plain('B', 'A')], 'A'));
    const report = checkStructure(cfg);
    expect(report.ok).toBe(false);
    expect(report.problems.join(' ')).toMatch(/back-edge/i);
  });

  it('names the offending nodes in the report', () => {
    const cfg = buildCfg(ir([plain('A', 'B'), plain('B', 'A')], 'A'));
    expect(checkStructure(cfg).problems.join(' ')).toContain('B');
  });

  it('reports unreachable nodes', () => {
    const cfg = buildCfg(ir([plain('A'), plain('Orphan')], 'A'));
    const report = checkStructure(cfg);
    expect(report.ok).toBe(false);
    expect(report.problems.join(' ')).toMatch(/unreachable.*Orphan/i);
  });

  it('reports an edge to a node that does not exist', () => {
    const cfg = buildCfg(ir([plain('A', 'Missing')], 'A'));
    const report = checkStructure(cfg);
    expect(report.ok).toBe(false);
    expect(report.problems.join(' ')).toContain('Missing');
  });
});
