import { ApexMethod } from '../apex/class.js';
import { ApexExpr } from '../apex/expr.js';
import { Scope } from '../apex/scope.js';
import { ApexType } from '../apex/types.js';
import { FlowIR } from '../ir/types.js';

/** Where a type came from. Milestone 3 adds 'describe' above 'declared'. */
export type Provenance = 'declared' | 'standard' | 'heuristic';

export interface ResolvedType {
  type: ApexType;
  provenance: Provenance;
  /** Human-readable reason, shown in the generated class for guesses. */
  note: string;
}

export interface TypeSource {
  resolve(reference: string): ResolvedType;
}

export interface LoweringNote {
  kind: 'guess' | 'stub' | 'dependency';
  detail: string;
}

/**
 * A Flow whose structure could not be determined. Carries every problem, not
 * just the first: a developer fixing one shape wants to see the rest.
 */
export class LoweringRefusal extends Error {
  constructor(public readonly problems: string[]) {
    super(`Cannot lower this Flow:\n  - ${problems.join('\n  - ')}`);
    this.name = 'LoweringRefusal';
  }
}

export interface LowerContext {
  ir: FlowIR;
  types: TypeSource;
  scope: Scope;
  /** Flow declaration or element name -> the Apex identifier allocated for it. */
  names: Map<string, string>;
  notes: LoweringNote[];
  /** Private methods generated for untranslatable formulas and actions. */
  stubs: Map<string, ApexMethod>;
  /**
   * Formula name -> the expression it lowers to, populated before the walk.
   *
   * A formula is not a variable and is never declared, so a reference to one
   * must resolve to its stub call or its exact translation. Holding the map
   * here rather than calling into the stub module from value.ts keeps those two
   * modules from importing each other.
   */
  formulas: Map<string, ApexExpr>;
}

/**
 * Whether the Flow itself declares this name.
 *
 * The pivot for who owns a declaration. A name that is BOTH a Flow declaration
 * and element-owned gets its one top-level declaration in lowerFlow, and the
 * element ASSIGNS into it; only element-internal names — those the Flow never
 * declares — declare in place. Declaring in place is correct only for an element
 * at the METHOD's top level: inside an `if` or a `for` the declaration is scoped
 * to that block, and every later reference, the Result assembly included, is
 * "Variable does not exist". Inverting the rule removes the dependence on
 * knowing whether the element is nested.
 *
 * Case-insensitive: Flow and Apex both treat identifiers that way.
 */
export function isFlowDeclared(ctx: LowerContext, flowName: string | undefined): boolean {
  if (flowName === undefined) return false;
  const wanted = flowName.toLowerCase();
  return ctx.ir.declarations.some((d) => d.name.toLowerCase() === wanted);
}

/**
 * The Apex identifier for a Flow name, allocated once and reused.
 *
 * Every Flow name goes through Scope, so a Flow element called `Update` or a
 * variable called `List` cannot produce a class that will not compile.
 */
export function apexName(ctx: LowerContext, flowName: string): string {
  const existing = ctx.names.get(flowName);
  if (existing !== undefined) return existing;
  const allocated = ctx.scope.allocate(flowName);
  ctx.names.set(flowName, allocated);
  return allocated;
}
