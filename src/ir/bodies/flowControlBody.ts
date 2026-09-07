import { readValue, toArray } from '../parseValue.js';
import { ActionBody, FlowParameterBinding, LoopBody, SubflowBody } from '../types.js';

function targetOf(connector: unknown): string | undefined {
  const c = connector as Record<string, unknown> | undefined;
  if (!c || c.targetreference === undefined) return undefined;
  return String(c.targetreference);
}

function bindings(raw: unknown): FlowParameterBinding[] {
  return toArray(raw).map((p) => ({
    name: String(p.name ?? ''),
    value: readValue(p.value),
    target: p.assigntoreference === undefined ? undefined : String(p.assigntoreference),
  }));
}

/**
 * The body of a loop. `collection` is the whole point: it names what the loop walks,
 * which is what the bulkification transform hoists queries against.
 */
export function parseLoopBody(raw: Record<string, unknown>): LoopBody {
  return {
    kind: 'loop',
    collection: String(raw.collectionreference ?? ''),
    iterationOrder: raw.iterationorder === undefined ? undefined : String(raw.iterationorder),
    bodyTarget: targetOf(raw.nextvalueconnector),
    afterTarget: targetOf(raw.nomorevaluesconnector),
  };
}

/** The body of a subflow call: which Flow, and how its parameters are bound. */
export function parseSubflowBody(raw: Record<string, unknown>): SubflowBody {
  return {
    kind: 'subflow',
    flowName: String(raw.flowname ?? ''),
    inputs: bindings(raw.inputassignments),
    outputs: bindings(raw.outputassignments),
  };
}

/** The body of an action call: which action, of which type, and its parameters. */
export function parseActionBody(raw: Record<string, unknown>): ActionBody {
  return {
    kind: 'action',
    actionName: String(raw.actionname ?? ''),
    actionType: String(raw.actiontype ?? ''),
    inputs: bindings(raw.inputparameters),
    outputs: bindings(raw.outputparameters),
  };
}
