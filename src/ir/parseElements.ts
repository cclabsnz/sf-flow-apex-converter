import { FlowConnector, FlowNode, UnsupportedConstruct } from './types.js';

/** Executable element types the IR models. */
export const MODELLED_ELEMENT_TYPES = [
  'actioncalls',
  'assignments',
  'collectionprocessors',
  'decisions',
  'loops',
  'recordcreates',
  'recorddeletes',
  'recordlookups',
  'recordupdates',
  'subflows',
];

/** Executable element types Flow supports that the IR does not model yet. */
const KNOWN_UNMODELLED = [
  'screens',
  'waits',
  'steps',
  'orchestratedstages',
  'customerrors',
  'transforms',
  'apexplugincalls',
  'recordrollbacks',
];

/**
 * Keys that appear at Flow level but are not elements. Listed explicitly so that a
 * genuinely new element type falls through to `unsupported` rather than being
 * mistaken for metadata and dropped.
 */
const FLOW_METADATA_KEYS = new Set([
  'label', 'interviewlabel', 'processtype', 'status', 'apiversion', 'description',
  'processmetadatavalues', 'start', 'variables', 'constants', 'formulas',
  'texttemplates', 'choices', 'dynamicchoicesets', 'sourcetemplate', 'environments',
  'runinmode', 'timezonesidkey', 'triggerorder', '$', 'xmlns',
]);

function toArray(value: unknown): Record<string, unknown>[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]) as Record<string, unknown>[];
}

function connectorFrom(raw: unknown, isFault: boolean): FlowConnector[] {
  return toArray(raw)
    .filter((c) => c.targetreference !== undefined)
    .map((c) => ({ target: String(c.targetreference), isFault }));
}

/** Every outbound edge of an element: normal, decision branches, default, fault. */
function collectConnectors(raw: Record<string, unknown>): FlowConnector[] {
  const edges: FlowConnector[] = [
    ...connectorFrom(raw.connector, false),
    ...connectorFrom(raw.defaultconnector, false),
    ...connectorFrom(raw.nextvalueconnector, false),
    ...connectorFrom(raw.nomorevaluesconnector, false),
    ...connectorFrom(raw.faultconnector, true),
  ];

  // Decision rules each carry their own connector.
  for (const rule of toArray(raw.rules)) {
    edges.push(...connectorFrom(rule.connector, false));
  }

  return edges;
}

export function parseElements(flowData: Record<string, unknown>): {
  nodes: FlowNode[];
  unsupported: UnsupportedConstruct[];
} {
  const nodes: FlowNode[] = [];
  const unsupported: UnsupportedConstruct[] = [];

  for (const [key, value] of Object.entries(flowData)) {
    if (FLOW_METADATA_KEYS.has(key)) continue;

    const modelled = MODELLED_ELEMENT_TYPES.includes(key);

    for (const raw of toArray(value)) {
      if (raw.name === undefined) continue; // not an element shape

      if (!modelled) {
        unsupported.push({
          kind: key,
          name: String(raw.name),
          reason: KNOWN_UNMODELLED.includes(key)
            ? `Flow element type "${key}" is not modelled by the IR yet`
            : `Unrecognised Flow element type "${key}"`,
          sourceJson: JSON.stringify(raw),
        });
        continue;
      }

      nodes.push({
        name: String(raw.name),
        kind: key,
        label: raw.label === undefined ? undefined : String(raw.label),
        connectors: collectConnectors(raw),
        object: raw.object === undefined ? undefined : String(raw.object),
        sourceJson: JSON.stringify(raw),
        raw,
      });
    }
  }

  return { nodes, unsupported };
}
