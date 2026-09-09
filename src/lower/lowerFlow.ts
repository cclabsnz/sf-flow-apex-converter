import { ApexClass, ApexField, ApexMethod, ApexParam, emitClass } from '../apex/class.js';
import { Scope } from '../apex/scope.js';
import { construct, variable } from '../apex/expr.js';
import { ApexStmt, declare, memberWrite, returnStmt } from '../apex/stmt.js';
import { ApexType, sobjectType } from '../apex/types.js';
import { FlowDeclaration, FlowIR } from '../ir/types.js';
import { buildCfg, checkStructure } from './cfg.js';
import { LowerContext, LoweringRefusal, apexName } from './context.js';
import { lowerFormula } from './elements/stubs.js';
import { declarationTypeSource, flowTypeToApex } from './typeSource.js';
import { lowerValue } from './value.js';
import { lowerFrom } from './walk.js';

export interface Manifest {
  flowName: string;
  className: string;
  guesses: string[];
  stubs: string[];
  dependencies: string[];
  unsupported: string[];
  /**
   * For a record-triggered Flow, the line to add to the org's existing trigger.
   *
   * The overall spec's decision is that the converter emits the handler class
   * and never a trigger file: it cannot know whether a trigger already exists on
   * the object, and a second one fires in undefined order relative to the first.
   */
  delegation?: string;
}

export interface LoweredFlow {
  apexClass: ApexClass;
  source: string;
  manifest: Manifest;
}

function sharingOf(runInMode: string | undefined): ApexClass['sharing'] {
  if (runInMode === undefined) return 'with sharing';
  const mode = runInMode.toLowerCase();
  if (mode.includes('withoutsharing')) return 'without sharing';
  if (mode.includes('default')) return 'inherited sharing';
  return 'with sharing';
}

/**
 * Notes are a faithful log: the same guessed field read twice through separate
 * elements legitimately produces two identical entries in `ctx.notes`, because
 * neither element knows about the other. Deduplicating there would falsify the
 * log. Rendering is the right place to collapse repeats — a reader of the
 * header or the manifest wants each distinct guess once, not an inflated count.
 */
function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

export function lowerFlow(ir: FlowIR): LoweredFlow {
  const cfg = buildCfg(ir);
  const structure = checkStructure(cfg);
  if (!structure.ok) throw new LoweringRefusal(structure.problems);

  const scope = new Scope();
  const className = scope.allocate(ir.flowName);
  const ctx: LowerContext = {
    ir,
    types: declarationTypeSource(ir),
    scope: scope.child(),
    names: new Map(),
    notes: [],
    stubs: new Map(),
    formulas: new Map(),
  };

  const params: ApexParam[] = [];
  const fields: ApexField[] = [];
  const locals: ApexStmt[] = [];
  const outputs: { declaration: FlowDeclaration; type: ApexType; name: string }[] = [];

  // Some elements declare their own local as part of lowering, and Flow Builder
  // still lists that same name in <variables> (or as a formula's implicit
  // dependency), so it also appears in ir.declarations:
  //   - a record lookup emits its own `List<T> name = [...]` for its
  //     outputReference (see lowerLookup in elements/record.ts);
  //   - a collection processor's `for (T item : ...)` declares its
  //     assignNextValueToReference (see lowerCollectionProcessor);
  //   - a loop's `for (T item : ...)` declares its iterationVariable
  //     (see lowerFrom in walk.ts).
  // Pre-declaring the same name again below produces "Duplicate variable" —
  // confirmed by the real compiler, not just a guess about Apex scoping —
  // and the class will not deploy. Those names are the element's to declare,
  // not lowerFlow's.
  const declaredByElement = new Set(
    ir.nodes
      .flatMap((n): string[] => {
        if (n.kind === 'recordlookups' && n.body?.kind === 'record') {
          return n.body.outputReference ? [n.body.outputReference] : [];
        }
        if (n.body?.kind === 'collectionProcessor') {
          return n.body.assignNextValueToReference ? [n.body.assignNextValueToReference] : [];
        }
        if (n.body?.kind === 'loop') {
          return n.body.iterationVariable ? [n.body.iterationVariable] : [];
        }
        return [];
      })
      .map((name) => name.toLowerCase())
  );

  for (const d of ir.declarations) {
    const type = flowTypeToApex(d.dataType, d.objectType, d.isCollection, d.apexClass);
    const name = apexName(ctx, d.name);

    if (d.kind === 'formula') {
      // Registers a stub, or resolves to an exact translation. Either way the
      // expression must exist before any element references the formula, which
      // is why declarations are processed before the walk.
      ctx.formulas.set(d.name, lowerFormula(d, ctx));
      continue;
    }
    if (d.kind === 'constant') {
      fields.push({
        visibility: 'private', isStatic: true, isFinal: true, type, name,
        init: d.value ? lowerValue(d.value, ctx) : null,
      });
      continue;
    }
    if (d.isInput) {
      // A Get Records element would redeclare the parameter under the same
      // name, which Apex also rejects. Refuse rather than emit either
      // ordering of a class that cannot compile.
      if (declaredByElement.has(d.name.toLowerCase())) {
        throw new LoweringRefusal([
          `'${d.name}' is both an input parameter and a Get Records outputReference; ` +
            'the generated element would redeclare the parameter, which Apex rejects.',
        ]);
      }
      params.push({ type, name });
      continue;
    }
    if (d.isOutput) outputs.push({ declaration: d, type, name });
    if (!declaredByElement.has(d.name.toLowerCase())) {
      // A collection left null-initialised NPEs on its first .add() inside a
      // loop or an AddItem assignment — one of the most common Flow shapes
      // there is. A scalar stays null: pre-constructing an SObject local
      // would mask "no record found", which is meaningful Flow behaviour.
      locals.push(declare(type, name, d.isCollection ? construct(type, []) : null));
    }
  }

  const body: ApexStmt[] = [...locals, ...lowerFrom(cfg, cfg.entry, undefined, ctx)];

  // Outputs become public fields on a returned Result, so a caller can read
  // what the Flow produced. Without this the values are computed and discarded.
  const inner: ApexClass[] = [];
  let returnType: ApexType | null = null;
  if (outputs.length > 0) {
    const resultType = sobjectType('Result');
    inner.push({
      name: 'Result',
      sharing: 'with sharing',
      doc: ["The Flow's output variables."],
      fields: outputs.map((o) => ({
        visibility: 'public' as const, isStatic: false, isFinal: false,
        type: o.type, name: o.name, init: null,
      })),
      methods: [],
      inner: [],
    });
    const resultVar = ctx.scope.allocate('result');
    body.push(declare(resultType, resultVar, construct(resultType, [])));
    for (const o of outputs) {
      body.push(memberWrite(resultVar, o.name, variable(o.type, o.name)));
    }
    body.push(returnStmt(variable(resultType, resultVar)));
    returnType = resultType;
  }

  // See dedupe(): notes are a faithful log of every guess as it happened, so
  // the same guessed field read twice legitimately appears twice in ctx.notes.
  // Rendering collapses that here, for both the header and the manifest.
  const guesses = dedupe(ctx.notes.filter((n) => n.kind === 'guess').map((n) => n.detail));
  const stubs = dedupe(ctx.notes.filter((n) => n.kind === 'stub').map((n) => n.detail));
  const dependencies = dedupe(ctx.notes.filter((n) => n.kind === 'dependency').map((n) => n.detail));
  const unsupported = ir.unsupported.map((u) => `${u.kind} ${u.name ?? ''}: ${u.reason}`.trim());

  const doc = [
    `Generated from Flow: ${ir.flowName}.`,
    'Do not edit by hand; re-run the converter instead.',
    '',
    'This output is NOT bulkified. It preserves the Flow\'s semantics exactly,',
    'including per-record DML inside loops. Bulkification is a later milestone.',
  ];
  if (guesses.length > 0) {
    doc.push('', 'Field types GUESSED from naming, not from a describe:');
    for (const g of guesses) doc.push(`  - ${g}`);
  }
  if (stubs.length > 0) {
    doc.push('', 'Not translated — these methods throw until implemented:');
    for (const s of stubs) doc.push(`  - ${s}`);
  }
  if (dependencies.length > 0) {
    doc.push('', 'Requires separately converted Flows:');
    for (const d of dependencies) doc.push(`  - ${d}`);
  }

  const execute: ApexMethod = {
    visibility: 'public', isStatic: true, returnType, name: 'execute',
    params, body, doc: [],
  };

  const apexClass: ApexClass = {
    name: className,
    sharing: sharingOf(ir.runInMode),
    doc,
    fields,
    methods: [execute, ...ctx.stubs.values()],
    inner,
  };

  return {
    apexClass,
    source: emitClass(apexClass),
    manifest: {
      flowName: ir.flowName, className, guesses, stubs, dependencies, unsupported,
      delegation: ir.start?.object
        ? `${className}.execute(Trigger.new);  // add to the existing ${ir.start.object} trigger`
        : undefined,
    },
  };
}
