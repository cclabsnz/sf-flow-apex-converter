import { FlowIR, FlowNode } from '../ir/types.js';

export type EdgeKind = 'next' | 'rule' | 'default' | 'body' | 'after' | 'fault';

export interface CfgEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}

export interface Cfg {
  entry?: string;
  /** Node names in declaration order, for stable diagnostics. */
  order: string[];
  node(name: string): FlowNode | undefined;
  successors(name: string): CfgEdge[];
  predecessors(name: string): CfgEdge[];
}

/**
 * Successor edges for one element.
 *
 * Decision and loop elements write their targets into BOTH the typed body and
 * `connectors[]` — the same edges twice. The body is authoritative; reading
 * `connectors` as well would emit every branch and every loop body twice.
 * Fault connectors are the exception: they appear only in `connectors[]`.
 */
function edgesFor(n: FlowNode): CfgEdge[] {
  const edges: CfgEdge[] = [];
  const faults = n.connectors.filter((c) => c.isFault);
  const normal = n.connectors.filter((c) => !c.isFault);

  if (n.body?.kind === 'decision') {
    for (const rule of n.body.rules) {
      if (rule.target) edges.push({ from: n.name, to: rule.target, kind: 'rule' });
    }
    if (n.body.defaultTarget) {
      edges.push({ from: n.name, to: n.body.defaultTarget, kind: 'default' });
    }
  } else if (n.body?.kind === 'loop') {
    if (n.body.bodyTarget) edges.push({ from: n.name, to: n.body.bodyTarget, kind: 'body' });
    if (n.body.afterTarget) edges.push({ from: n.name, to: n.body.afterTarget, kind: 'after' });
  } else {
    for (const c of normal) edges.push({ from: n.name, to: c.target, kind: 'next' });
  }

  for (const f of faults) edges.push({ from: n.name, to: f.target, kind: 'fault' });
  return edges;
}

export function buildCfg(ir: FlowIR): Cfg {
  const nodes = new Map<string, FlowNode>();
  for (const n of ir.nodes) nodes.set(n.name, n);

  const succ = new Map<string, CfgEdge[]>();
  const pred = new Map<string, CfgEdge[]>();
  for (const n of ir.nodes) {
    const edges = edgesFor(n);
    succ.set(n.name, edges);
    for (const e of edges) {
      const list = pred.get(e.to) ?? [];
      list.push(e);
      pred.set(e.to, list);
    }
  }

  return {
    entry: ir.start?.connector?.target,
    order: ir.nodes.map((n) => n.name),
    node: (name) => nodes.get(name),
    successors: (name) => succ.get(name) ?? [],
    predecessors: (name) => pred.get(name) ?? [],
  };
}

/** Nodes reachable from the entry, following every edge kind. */
export function reachable(cfg: Cfg): Set<string> {
  const seen = new Set<string>();
  const stack = cfg.entry ? [cfg.entry] : [];
  while (stack.length > 0) {
    const name = stack.pop() as string;
    if (seen.has(name)) continue;
    seen.add(name);
    for (const e of cfg.successors(name)) stack.push(e.to);
  }
  return seen;
}

/**
 * A sentinel that cannot collide with a real Flow API name (those are
 * restricted to alphanumerics and underscores), used below to give every
 * node a genuine path to termination.
 */
const EXIT = ' exit ';

/**
 * A node's successors for post-dominance purposes, with a path to the virtual
 * EXIT sentinel added wherever the real graph has none.
 *
 * A Flow element with no connector is a real dead end, and already gets one.
 * A loop with no "after last" connector is the case the real edges miss: its
 * only modelled successor is its own body, which cycles back into it forever,
 * so the live graph can end up with no node at all that has zero successors —
 * every element eventually funnels into that loop. Without a virtual exit for
 * that implicit termination (the Flow simply ends once the collection is
 * exhausted), the fixpoint below never shrinks below "every node reachable",
 * and every node appears to post-dominate every other one.
 */
function exitingSuccessors(cfg: Cfg, live: Set<string>, name: string): string[] {
  const real = cfg.successors(name).map((e) => e.to).filter((t) => live.has(t));
  const node = cfg.node(name);
  if (node?.body?.kind === 'loop' && node.body.afterTarget === undefined) {
    return [...real, EXIT];
  }
  return real.length === 0 ? [EXIT] : real;
}

/**
 * Post-dominator sets by iterative dataflow on the reversed graph.
 *
 * Deliberately the simple O(n^2) formulation rather than Lengauer-Tarjan. These
 * graphs are tens of nodes, and this version can be checked by hand against the
 * test cases — which matters more here than speed.
 */
export function postDominators(cfg: Cfg): Map<string, Set<string>> {
  const live = reachable(cfg);
  const names = cfg.order.filter((n) => live.has(n));
  const all = new Set([...names, EXIT]);

  const pdom = new Map<string, Set<string>>();
  pdom.set(EXIT, new Set([EXIT]));
  for (const n of names) pdom.set(n, new Set(all));

  let changed = true;
  while (changed) {
    changed = false;
    for (const n of names) {
      const succs = exitingSuccessors(cfg, live, n);
      let next: Set<string> = new Set(pdom.get(succs[0]) ?? []);
      for (const s of succs.slice(1)) {
        const other = pdom.get(s) ?? new Set<string>();
        next = new Set([...next].filter((x) => other.has(x)));
      }
      next.add(n);
      const before = pdom.get(n) as Set<string>;
      if (before.size !== next.size || [...next].some((x) => !before.has(x))) {
        pdom.set(n, next);
        changed = true;
      }
    }
  }
  return pdom;
}

/**
 * The nearest node every path out of `node` must pass through — the join where
 * a decision's branches reconverge. Undefined when they never do.
 */
export function immediatePostDominator(cfg: Cfg, node: string): string | undefined {
  const pdom = postDominators(cfg);
  // EXIT is the virtual sentinel postDominators adds for implicit termination
  // (see exitingSuccessors); it names no real element, so it can never be the
  // join two branches reconverge at.
  const candidates = [...(pdom.get(node) ?? [])].filter((n) => n !== node && n !== EXIT);
  if (candidates.length === 0) return undefined;
  // The immediate one is post-dominated by every other candidate.
  for (const c of candidates) {
    const cSet = pdom.get(c) ?? new Set<string>();
    if (candidates.every((other) => other === c || cSet.has(other))) return c;
  }
  return undefined;
}

export interface StructureReport {
  ok: boolean;
  problems: string[];
}

/**
 * Whether this graph can be rebuilt as structured Apex.
 *
 * A refusal is a whole-Flow failure. Half a class whose control flow was
 * guessed is worse than no class, so every problem is collected and reported
 * together rather than throwing on the first.
 */
export function checkStructure(cfg: Cfg): StructureReport {
  const problems: string[] = [];
  const live = reachable(cfg);

  for (const name of cfg.order) {
    for (const e of cfg.successors(name)) {
      if (!cfg.node(e.to)) {
        problems.push(`${name} connects to '${e.to}', which is not an element in this Flow.`);
      }
    }
  }

  for (const name of cfg.order) {
    if (!live.has(name)) {
      problems.push(`Unreachable from the Flow's start element: ${name}.`);
    }
  }

  // Every cycle must be closed by a loop element. A back-edge to anything else
  // is a goto, and Apex has no goto.
  const state = new Map<string, 'open' | 'done'>();
  const walk = (name: string): void => {
    state.set(name, 'open');
    for (const e of cfg.successors(name)) {
      if (!cfg.node(e.to)) continue;
      const seen = state.get(e.to);
      if (seen === 'open') {
        const target = cfg.node(e.to);
        if (target?.body?.kind !== 'loop') {
          problems.push(
            `${name} has a back-edge to ${e.to}, which is not a loop element. ` +
              `Apex has no goto, so this cycle cannot be structured.`
          );
        }
      } else if (seen === undefined) {
        walk(e.to);
      }
    }
    state.set(name, 'done');
  };
  if (cfg.entry && cfg.node(cfg.entry)) walk(cfg.entry);

  // A decision whose branches never reconverge is NOT a refusal. Each branch
  // simply runs to the end of the Flow, which lowerFrom handles with an
  // undefined stop node.
  //
  // An outcome with NO CONNECTOR AT ALL is a different shape, and it is refused.
  // An outcome with no connector means the Flow ENDS on that path. It produces no
  // edge, so the decision looks single-successor, the branch lowers to nothing, and
  // the other branch's statements run on both paths — compiling, and wrong.
  //
  // Lowering it faithfully needs an early return that interacts with the Result
  // assembly, which is a later milestone. Refusing is honest and cheap. Only
  // reachable decisions are checked: an unreachable one is already reported by
  // its own rule above, and a second problem for a branch that never executes
  // is noise.
  for (const name of cfg.order) {
    if (!live.has(name)) continue;
    const body = cfg.node(name)?.body;
    if (body?.kind !== 'decision') continue;
    for (const rule of body.rules) {
      if (rule.target === undefined) {
        problems.push(
          `Decision ${name}: outcome '${rule.label ?? rule.name}' has no connector, which in ` +
            `Flow means the interview ends on that path. This milestone cannot lower an early ` +
            `end; connect the outcome, or wait for early-return lowering.`
        );
      }
    }
    if (body.defaultTarget === undefined) {
      problems.push(
        `Decision ${name}: the default outcome ('${body.defaultLabel ?? 'Default Outcome'}') has ` +
          `no connector, which in Flow means the interview ends on that path. This milestone ` +
          `cannot lower an early end; connect the outcome, or wait for early-return lowering.`
      );
    }
  }

  return { ok: problems.length === 0, problems };
}
