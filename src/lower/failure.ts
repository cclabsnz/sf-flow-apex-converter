import { ApexTypeError } from '../apex/errors.js';
import { LoweringRefusal } from './context.js';
import { UnsupportedConstructError } from './value.js';

/**
 * The lines to print for a conversion that failed, or undefined when the error
 * is not one of them and must keep propagating.
 *
 * Three error types can reach the CLI, and from the user's point of view the
 * outcome is identical for all three: no `.cls` is written and the message says
 * what stopped it. They stay distinct internally.
 *
 *   - LoweringRefusal — a whole-graph structural failure, carrying every problem.
 *   - UnsupportedConstructError — one construct this milestone does not lower.
 *   - ApexTypeError — a lowering bug, annotated with the element's name by the
 *     boundary in walk.ts. It used to be re-thrown, so an ordinary Flow
 *     comparing a heuristic-missed numeric field against a literal
 *     (`{!Acct.AnnualRevenue} > 1000`, and likewise Probability,
 *     NumberOfEmployees, Quantity) crashed the CLI with a raw Node stack trace.
 *
 * Anything else is a genuine bug and must still crash: dressing an arbitrary
 * TypeError up as a refusal tells the user to fix their Flow when the fault is
 * in this converter.
 */
export function conversionFailureLines(error: unknown): string[] | undefined {
  if (error instanceof LoweringRefusal) return error.problems;
  if (error instanceof UnsupportedConstructError) return [error.message];
  if (error instanceof ApexTypeError) return [error.message];
  return undefined;
}
