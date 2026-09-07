import { readValue, toArray } from '../parseValue.js';
import { AssignmentBody, FlowAssignmentItem } from '../types.js';

/**
 * The body of an assignment: what it writes, with which operator, to where.
 *
 * Operators are kept as Flow spells them. Translating 'Add' to '+=' or '.add()'
 * depends on whether the target is a collection, which needs field type information
 * this layer does not have — deciding it here would bake in exactly the kind of
 * guess the emitter exists to avoid.
 */
export function parseAssignmentBody(raw: Record<string, unknown>): AssignmentBody {
  const items: FlowAssignmentItem[] = toArray(raw.assignmentitems).map((i) => ({
    target: String(i.assigntoreference ?? ''),
    operator: String(i.operator ?? ''),
    value: readValue(i.value),
  }));

  return { kind: 'assignment', items };
}
