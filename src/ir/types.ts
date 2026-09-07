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

/**
 * Where a lookup's result field is written back to a variable, e.g.
 * `<outputAssignments><assignToReference>MyVar</assignToReference><field>Id</field></outputAssignments>`.
 *
 * Not modelled as a `FlowFieldAssignment` — that type's `value` is a value being written
 * INTO the field (a `FlowValue` literal/reference on the DML side); here the field is the
 * SOURCE and the reference is the DESTINATION, the opposite direction. Reusing
 * `FlowFieldAssignment` with `{kind:'reference'}` shoehorned into `value` would read
 * backwards at every call site, so this gets its own small type instead.
 */
export interface FlowOutputAssignment {
  field: string;
  assignToReference: string;
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
  /** Variable a lookup's whole record (or list) is stored into, when not auto-stored per field. */
  outputReference?: string;
  /** Per-field output bindings, e.g. `<outputAssignments>` on a lookup with named field outputs. */
  outputAssignments: FlowOutputAssignment[];
  /** Variable a create/update assigns the resulting record Id to. */
  assignRecordIdToReference?: string;
  /** Record variable a create/update/delete takes as its whole input, instead of field-by-field. */
  inputReference?: string;
  /** Field a lookup sorts its query by. */
  sortField?: string;
  /** Sort direction Flow declares, e.g. 'Asc' / 'Desc'. */
  sortOrder?: string;
  /** Row limit on a lookup's query. */
  limit?: number;
  /** True clears the output variable(s) when the lookup finds no records, rather than leaving them untouched. */
  assignNullValuesIfNoRecordsFound: boolean;
}

/** One branch of a decision. */
export interface FlowRule {
  name: string;
  label?: string;
  /** 'and' | 'or' | a custom expression such as '1 AND (2 OR 3)'. */
  conditionLogic: string;
  conditions: FlowConditionIR[];
  /** Element this branch connects to when its conditions hold. */
  target?: string;
}

export interface DecisionBody {
  kind: 'decision';
  rules: FlowRule[];
  defaultTarget?: string;
  defaultLabel?: string;
}

/** One write performed by an assignment element. */
export interface FlowAssignmentItem {
  /** Variable or field the value is written to. */
  target: string;
  /** Flow operator verbatim — 'Assign', 'Add', 'AddItem', 'RemoveAfterFirst', … */
  operator: string;
  value: FlowValue;
}

export interface AssignmentBody {
  kind: 'assignment';
  items: FlowAssignmentItem[];
}

/** An input or output binding on a subflow or action call. */
export interface FlowParameterBinding {
  name: string;
  /** Value passed in. `kind: 'none'` for an output binding. */
  value: FlowValue;
  /** Where an output binding's result is stored. Undefined for inputs. */
  target?: string;
}

export interface LoopBody {
  kind: 'loop';
  /** Collection the loop iterates. */
  collection: string;
  iterationOrder?: string;
  /** First element of the loop body. */
  bodyTarget?: string;
  /** Element reached when the collection is exhausted. */
  afterTarget?: string;
  /** Variable holding the current item on each pass, read from `assignNextValueToReference`. */
  iterationVariable?: string;
}

export interface SubflowBody {
  kind: 'subflow';
  flowName: string;
  inputs: FlowParameterBinding[];
  outputs: FlowParameterBinding[];
  /**
   * When true the subflow's output variables are stored automatically under the
   * subflow's own name rather than only through explicit `outputAssignments` —
   * without this an emitter cannot tell "returns nothing" from "returns something
   * this call didn't bind to a variable".
   */
  storeOutputAutomatically: boolean;
}

export interface ActionBody {
  kind: 'action';
  actionName: string;
  actionType: string;
  inputs: FlowParameterBinding[];
  outputs: FlowParameterBinding[];
  /**
   * When true the action's output is stored automatically (e.g. under the action's own
   * name) rather than through explicit `outputParameters` — an empty `outputs` array
   * alone cannot distinguish "this action returns nothing" from "this action's output
   * is auto-stored", and the emitter needs to know which is true.
   */
  storeOutputAutomatically: boolean;
  /**
   * Generic type bindings on an Apex-invocable action, e.g. an `InvocableVariable`
   * whose Apex type is a generic `List<SObject>` bound to a concrete SObject at
   * design time. Read from `<dataTypeMappings>`; without this the emitter has no way
   * to recover the concrete type argument for the generated Apex call.
   */
  dataTypeMappings: { typeName: string; typeValue: string }[];
}

/** Body of a collectionProcessor (e.g. FilterCollectionProcessor, SortCollectionProcessor). */
export interface CollectionProcessorBody {
  kind: 'collectionProcessor';
  /** Collection variable this processor reads from. */
  collection: string;
  /** e.g. 'FilterCollectionProcessor', 'SortCollectionProcessor'. */
  processorType?: string;
  conditionLogic?: string;
  conditions: FlowConditionIR[];
  /** Variable holding the current item while conditions are evaluated. */
  assignNextValueToReference?: string;
}

/** Typed body of an executable element. Absent when its kind has no parser yet. */
export type FlowBody =
  | RecordBody
  | DecisionBody
  | AssignmentBody
  | LoopBody
  | SubflowBody
  | ActionBody
  | CollectionProcessorBody;

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
  /** Typed body. Undefined means this element kind has no body parser yet — read `raw`. */
  body?: FlowBody;
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
  /** The `<filters>` entries of the start element. Same field/operator/value shape as a record filter. */
  filters?: FlowConditionIR[];
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
