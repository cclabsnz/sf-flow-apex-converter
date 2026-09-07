import { ApexExpr } from './expr.js';
import { renderSoql } from './soql.js';
import { ApexStmt } from './stmt.js';
import { renderType } from './types.js';

const INDENT = '    ';

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
      return `${emitExpr(e.left)} ${e.op} ${emitExpr(e.right)}`;
    case 'logical':
      return e.operands.map(emitExpr).join(` ${e.op} `);
    case 'nullTest':
      return `${emitExpr(e.operand)} ${e.negated ? '!=' : '=='} null`;
    case 'methodCall':
      return `${emitExpr(e.target)}.${e.method}(${e.args.map(emitExpr).join(', ')})`;
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
