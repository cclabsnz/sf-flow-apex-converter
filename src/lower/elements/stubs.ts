import { ApexMethod } from '../../apex/class.js';
import { ApexExpr, methodCall, staticCall, variable } from '../../apex/expr.js';
import { ApexStmt, invoke, throwStmt } from '../../apex/stmt.js';
import { ApexType, BOOLEAN, sobjectType } from '../../apex/types.js';
import { FlowDeclaration, FlowNode } from '../../ir/types.js';
import { LowerContext, apexName } from '../context.js';
import { UnsupportedConstructError, lowerReference } from '../value.js';
import { flowTypeToApex } from '../typeSource.js';

/** `{!Some.Reference}` and nothing else — no functions, no operators. */
const BARE_REFERENCE = /^\{!([A-Za-z_][A-Za-z0-9_.$]*)\}$/;

/**
 * A private method that compiles and throws.
 *
 * Deliberately not a typed default. A Boolean formula returning false silently
 * takes the wrong branch, which is the defect class this project exists to
 * remove; throwing fails loudly the first time the path is exercised.
 */
function throwingStub(
  name: string,
  returnType: ApexType | null,
  doc: string[],
  message: string
): ApexMethod {
  return {
    visibility: 'private',
    isStatic: true,
    returnType,
    name,
    params: [],
    doc,
    body: [throwStmt(message)],
  };
}

export function formulaStub(declaration: FlowDeclaration, ctx: LowerContext): string {
  const name = apexName(ctx, `formula_${declaration.name}`);
  if (ctx.stubs.has(name)) return name;

  const expression = declaration.expression ?? '';
  const method = throwingStub(
    name,
    flowTypeToApex(declaration.dataType, declaration.objectType, declaration.isCollection),
    [
      `TODO: Flow formula '${declaration.name}' is not translated.`,
      `Flow expression: ${expression}`,
      'Formula translation arrives in a later milestone. Implement this method',
      'before running the converted class.',
    ],
    `Formula ${declaration.name} is not translated: ${expression}`
  );
  ctx.stubs.set(name, method);
  ctx.notes.push({ kind: 'stub', detail: `formula ${declaration.name}: ${expression}` });
  return name;
}

/**
 * A formula reference.
 *
 * A formula that is only a reference — `{!Loop.Field__c}` — needs no engine and
 * is translated exactly. Anything with a function becomes a stub call.
 */
export function lowerFormula(declaration: FlowDeclaration, ctx: LowerContext): ApexExpr {
  const bare = BARE_REFERENCE.exec((declaration.expression ?? '').trim());
  if (bare) return lowerReference(bare[1], ctx);

  const name = formulaStub(declaration, ctx);
  return staticCall(
    name,
    [],
    flowTypeToApex(declaration.dataType, declaration.objectType, declaration.isCollection)
  );
}

export function lowerSubflow(node: FlowNode, ctx: LowerContext): ApexStmt[] {
  const body = node.body;
  if (body?.kind !== 'subflow') {
    throw new UnsupportedConstructError(`${node.name} has no subflow body.`);
  }
  ctx.notes.push({
    kind: 'dependency',
    detail: `subflow ${body.flowName} must be converted separately`,
  });
  const target = ctx.scope.allocate(body.flowName);
  return [invoke(methodCall(
    variable(sobjectType(target), target), 'execute', [], BOOLEAN
  ))];
}

export function lowerAction(node: FlowNode, ctx: LowerContext): ApexStmt[] {
  const body = node.body;
  if (body?.kind !== 'action') {
    throw new UnsupportedConstructError(`${node.name} has no action body.`);
  }

  const name = apexName(ctx, `action_${node.name}`);
  const bindings = body.inputs
    .map((i) => `${i.name} = ${i.value.raw ?? i.value.kind}`)
    .join(', ');
  const mappings = body.dataTypeMappings
    .map((m) => `${m.typeName} = ${m.typeValue}`)
    .join(', ');

  const method = throwingStub(name, null, [
    `TODO: Flow action '${body.actionName}' (type ${body.actionType}) is not translated.`,
    `Inputs: ${bindings || 'none'}`,
    `Type bindings: ${mappings || 'none'}`,
    "The invocable's method name and request wrapper are not visible to the",
    'converter, so no call is generated rather than inventing a signature.',
  ], `Action ${body.actionName} is not translated`);
  ctx.stubs.set(name, method);
  ctx.notes.push({ kind: 'stub', detail: `action ${body.actionName} (${body.actionType})` });

  return [invoke(staticCall(name, [], BOOLEAN))];
}
