import { methodCall, literal, variable } from '../../apex/expr.js';
import { ApexStmt, assign, collectInto, fieldWrite, invoke, memberWrite } from '../../apex/stmt.js';
import { ApexType, BOOLEAN, INTEGER } from '../../apex/types.js';
import { FlowAssignmentItem, FlowNode } from '../../ir/types.js';
import { LowerContext, apexName } from '../context.js';
import { UnsupportedConstructError, lowerValue } from '../value.js';

/**
 * Resolves `item.target` and confirms it is a List, or refuses.
 *
 * The refusal message distinguishes an unresolved name from a resolved
 * non-collection: `declarationTypeSource` falls back to a String guess for a
 * name the Flow never declares, so an undeclared target would otherwise be
 * reported with `declaredMessage` — e.g. "needs arithmetic" — which sends the
 * reader chasing the wrong problem. An undeclared name is a missing
 * declaration, not a type mismatch.
 */
function requireCollection(
  item: FlowAssignmentItem,
  ctx: LowerContext,
  declaredMessage: string
): ApexType {
  const resolved = ctx.types.resolve(item.target);
  if (resolved.type.kind !== 'List') {
    throw new UnsupportedConstructError(
      resolved.provenance === 'declared'
        ? declaredMessage
        : `'${item.operator}' targets '${item.target}', which this Flow does not declare, ` +
          `so it cannot be confirmed as a collection.`
    );
  }
  return resolved.type;
}

function lowerItem(item: FlowAssignmentItem, ctx: LowerContext): ApexStmt {
  const dot = item.target.indexOf('.');

  switch (item.operator) {
    case 'Assign': {
      const value = lowerValue(item.value, ctx);
      if (dot === -1) return assign(apexName(ctx, item.target), value);

      const head = item.target.slice(0, dot);
      const field = item.target.slice(dot + 1);
      const record = apexName(ctx, head);

      // The head's own declared type (never a heuristic guess — see
      // declarationTypeSource) decides which write Apex accepts: `.put()` on
      // an SObject, or a plain member write on an Apex-defined type. Writing
      // fieldWrite on a non-SObject would compile to a call the value has no
      // .put() method for; memberWrite on an SObject would compile too, but
      // it is the record.ts convention this project uses for SObject writes
      // elsewhere, and only fieldWrite's cast-free `.put()` matches that.
      if (ctx.types.resolve(head).type.kind !== 'SObject') {
        return memberWrite(record, field, value);
      }

      // The field's own type is resolved too, purely to report a name-guessed
      // field here exactly as lowerReference reports it for a read of the
      // same field. Without this, a Flow that only ever writes a guessed
      // field — never reads it — would guess its type with nothing in the
      // header or manifest to show for it.
      const resolved = ctx.types.resolve(item.target);
      if (resolved.provenance === 'heuristic') {
        ctx.notes.push({ kind: 'guess', detail: resolved.note });
      }
      return fieldWrite(record, field, value);
    }

    case 'Add':
    case 'AddItem': {
      // Flow's Add concatenates strings and sums numbers. The AST has no
      // arithmetic or concatenation node, so guessing which one is meant is
      // exactly the invention this project refuses.
      requireCollection(
        item, ctx,
        `'${item.operator}' on non-collection '${item.target}' needs arithmetic, ` +
          `which this milestone does not lower.`
      );
      if (item.value.kind !== 'reference' || !item.value.raw) {
        throw new UnsupportedConstructError(
          `'${item.operator}' on '${item.target}' needs a variable to add.`
        );
      }
      return collectInto(apexName(ctx, item.target), apexName(ctx, item.value.raw));
    }

    case 'RemoveAll': {
      const type = requireCollection(
        item, ctx,
        `'${item.operator}' on non-collection '${item.target}' has no Apex mapping; ` +
          `.clear() applies only to a List.`
      );
      return invoke(methodCall(variable(type, apexName(ctx, item.target)), 'clear', [], BOOLEAN));
    }

    case 'RemoveFirst': {
      const type = requireCollection(
        item, ctx,
        `'${item.operator}' on non-collection '${item.target}' has no Apex mapping; ` +
          `.remove() applies only to a List.`
      );
      return invoke(methodCall(
        variable(type, apexName(ctx, item.target)), 'remove', [literal(INTEGER, '0')], BOOLEAN
      ));
    }

    default:
      throw new UnsupportedConstructError(
        `Flow assignment operator '${item.operator}' has no Apex mapping in this milestone.`
      );
  }
}

export function lowerAssignment(node: FlowNode, ctx: LowerContext): ApexStmt[] {
  if (node.body?.kind !== 'assignment') {
    throw new UnsupportedConstructError(`${node.name} has no assignment body.`);
  }
  return node.body.items.map((item) => lowerItem(item, ctx));
}
