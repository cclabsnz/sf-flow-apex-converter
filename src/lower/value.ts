import { ApexExpr, fieldRead, literal, methodCall, stringLiteral, variable } from '../apex/expr.js';
import { BOOLEAN, DECIMAL, NULL, sobjectType } from '../apex/types.js';
import { FlowValue } from '../ir/types.js';
import { LowerContext, apexName } from './context.js';

/**
 * A construct this milestone does not translate.
 *
 * Distinct from LoweringRefusal, which is a whole-Flow structural failure.
 * This is raised at one element and reported by name — never guessed around.
 */
export class UnsupportedConstructError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedConstructError';
  }
}

/** `$Permission.X` and friends. Each is mapped deliberately or refused. */
function lowerGlobal(reference: string): ApexExpr {
  const [head, ...rest] = reference.split('.');
  if (head === '$Permission' && rest.length === 1) {
    return methodCall(
      variable(sobjectType('FeatureManagement'), 'FeatureManagement'),
      'checkPermission',
      [stringLiteral(rest[0])],
      BOOLEAN
    );
  }
  throw new UnsupportedConstructError(
    `Global reference '${reference}' has no Apex mapping in this milestone.`
  );
}

/** A Flow reference: a variable, or a dotted path into an SObject. */
export function lowerReference(reference: string, ctx: LowerContext): ApexExpr {
  if (reference.startsWith('$')) return lowerGlobal(reference);

  // A formula is not a variable and is never declared, so a reference to one
  // resolves to the expression lowerFlow registered for it.
  const formula = ctx.formulas.get(reference);
  if (formula) return formula;

  // A dotted path is split on the FIRST dot, so `{!CaseVar.Contact.Email}` used
  // to emit ((String)CaseVar.get('Contact.Email')). That COMPILES and throws
  // System.SObjectException at run time, which the acceptance gate cannot see —
  // and the class header listed it as a guessed TYPE, implying the field is real.
  // Lowering it needs the relationship's target object, which no describe is
  // available to supply in this milestone. Checked before resolve(), so a
  // reference that is refused leaves no type guess behind claiming otherwise.
  if (reference.split('.').length > 2) {
    throw new UnsupportedConstructError(
      `Reference '${reference}' traverses a relationship, which this milestone does not ` +
        `lower. Resolving the related object needs a describe; a single get() with a dotted ` +
        `field name compiles and throws at run time instead.`
    );
  }

  const resolved = ctx.types.resolve(reference);
  if (resolved.provenance === 'heuristic') {
    ctx.notes.push({ kind: 'guess', detail: resolved.note });
  }

  const dot = reference.indexOf('.');
  if (dot === -1) return variable(resolved.type, apexName(ctx, reference));

  const head = reference.slice(0, dot);
  const field = reference.slice(dot + 1);
  return fieldRead(apexName(ctx, head), field, resolved.type);
}

export function lowerValue(value: FlowValue, ctx: LowerContext): ApexExpr {
  switch (value.kind) {
    case 'string':
      return stringLiteral(value.raw ?? '');
    case 'number':
      return literal(DECIMAL, value.raw ?? '0');
    case 'boolean':
      return literal(BOOLEAN, value.raw === 'true' ? 'true' : 'false');
    case 'none':
      return literal(NULL, 'null');
    case 'reference':
      return lowerReference(value.raw ?? '', ctx);
    default:
      // date, datetime, apex, sobject, formula, setupReference. Each needs a
      // deliberate mapping; none is guessed.
      throw new UnsupportedConstructError(
        `Flow value of kind '${value.kind}' has no Apex mapping in this milestone.`
      );
  }
}
