import { ApexExpr } from './expr.js';
import { renderSoql } from './soql.js';
import { ApexStmt } from './stmt.js';
import { renderType } from './types.js';

const INDENT = '    ';

/** Nodes that render as an infix operator expression, and so can be re-parsed. */
function isInfix(e: ApexExpr): boolean {
  return (
    e.node === 'comparison' ||
    e.node === 'equality' ||
    e.node === 'logical' ||
    e.node === 'nullTest'
  );
}

/**
 * Renders `child` for use as an operand of `parent`, parenthesised when the
 * emitted text could re-parse into a different tree than the AST describes.
 *
 * This is not cosmetic. Apex binds `&&` tighter than `||` and `==` tighter than
 * both, so joining operands with no parens silently changes meaning: the AST
 * `(p || q) && r` emitted as `p || q && r` parses as `p || (q && r)`, which for
 * p=true q=false r=false evaluates to true where the tree says false. That
 * compiles cleanly, so nothing downstream catches it.
 *
 * The rule is deliberately blunt — parenthesise every infix operand rather than
 * only those precedence strictly requires. Generated Apex gets read by humans
 * reviewing a conversion, and an explicit `(a > 1) && (b != null)` costs two
 * characters while removing any need to know Apex's precedence table. The one
 * exception is a chain of the same logical operator, which is associative and
 * where parens would be pure noise.
 */
function operand(child: ApexExpr, parent: ApexExpr): string {
  const text = emitExpr(child);
  if (!isInfix(child)) return text;
  if (parent.node === 'logical' && child.node === 'logical' && child.op === parent.op) {
    return text;
  }
  return `(${text})`;
}

export function emitExpr(e: ApexExpr): string {
  switch (e.node) {
    case 'literal':
      return e.text;
    case 'variable':
      return e.name;
    case 'fieldRead':
      // The cast is not optional: record.get() returns Object.
      return `((${renderType(e.type)})${e.record}.get('${e.field}'))`;
    case 'comparison':
    case 'equality':
      return `${operand(e.left, e)} ${e.op} ${operand(e.right, e)}`;
    case 'logical':
      return e.operands.map((o) => operand(o, e)).join(` ${e.op} `);
    case 'nullTest':
      return `${operand(e.operand, e)} ${e.negated ? '!=' : '=='} null`;
    case 'methodCall':
      return `${operand(e.target, e)}.${e.method}(${e.args.map(emitExpr).join(', ')})`;
  }
}

function block(body: ApexStmt[], depth: number): string {
  return body.map((s) => emitStmt(s, depth)).join('\n');
}

export function emitStmt(s: ApexStmt, depth = 0): string {
  const pad = INDENT.repeat(depth);
  switch (s.stmt) {
    case 'declare':
      return s.init === null
        ? `${pad}${renderType(s.type)} ${s.name};`
        : `${pad}${renderType(s.type)} ${s.name} = ${emitExpr(s.init)};`;
    case 'assign':
      return `${pad}${s.name} = ${emitExpr(s.value)};`;
    case 'fieldWrite':
      return `${pad}${s.record}.put('${s.field}', ${emitExpr(s.value)});`;
    case 'collectInto':
      return `${pad}${s.collection}.add(${s.record});`;
    case 'queryInto': {
      const q = renderSoql(s.query)
        .split('\n')
        .map((line) => `${pad}${INDENT}${line}`)
        .join('\n');
      return `${pad}${renderType(s.type)} ${s.name} = [\n${q}\n${pad}];`;
    }
    case 'ifThen':
      return `${pad}if (${emitExpr(s.condition)}) {\n${block(s.body, depth + 1)}\n${pad}}`;
    case 'forEach':
      return (
        `${pad}for (${renderType(s.itemType)} ${s.item} : ${s.collection}) {\n` +
        `${block(s.body, depth + 1)}\n${pad}}`
      );
    case 'dmlBulk': {
      const call = `Database.${s.operation}(${s.collection}, AccessLevel.USER_MODE);`;
      return `${pad}if (!${s.collection}.isEmpty()) {\n${pad}${INDENT}${call}\n${pad}}`;
    }
  }
}
