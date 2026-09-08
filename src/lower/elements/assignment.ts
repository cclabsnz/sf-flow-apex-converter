import { methodCall, literal, variable } from '../../apex/expr.js';
import { ApexStmt, assign, collectInto, invoke, memberWrite } from '../../apex/stmt.js';
import { BOOLEAN, INTEGER } from '../../apex/types.js';
import { FlowAssignmentItem, FlowNode } from '../../ir/types.js';
import { LowerContext, apexName } from '../context.js';
import { UnsupportedConstructError, lowerValue } from '../value.js';

function isCollection(reference: string, ctx: LowerContext): boolean {
  return ctx.types.resolve(reference).type.kind === 'List';
}

function lowerItem(item: FlowAssignmentItem, ctx: LowerContext): ApexStmt {
  const dot = item.target.indexOf('.');

  switch (item.operator) {
    case 'Assign': {
      const value = lowerValue(item.value, ctx);
      if (dot === -1) return assign(apexName(ctx, item.target), value);
      return memberWrite(
        apexName(ctx, item.target.slice(0, dot)),
        item.target.slice(dot + 1),
        value
      );
    }

    case 'Add':
    case 'AddItem': {
      if (!isCollection(item.target, ctx)) {
        // Flow's Add concatenates strings and sums numbers. The AST has no
        // arithmetic or concatenation node, so guessing which one is meant is
        // exactly the invention this project refuses.
        throw new UnsupportedConstructError(
          `'${item.operator}' on non-collection '${item.target}' needs arithmetic, ` +
            `which this milestone does not lower.`
        );
      }
      if (item.value.kind !== 'reference' || !item.value.raw) {
        throw new UnsupportedConstructError(
          `'${item.operator}' on '${item.target}' needs a variable to add.`
        );
      }
      return collectInto(apexName(ctx, item.target), apexName(ctx, item.value.raw));
    }

    case 'RemoveAll':
      return invoke(methodCall(
        variable(ctx.types.resolve(item.target).type, apexName(ctx, item.target)),
        'clear', [], BOOLEAN
      ));

    case 'RemoveFirst':
      return invoke(methodCall(
        variable(ctx.types.resolve(item.target).type, apexName(ctx, item.target)),
        'remove', [literal(INTEGER, '0')], BOOLEAN
      ));

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
