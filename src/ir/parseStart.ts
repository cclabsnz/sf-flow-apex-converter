import { FlowStart } from './types.js';

/** xml2js gives one object for a single occurrence and an array for many. */
function toArray(value: unknown): Record<string, unknown>[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]) as Record<string, unknown>[];
}

export function parseStart(flowData: Record<string, unknown>): FlowStart | undefined {
  const raw = flowData.start as Record<string, unknown> | undefined;
  if (!raw) return undefined;

  const connectorRaw = raw.connector as Record<string, unknown> | undefined;
  // A malformed connector with no target must not fabricate a graph edge —
  // better to have no connector than a lie about where control goes.
  const connectorTarget = connectorRaw?.targetreference;

  return {
    // A Flow with no triggerType runs on demand; naming that explicitly keeps the
    // emitter from having to treat undefined as a meaningful state.
    triggerKind: raw.triggertype === undefined ? 'autolaunched' : String(raw.triggertype),
    object: raw.object === undefined ? undefined : String(raw.object),
    entryCriteria: raw.filterlogic === undefined ? undefined : String(raw.filterlogic),
    filters: raw.filters === undefined ? undefined : toArray(raw.filters),
    connector:
      connectorRaw && connectorTarget !== undefined
        ? { target: String(connectorTarget), isFault: false }
        : undefined,
    sourceJson: JSON.stringify(raw),
  };
}
