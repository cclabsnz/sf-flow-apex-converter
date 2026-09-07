import { parseCondition, toArray } from '../parseValue.js';
import { DecisionBody, FlowRule } from '../types.js';

function targetOf(connector: unknown): string | undefined {
  const c = connector as Record<string, unknown> | undefined;
  if (!c || c.targetreference === undefined) return undefined;
  return String(c.targetreference);
}

/**
 * The body of a decision: its branches, each with its conditions and where it goes.
 *
 * `conditionLogic` is kept verbatim rather than normalised to and/or, because Flow
 * permits custom expressions like '1 AND (2 OR 3)' that index the conditions by
 * position. Collapsing that to a boolean operator loses the expression.
 */
export function parseDecisionBody(raw: Record<string, unknown>): DecisionBody {
  const rules: FlowRule[] = toArray(raw.rules).map((r) => ({
    name: String(r.name ?? ''),
    label: r.label === undefined ? undefined : String(r.label),
    conditionLogic: String(r.conditionlogic ?? 'and'),
    conditions: toArray(r.conditions).map(parseCondition),
    target: targetOf(r.connector),
  }));

  return {
    kind: 'decision',
    rules,
    defaultTarget: targetOf(raw.defaultconnector),
    defaultLabel: raw.defaultconnectorlabel === undefined ? undefined : String(raw.defaultconnectorlabel),
  };
}
