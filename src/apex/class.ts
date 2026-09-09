import { emitExpr, emitStmt } from './emit.js';
import { ApexExpr } from './expr.js';
import { ApexStmt } from './stmt.js';
import { ApexType, renderType } from './types.js';

const INDENT = '    ';

export type Visibility = 'public' | 'private' | 'global';
export type Sharing = 'with sharing' | 'without sharing' | 'inherited sharing';

export interface ApexParam {
  type: ApexType;
  name: string;
}

export interface ApexField {
  visibility: Visibility;
  isStatic: boolean;
  isFinal: boolean;
  type: ApexType;
  name: string;
  init: ApexExpr | null;
}

export interface ApexMethod {
  visibility: Visibility;
  isStatic: boolean;
  /** null is void. */
  returnType: ApexType | null;
  name: string;
  params: ApexParam[];
  body: ApexStmt[];
  /** ApexDoc lines, without the comment markers. */
  doc: string[];
}

export interface ApexClass {
  name: string;
  sharing: Sharing;
  doc: string[];
  fields: ApexField[];
  methods: ApexMethod[];
  inner: ApexClass[];
}

// A doc line carries Flow-authored text. An embedded */ would close the comment
// early and turn the rest of the class into unparseable source.
const escapeDocLine = (line: string): string => line.replace(/\*\//g, '*\\/');

/** An ApexDoc block at `pad`, or nothing when there is no documentation. */
function doc(lines: string[], pad: string): string {
  if (lines.length === 0) return '';
  const body = lines.map((l) => `${pad} * ${escapeDocLine(l)}`).join('\n');
  return `${pad}/**\n${body}\n${pad} */\n`;
}

function emitField(f: ApexField, pad: string): string {
  const parts: string[] = [f.visibility];
  if (f.isStatic) parts.push('static');
  if (f.isFinal) parts.push('final');
  parts.push(renderType(f.type), f.name);
  const head = `${pad}${parts.join(' ')}`;
  return f.init === null ? `${head};` : `${head} = ${emitExpr(f.init)};`;
}

function emitMethod(m: ApexMethod, depth: number): string {
  const pad = INDENT.repeat(depth);
  const parts: string[] = [m.visibility];
  if (m.isStatic) parts.push('static');
  parts.push(m.returnType === null ? 'void' : renderType(m.returnType));
  const params = m.params.map((p) => `${renderType(p.type)} ${p.name}`).join(', ');
  const signature = `${pad}${parts.join(' ')} ${m.name}(${params}) {`;
  const body = m.body.map((s) => emitStmt(s, depth + 1)).join('\n');
  const closed = body === '' ? `${signature}\n${pad}}` : `${signature}\n${body}\n${pad}}`;
  return doc(m.doc, pad) + closed;
}

export function emitClass(c: ApexClass, depth = 0): string {
  const pad = INDENT.repeat(depth);
  const members = [
    ...c.fields.map((f) => emitField(f, pad + INDENT)),
    ...c.methods.map((m) => emitMethod(m, depth + 1)),
    ...c.inner.map((i) => emitClass(i, depth + 1)),
  ];
  const header = `${pad}public ${c.sharing} class ${c.name} {`;
  const body = members.join('\n\n');
  const closed = body === '' ? `${header}\n${pad}}` : `${header}\n${body}\n${pad}}`;
  return doc(c.doc, pad) + closed;
}
