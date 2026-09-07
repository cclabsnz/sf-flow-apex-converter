import { readValue, toArray } from '../parseValue.js';
import { ActionBody, FlowParameterBinding, LoopBody, SubflowBody } from '../types.js';

function toBool(value: unknown): boolean {
  return String(value) === 'true';
}

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
 * which is what the bulkification transform hoists queries against. `iterationVariable`
 * names the per-pass current-item variable, which every reference inside the loop body
 * resolves against.
 */
export function parseLoopBody(raw: Record<string, unknown>): LoopBody {
  return {
    kind: 'loop',
    collection: String(raw.collectionreference ?? ''),
    iterationOrder: raw.iterationorder === undefined ? undefined : String(raw.iterationorder),
    bodyTarget: targetOf(raw.nextvalueconnector),
    afterTarget: targetOf(raw.nomorevaluesconnector),
    iterationVariable: raw.assignnextvaluetoreference === undefined
      ? undefined
      : String(raw.assignnextvaluetoreference),
  };
}

/** The body of a subflow call: which Flow, and how its parameters are bound. */
export function parseSubflowBody(raw: Record<string, unknown>): SubflowBody {
  return {
    kind: 'subflow',
    flowName: String(raw.flowname ?? ''),
    inputs: bindings(raw.inputassignments),
    outputs: bindings(raw.outputassignments),
    storeOutputAutomatically: toBool(raw.storeoutputautomatically),
  };
}

/**
 * The body of an action call: which action, of which type, and its parameters.
 *
 * `storeOutputAutomatically` and `dataTypeMappings` exist because `outputs: []` alone
 * is ambiguous: an action with `storeOutputAutomatically: true` and no
 * `outputParameters` genuinely produces a value — it is just stored under the action's
 * own name rather than through an explicit binding — and `dataTypeMappings` is the only
 * place a generic Apex-invocable's concrete type argument (e.g. `List<SObject>` bound to
 * `LLC_BI__Loan__c`) is recorded.
 */
export function parseActionBody(raw: Record<string, unknown>): ActionBody {
  return {
    kind: 'action',
    actionName: String(raw.actionname ?? ''),
    actionType: String(raw.actiontype ?? ''),
    inputs: bindings(raw.inputparameters),
    outputs: bindings(raw.outputparameters),
    storeOutputAutomatically: toBool(raw.storeoutputautomatically),
    dataTypeMappings: toArray(raw.datatypemappings).map((m) => ({
      typeName: String(m.typename ?? ''),
      typeValue: String(m.typevalue ?? ''),
    })),
  };
}
