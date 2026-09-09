import { ApexMethod } from '../../apex/class.js';
import { ApexExpr, methodCall, staticCall, variable } from '../../apex/expr.js';
import { RESERVED } from '../../apex/scope.js';
import { ApexStmt, declare, invoke, throwStmt } from '../../apex/stmt.js';
import { ApexType, BOOLEAN, sobjectType } from '../../apex/types.js';
import { FlowDeclaration, FlowNode } from '../../ir/types.js';
import { LowerContext, apexName } from '../context.js';
import { UnsupportedConstructError, lowerReference } from '../value.js';
import { flowTypeToApex } from '../typeSource.js';

/**
 * `{!Some.Reference}` and nothing else — no functions, no operators.
 *
 * The leading `$?` admits a global reference such as `{!$Permission.CanApprove}`,
 * which lowerReference already translates exactly — excluding it would send a
 * common, fully-translatable pattern to a stub for no reason.
 */
const BARE_REFERENCE = /^\{!(\$?[A-Za-z_][A-Za-z0-9_.$]*)\}$/;

const APEX_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;

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
    flowTypeToApex(declaration.dataType, declaration.objectType, declaration.isCollection, declaration.apexClass),
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
  if (bare) {
    const referenced = lowerReference(bare[1], ctx);
    // The formula's own <dataType> is Flow metadata, guaranteed consistent with
    // its expression by the Flow it came from. The field it reads may resolve
    // to a heuristic guess (declarationTypeSource has no describe to check
    // against), and that guess can disagree with the formula's declared type —
    // e.g. a field named without an is/has/flag prefix guessed as String, for
    // a formula declared Boolean. The declared type wins: it is not a guess,
    // and a mismatch here would make every use of the formula fail to compile
    // (`formula == true` comparing String with Boolean).
    const declaredType = flowTypeToApex(
      declaration.dataType, declaration.objectType, declaration.isCollection, declaration.apexClass
    );
    return referenced.type.kind === declaredType.kind
      ? referenced
      : { ...referenced, type: declaredType };
  }

  const name = formulaStub(declaration, ctx);
  return staticCall(
    name,
    [],
    flowTypeToApex(declaration.dataType, declaration.objectType, declaration.isCollection, declaration.apexClass)
  );
}

export function lowerSubflow(node: FlowNode, ctx: LowerContext): ApexStmt[] {
  const body = node.body;
  if (body?.kind !== 'subflow') {
    throw new UnsupportedConstructError(`${node.name} has no subflow body.`);
  }

  // A subflow names a class this converter does not generate, so it cannot be
  // renamed on collision the way a local can. Running it through Scope turned a
  // second reference to NC_Validate into NC_Validate2 — a class that does not
  // exist, or worse, a different one that does.
  if (!APEX_IDENTIFIER.test(body.flowName) || RESERVED.has(body.flowName.toLowerCase())) {
    throw new UnsupportedConstructError(
      `Subflow '${body.flowName}' is not a name an Apex class can have, and a class ` +
        `reference cannot be renamed the way a local variable can.`
    );
  }

  ctx.notes.push({
    kind: 'dependency',
    detail: `subflow ${body.flowName} must be converted separately`,
  });
  const target = body.flowName;
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

  const statements: ApexStmt[] = [];
  if (body.storeOutputAutomatically) {
    // Flow lets any later element reference this action call by its own
    // element name, exactly as if it were a declared variable — a common
    // shape for an ID-returning invocable feeding a subsequent Get Records
    // filter. apexName() only allocates a renamed identifier; nothing declares
    // it. Without this, that later reference is 'Variable does not exist' at
    // compile time. The response wrapper's real shape is invisible to this
    // milestone (see the stub above), so the declared type is a guess like any
    // other unresolved reference — flagged, not invented as a collection or a
    // concrete class no describe confirmed.
    const resolved = ctx.types.resolve(node.name);
    if (resolved.provenance === 'heuristic') {
      ctx.notes.push({ kind: 'guess', detail: resolved.note });
    }
    statements.push(declare(resolved.type, apexName(ctx, node.name), null));
  }
  statements.push(invoke(staticCall(name, [], BOOLEAN)));
  return statements;
}
