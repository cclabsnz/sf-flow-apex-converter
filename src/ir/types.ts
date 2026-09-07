/** A literal value as Flow expresses it, before any Apex typing decision. */
export interface FlowValue {
  kind: 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'reference' | 'none';
  /** Raw text of the literal, or the referenced name when kind === 'reference'. */
  raw?: string;
}

/** variables, constants, formulas, textTemplates — anything declared, not executed. */
export interface FlowDeclaration {
  name: string;
  kind: 'variable' | 'constant' | 'formula' | 'textTemplate';
  dataType: string;
  isCollection: boolean;
  isInput: boolean;
  isOutput: boolean;
  /** Present for formulas and textTemplates. Flow formula syntax, untranslated. */
  expression?: string;
  value?: FlowValue;
  /** JSON view of the parsed element, for reporting a construct back to the developer. Not verbatim XML — xml2js discards source positions; raw capture arrives in Milestone 2. */
  sourceJson: string;
}

export interface FlowConnector {
  target: string;
  /** True when this edge is the element's fault path. */
  isFault: boolean;
}

/** One executable element. */
export interface FlowNode {
  name: string;
  /** Lowercased Flow element type, e.g. 'recordlookups'. */
  kind: string;
  label?: string;
  connectors: FlowConnector[];
  /** Object the element operates on, where the Flow declares one. */
  object?: string;
  /** JSON view of the parsed element, for reporting a construct back to the developer. Not verbatim XML — xml2js discards source positions; raw capture arrives in Milestone 2. */
  sourceJson: string;
  /** Everything the parser read but does not yet model, kept for the emitter. */
  raw: Record<string, unknown>;
}

export interface FlowStart {
  /** 'autolaunched' when the Flow has no trigger; otherwise the Flow's triggerType. */
  triggerKind: string;
  object?: string;
  entryCriteria?: string;
  connector?: FlowConnector;
  /** JSON view of the parsed element, for reporting a construct back to the developer. Not verbatim XML — xml2js discards source positions; raw capture arrives in Milestone 2. */
  sourceJson: string;
}

/** A construct the parser recognised but does not model. Never silently dropped. */
export interface UnsupportedConstruct {
  kind: string;
  name?: string;
  reason: string;
  /** JSON view of the parsed element, for reporting a construct back to the developer. Not verbatim XML — xml2js discards source positions; raw capture arrives in Milestone 2. */
  sourceJson: string;
}

export interface FlowIR {
  flowName: string;
  processType: string;
  start?: FlowStart;
  declarations: FlowDeclaration[];
  nodes: FlowNode[];
  unsupported: UnsupportedConstruct[];
}
