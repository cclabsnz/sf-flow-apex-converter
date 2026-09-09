import { ApexTypeError } from '../apex/errors.js';
import { ApexStmt, assign, forEach, ifThen, tryCatch } from '../apex/stmt.js';
import { variable } from '../apex/expr.js';
import { sobjectType } from '../apex/types.js';
import { FlowNode } from '../ir/types.js';
import { Cfg, immediatePostDominator, postDominators } from './cfg.js';
import { LowerContext, LoweringRefusal, apexName, isFlowDeclared } from './context.js';
import { lowerConditions } from './condition.js';
import { lowerAssignment } from './elements/assignment.js';
import { lowerCollectionProcessor } from './elements/collectionProcessor.js';
import { lowerRecord } from './elements/record.js';
import { lowerAction, lowerSubflow } from './elements/stubs.js';

/**
 * One element's own statements, ignoring control flow.
 *
 * An ApexTypeError escaping a lowering is a bug in this module, not user error.
 * It is re-thrown with the element's name so the failure points at the Flow
 * element that produced the invalid tree rather than at a constructor.
 */
export function lowerElement(node: FlowNode, ctx: LowerContext): ApexStmt[] {
  return inElement(node, () => lowerElementBody(node, ctx));
}

/**
 * Runs `build` inside the element-name boundary.
 *
 * Decision and loop elements are not lowered through lowerElement — lowerFrom
 * builds their control flow itself — so their calls into lowerConditions and the
 * TypeSource sat OUTSIDE this boundary, and an ApexTypeError from them reached
 * the CLI as a raw stack trace naming a constructor. Wrapping only the element's
 * own construction, never the recursive lowerFrom calls, keeps a nested
 * element's failure named after the nested element rather than its ancestor.
 */
function inElement<T>(node: FlowNode, build: () => T): T {
  try {
    return build();
  } catch (error) {
    if (error instanceof ApexTypeError) {
      throw new ApexTypeError(`While lowering '${node.name}' (${node.kind}): ${error.message}`);
    }
    throw error;
  }
}

function lowerElementBody(node: FlowNode, ctx: LowerContext): ApexStmt[] {
  switch (node.kind) {
    case 'assignments':
      return lowerAssignment(node, ctx);
    case 'recordlookups':
    case 'recordcreates':
    case 'recordupdates':
    case 'recorddeletes':
      return lowerRecord(node, ctx);
    case 'collectionprocessors':
      return lowerCollectionProcessor(node, ctx);
    case 'subflows':
      return lowerSubflow(node, ctx);
    case 'actioncalls':
      return lowerAction(node, ctx);
    default:
      throw new LoweringRefusal([
        `Element '${node.name}' is of kind '${node.kind}', which this milestone does not lower.`,
      ]);
  }
}

/** The fault target of an element, if it declares one. */
function faultTarget(node: FlowNode): string | undefined {
  return node.connectors.find((c) => c.isFault)?.target;
}

/** Whether every path out of `from` passes through `through`. */
function postDominates(cfg: Cfg, through: string, from: string): boolean {
  return postDominators(cfg).get(from)?.has(through) === true;
}

/**
 * The join where an element's success and fault paths reconverge, guaranteed to
 * be a node the CURRENT walk would itself have stopped at.
 *
 * The C4 fix computed this as `immediatePostDominator(cfg, current)` and handed
 * it to both arms, on the premise that "the join can never be past stopAt:
 * if stopAt post-dominates this node then the NEAREST post-dominator is at or
 * before it". The conclusion is sound; the premise is not always true. A fault
 * edge out of a LOOP BODY bypasses the back-edge, so the loop element does not
 * post-dominate the faulting element — and then the computed join is either
 * undefined (the fault path ends the Flow) or a node past the loop. Either way
 * it REPLACED the loop's own stop, and since the success successor is the
 * back-edge, lowerFrom re-entered the loop element with a fresh `guard` set and
 * recursed until the stack blew: `RangeError: Maximum call stack size exceeded`
 * on two otherwise ordinary Flows.
 *
 * So the premise is checked rather than assumed. When it holds, the join is at
 * or before `stopAt` and both arms are finite. When it does not, the fault path
 * escapes the enclosing block, and reproducing it needs an early exit — a
 * `break` out of the for-each, or a `return` — that this milestone's AST cannot
 * express. Clamping to `stopAt` instead would compile and be wrong: the loop
 * would carry on iterating after a fault that ends the Flow, and the code after
 * the loop would be emitted both inside the catch and again after it. This
 * refuses instead.
 */
function faultJoin(
  cfg: Cfg,
  node: FlowNode,
  current: string,
  stopAt: string | undefined
): string | undefined {
  const join = immediatePostDominator(cfg, current);
  // No enclosing block to escape: an undefined join simply walks each arm to
  // the end of the Flow, which is exactly what a fault path ending the Flow
  // means at the method's top level.
  if (stopAt === undefined) return join;
  // Reaching the enclosing stop itself is inside the region by definition —
  // both arms stop there, and the walk resumes from it.
  if (join === stopAt) return stopAt;
  if (postDominates(cfg, stopAt, current)) return join ?? stopAt;
  throw new LoweringRefusal([
    `${node.name} has a fault connector whose fault path leaves the block that encloses it: ` +
      (join === undefined
        ? `the success and fault paths never rejoin inside the block ending at '${stopAt}'. `
        : `the success and fault paths rejoin at '${join}', outside the block ending at ` +
          `'${stopAt}'. `) +
      `Reproducing that needs an early exit from that block — a break out of the loop, or a ` +
      `return — which this milestone does not emit. Refusing rather than emitting code that ` +
      `carries on inside the block after the fault.`,
  ]);
}

/**
 * Walk the graph from `start`, stopping when `stopAt` is reached.
 *
 * `stopAt` is what makes a decision's branches finite: each branch is walked up
 * to the join, and the join's statements are emitted once afterwards rather
 * than duplicated into every branch.
 */
export function lowerFrom(
  cfg: Cfg,
  start: string | undefined,
  stopAt: string | undefined,
  ctx: LowerContext
): ApexStmt[] {
  const out: ApexStmt[] = [];
  const guard = new Set<string>();
  let current = start;

  while (current !== undefined && current !== stopAt) {
    if (guard.has(current)) {
      // checkStructure should have caught this. If it did not, refusing here
      // is still better than emitting a partial class or looping forever.
      throw new LoweringRefusal([`Cycle through '${current}' could not be structured.`]);
    }
    guard.add(current);

    const node = cfg.node(current);
    if (!node) break;

    // cfg emits fault edges for every node kind, and the IR collects faultConnector
    // generically, but only the generic branch below wraps them in try/catch. A
    // decision or loop carrying one would have its fault path silently dropped.
    if ((node.body?.kind === 'decision' || node.body?.kind === 'loop') && faultTarget(node)) {
      throw new LoweringRefusal([
        `${node.name} is a ${node.body.kind} element with a fault connector, which this ` +
          `milestone does not lower. Refusing rather than dropping the fault path.`,
      ]);
    }

    if (node.body?.kind === 'decision') {
      const join = immediatePostDominator(cfg, current);

      // Rules become if / else-if in declaration order; the default is the else.
      const rules = node.body.rules;
      // Built back to front, so rule 1 ends up outermost and the default is
      // the innermost else — an if / else-if / else chain in Flow's own order.
      let built: ApexStmt[] = node.body.defaultTarget
        ? lowerFrom(cfg, node.body.defaultTarget, join, ctx)
        : [];
      for (let i = rules.length - 1; i >= 0; i -= 1) {
        const rule = rules[i];
        const condition = inElement(
          node,
          () => lowerConditions(rule.conditionLogic, rule.conditions, ctx)
        );
        const body = lowerFrom(cfg, rule.target, join, ctx);
        built = [ifThen(condition, body, built)];
      }
      out.push(...built);
      current = join;
      continue;
    }

    if (node.body?.kind === 'loop') {
      const loopBody = node.body;
      const collection = loopBody.collection;
      const collectionType = inElement(node, () => ctx.types.resolve(collection).type);
      const elementType = collectionType.kind === 'List' ? collectionType.of : sobjectType();
      const iterationVariable = loopBody.iterationVariable ?? node.name;
      const item = apexName(ctx, iterationVariable);
      // A for-each header always DECLARES its iteration variable. When the Flow
      // declares that name too (see isFlowDeclared), lowerFlow has already
      // emitted its top-level declaration — declaring it again here is "Variable
      // already defined", and declaring it ONLY here block-scopes it, so a loop
      // inside a decision branch leaves every later reference out of scope. The
      // loop then iterates a separate, Scope-allocated identifier and copies
      // each item into the declared name.
      const declaredItem = isFlowDeclared(ctx, iterationVariable);
      const cursor = declaredItem ? ctx.scope.allocate(`${item}_item`) : item;
      const copy: ApexStmt[] = inElement(
        node,
        () => (declaredItem ? [assign(item, variable(elementType, cursor))] : [])
      );
      const body = lowerFrom(cfg, loopBody.bodyTarget, current, ctx);
      out.push(inElement(
        node,
        () => forEach(elementType, cursor, apexName(ctx, collection), [...copy, ...body])
      ));
      current = loopBody.afterTarget;
      continue;
    }

    const own = lowerElement(node, ctx);
    const success = cfg.successors(current).find((e) => e.kind === 'next')?.to;
    const fault = faultTarget(node);
    if (fault) {
      // A fault path that REJOINS the success path is the common shape: both
      // reach some element C and carry on together. Lowering the fault path with
      // the enclosing stopAt, and leaving the success path outside the try,
      // emitted C inside the catch AND again after it — so on the fault path C
      // ran twice and the fault handler's own assignments were overwritten.
      //
      // The correct shape is `try { A; B; } catch (Exception e) { F; } C;` where
      // C is the join of the two paths. The fault edge is in the CFG, so
      // immediatePostDominator sees both and returns exactly that join; it is
      // undefined when the paths never reconverge, which walks each to the end
      // inside its own arm. faultJoin adds the part C4 assumed rather than
      // checked: the join it returns is always a node THIS walk would itself
      // have stopped at, so neither arm can outrun the enclosing stop.
      const join = faultJoin(cfg, node, current, stopAt);
      out.push(tryCatch(
        [...own, ...lowerFrom(cfg, success, join, ctx)],
        'e',
        lowerFrom(cfg, fault, join, ctx)
      ));
      current = join;
      continue;
    }
    out.push(...own);
    current = success;
  }

  return out;
}
