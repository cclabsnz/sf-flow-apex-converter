import { emitStmt } from '../../../src/apex/emit.js';
import { Scope } from '../../../src/apex/scope.js';
import { FlowDeclaration, FlowIR, FlowNode } from '../../../src/ir/types.js';
import { LowerContext } from '../../../src/lower/context.js';
import { declarationTypeSource } from '../../../src/lower/typeSource.js';
import { UnsupportedConstructError } from '../../../src/lower/value.js';
import { lowerAssignment } from '../../../src/lower/elements/assignment.js';

function decl(name: string, dataType: string, isCollection = false, objectType?: string): FlowDeclaration {
  return {
    name, kind: 'variable', dataType, objectType, isCollection,
    isInput: false, isOutput: false, sourceJson: '{}',
  };
}

function ctx(declarations: FlowDeclaration[]): LowerContext {
  const ir: FlowIR = {
    flowName: 'T', processType: 'AutoLaunchedFlow', declarations, nodes: [], unsupported: [],
  };
  return {
    ir, types: declarationTypeSource(ir), scope: new Scope(),
    names: new Map(), notes: [], stubs: new Map(), formulas: new Map(),
  };
}

function assignmentNode(items: { target: string; operator: string; value: { kind: string; raw?: string } }[]): FlowNode {
  return {
    name: 'Set_Message', kind: 'assignments', connectors: [], sourceJson: '{}', raw: {},
    body: { kind: 'assignment', items: items as never },
  };
}

describe('lowerAssignment', () => {
  it('assigns a plain variable', () => {
    const c = ctx([decl('Msg', 'String'), decl('Src', 'String')]);
    const node = assignmentNode([{ target: 'Msg', operator: 'Assign', value: { kind: 'reference', raw: 'Src' } }]);
    expect(lowerAssignment(node, c).map((s) => emitStmt(s))).toEqual(['Msg = Src;']);
  });

  it('writes a member on an Apex-defined type', () => {
    const c = ctx([decl('ValidationMessage', 'Apex'), decl('Err', 'String')]);
    const node = assignmentNode([
      { target: 'ValidationMessage.Message', operator: 'Assign', value: { kind: 'reference', raw: 'Err' } },
    ]);
    expect(lowerAssignment(node, c).map((s) => emitStmt(s)))
      .toEqual(['ValidationMessage.Message = Err;']);
  });

  it('adds an item to a collection', () => {
    const c = ctx([decl('Msgs', 'Apex', true), decl('Msg', 'Apex')]);
    const node = assignmentNode([{ target: 'Msgs', operator: 'Add', value: { kind: 'reference', raw: 'Msg' } }]);
    expect(lowerAssignment(node, c).map((s) => emitStmt(s))).toEqual(['Msgs.add(Msg);']);
  });

  it('clears a collection for RemoveAll', () => {
    const c = ctx([decl('Msgs', 'Apex', true)]);
    const node = assignmentNode([{ target: 'Msgs', operator: 'RemoveAll', value: { kind: 'none' } }]);
    expect(lowerAssignment(node, c).map((s) => emitStmt(s))).toEqual(['Msgs.clear();']);
  });

  it('removes the first element for RemoveFirst', () => {
    const c = ctx([decl('Msgs', 'Apex', true)]);
    const node = assignmentNode([{ target: 'Msgs', operator: 'RemoveFirst', value: { kind: 'none' } }]);
    expect(lowerAssignment(node, c).map((s) => emitStmt(s))).toEqual(['Msgs.remove(0);']);
  });

  it('refuses Add on a non-collection, because the AST has no arithmetic', () => {
    // Flow's Add concatenates strings and sums numbers. Emitting a wrong
    // interpretation is worse than refusing.
    const c = ctx([decl('Total', 'Number')]);
    const node = assignmentNode([{ target: 'Total', operator: 'Add', value: { kind: 'number', raw: '1' } }]);
    expect(() => lowerAssignment(node, c)).toThrow(UnsupportedConstructError);
  });

  it('refuses an operator with no mapping, by name', () => {
    const c = ctx([decl('Msgs', 'Apex', true)]);
    const node = assignmentNode([{ target: 'Msgs', operator: 'RemoveAfterFirst', value: { kind: 'none' } }]);
    expect(() => lowerAssignment(node, c)).toThrow(/RemoveAfterFirst/);
  });

  it('refuses RemoveAll on a non-collection, rather than emitting a call Apex cannot compile', () => {
    // Without this guard, .clear() would be emitted on a scalar target — a
    // compile error in the generated Apex with no refusal from the converter.
    const c = ctx([decl('Total', 'Number')]);
    const node = assignmentNode([{ target: 'Total', operator: 'RemoveAll', value: { kind: 'none' } }]);
    expect(() => lowerAssignment(node, c)).toThrow(UnsupportedConstructError);
  });

  it('reports an undeclared Add target as undeclared, not as needing arithmetic', () => {
    // declarationTypeSource falls back to a String guess for a name the Flow
    // never declares, so isCollection would say "false" for the same reason
    // it would for a real scalar. The two causes need different messages.
    const c = ctx([decl('Msg', 'Apex')]);
    const node = assignmentNode([{ target: 'Ghost', operator: 'Add', value: { kind: 'reference', raw: 'Msg' } }]);
    expect(() => lowerAssignment(node, c)).toThrow(/does not declare/);
    expect(() => lowerAssignment(node, c)).not.toThrow(/arithmetic/);
  });

  it('emits one statement per item, in order', () => {
    const c = ctx([decl('A', 'String'), decl('B', 'String'), decl('S', 'String')]);
    const node = assignmentNode([
      { target: 'A', operator: 'Assign', value: { kind: 'reference', raw: 'S' } },
      { target: 'B', operator: 'Assign', value: { kind: 'reference', raw: 'S' } },
    ]);
    expect(lowerAssignment(node, c).map((s) => emitStmt(s))).toEqual(['A = S;', 'B = S;']);
  });
});
