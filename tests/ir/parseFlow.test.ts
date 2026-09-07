import * as path from 'path';
import { parseFlowFile } from '../../src/ir/parseFlow.js';
import { FlowIR } from '../../src/ir/types.js';

const EXAMPLE_FLOW = path.join(__dirname, '..', '..', 'exampleflow.xml');

describe('parseFlowXml against the bundled example Flow', () => {
  let ir: FlowIR;
  beforeAll(async () => {
    ir = await parseFlowFile(EXAMPLE_FLOW);
  });

  it('names the Flow from its file name', () => {
    expect(ir.flowName).toBe('exampleflow');
  });

  it('reads the process type', () => {
    expect(ir.processType).toBe('AutoLaunchedFlow');
  });

  it('captures the declarations the old parser ignored', () => {
    // The example Flow carries 12 variables and 3 formulas.
    expect(ir.declarations.filter((d) => d.kind === 'variable').length).toBe(12);
    expect(ir.declarations.filter((d) => d.kind === 'formula').length).toBe(3);
    expect(ir.declarations.filter((d) => d.kind === 'constant').length).toBe(1);
    expect(ir.declarations).toHaveLength(16);
  });

  it('captures the executable elements', () => {
    expect(ir.nodes.filter((n) => n.kind === 'assignments').length).toBe(7);
    expect(ir.nodes.filter((n) => n.kind === 'decisions').length).toBe(5);
    expect(ir.nodes.filter((n) => n.kind === 'subflows').length).toBe(4);
    expect(ir.nodes.filter((n) => n.kind === 'loops').length).toBe(1);
    expect(ir.nodes.filter((n) => n.kind === 'recordlookups').length).toBe(1);
  });

  it('reads the object the lookup declares', () => {
    const lookup = ir.nodes.find((n) => n.kind === 'recordlookups')!;
    expect(lookup.object).toBe('LLC_BI__Pricing_Stream__c');
  });

  it('has a start element', () => {
    expect(ir.start).toBeDefined();
    expect(ir.start!.triggerKind).toBe('autolaunched');
  });

  it('reports nothing unsupported for this Flow', () => {
    expect(ir.unsupported).toEqual([]);
  });

  it('retains source XML on every node, so any construct can be quoted back', () => {
    for (const node of ir.nodes) {
      expect(node.sourceJson.length).toBeGreaterThan(0);
    }
  });
});
