/** A literal value as Flow expresses it, before any Apex typing decision. */
export interface FlowValue {
  kind:
    | 'string'
    | 'number'
    | 'boolean'
    | 'date'
    | 'datetime'
    | 'reference'
    | 'apex'
    | 'sobject'
    | 'formula'
    | 'setupReference'
    | 'none';
  /** Raw text of the literal, or the referenced name when kind === 'reference'. */
  raw?: string;
}

/** One Flow condition, as written — no Apex typing decision is made here. */
export interface FlowConditionIR {
  /** Left-hand reference, e.g. 'Loop_over_Loans.LLC_BI__Amount__c'. */
  left: string;
  /** Flow operator verbatim, e.g. 'EqualTo', 'IsNull', 'GreaterThan'. */
  operator: string;
  right: FlowValue;
}

/** A field write on a record create or update. */
export interface FlowFieldAssignment {
  field: string;
  value: FlowValue;
}

/** Body of recordLookups / recordCreates / recordUpdates / recordDeletes. */
export interface RecordBody {
  kind: 'record';
  object?: string;
  filterLogic?: string;
  filters: FlowConditionIR[];
  inputAssignments: FlowFieldAssignment[];
  /** Fields the lookup asks for. Empty means the Flow did not restrict them. */
  queriedFields: string[];
  getFirstRecordOnly: boolean;
  storeOutputAutomatically: boolean;
}

/** variables, constants, formulas, textTemplates — anything declared, not executed. */
export interface FlowDeclaration {
  name: string;
  kind: 'variable' | 'constant' | 'formula' | 'textTemplate';
  dataType: string;
  isCollection: boolean;
  isInput: boolean;
  isOutput: boolean;
  /**
   * The declaration's body, untranslated Flow syntax. For a formula this is
   * `<expression>`. For a textTemplate — which the Flow metadata schema gives no
   * `expression` or `dataType` field at all — this is `<text>`, the template body.
   */
  expression?: string;
  value?: FlowValue;
  /** The real SObject type for a variable/collection whose dataType is 'SObject'. Read from `<objectType>`. */
  objectType?: string;
  /** The Apex class for a variable whose dataType is 'Apex'. Read from `<apexClass>`. */
  apexClass?: string;
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
  /** The `<filters>` entries of the start element, raw and untranslated. */
  filters?: Record<string, unknown>[];
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
  /** Determines `with sharing` vs `without sharing` in generated Apex. Read from `<runInMode>`. */
  runInMode?: string;
  start?: FlowStart;
  declarations: FlowDeclaration[];
  nodes: FlowNode[];
  unsupported: UnsupportedConstruct[];
}
