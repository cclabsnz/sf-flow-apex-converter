import { FlowStart } from './types.js';

export function parseStart(flowData: Record<string, unknown>): FlowStart | undefined {
  const raw = flowData.start as Record<string, unknown> | undefined;
  if (!raw) return undefined;

  const connectorRaw = raw.connector as Record<string, unknown> | undefined;

  return {
    // A Flow with no triggerType runs on demand; naming that explicitly keeps the
    // emitter from having to treat undefined as a meaningful state.
    triggerKind: raw.triggertype === undefined ? 'autolaunched' : String(raw.triggertype),
    object: raw.object === undefined ? undefined : String(raw.object),
    entryCriteria: raw.filterlogic === undefined ? undefined : String(raw.filterlogic),
    connector: connectorRaw
      ? { target: String(connectorRaw.targetreference), isFault: false }
      : undefined,
    sourceJson: JSON.stringify(raw),
  };
}
