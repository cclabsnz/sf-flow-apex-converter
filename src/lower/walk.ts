import { ApexTypeError } from '../apex/errors.js';
import { ApexStmt, forEach, ifThen, tryCatch } from '../apex/stmt.js';
import { sobjectType } from '../apex/types.js';
import { FlowNode } from '../ir/types.js';
import { Cfg, immediatePostDominator } from './cfg.js';
import { LowerContext, LoweringRefusal, apexName } from './context.js';
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
  try {
    return lowerElementBody(node, ctx);
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
        const condition = lowerConditions(rule.conditionLogic, rule.conditions, ctx);
        const body = lowerFrom(cfg, rule.target, join, ctx);
        built = [ifThen(condition, body, built)];
      }
      out.push(...built);
      current = join;
      continue;
    }

    if (node.body?.kind === 'loop') {
      const collection = node.body.collection;
      const collectionType = ctx.types.resolve(collection).type;
      const elementType = collectionType.kind === 'List' ? collectionType.of : sobjectType();
      const item = apexName(ctx, node.body.iterationVariable ?? node.name);
      out.push(forEach(
        elementType,
        item,
        apexName(ctx, collection),
        lowerFrom(cfg, node.body.bodyTarget, current, ctx)
      ));
      current = node.body.afterTarget;
      continue;
    }

    const own = lowerElement(node, ctx);
    const fault = faultTarget(node);
    if (fault) {
      out.push(tryCatch(own, 'e', lowerFrom(cfg, fault, stopAt, ctx)));
    } else {
      out.push(...own);
    }
    current = cfg.successors(current).find((e) => e.kind === 'next')?.to;
  }

  return out;
}
