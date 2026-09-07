import * as path from 'path';
import { parseFlowFile, parseFlowXml } from '../../src/ir/parseFlow.js';
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
    // '{}' has length > 0 too — assert the JSON actually names the element, not
    // merely that some non-empty string was produced.
    for (const node of ir.nodes) {
      expect(node.sourceJson).toContain(node.name);
    }
  });
});

describe('parseFlowXml on malformed input', () => {
  it('throws a clear error, naming the file, instead of a raw TypeError on null', async () => {
    await expect(parseFlowXml('', 'blank-flow')).rejects.toThrow(/blank-flow/);
  });

  it('throws a clear error on whitespace-only XML', async () => {
    await expect(parseFlowXml('   \n  ', 'whitespace-flow')).rejects.toThrow(/whitespace-flow/);
  });
});

describe('parseFlowXml runInMode and scheduledPaths', () => {
  it('reads runInMode from the flow, which decides with/without sharing in generated Apex', async () => {
    const ir = await parseFlowXml(
      `<?xml version="1.0" encoding="UTF-8"?>
      <Flow xmlns="http://soap.sforce.com/2006/04/metadata">
        <processType>AutoLaunchedFlow</processType>
        <runInMode>SystemModeWithoutSharing</runInMode>
      </Flow>`,
      'run-in-mode-flow',
    );
    expect(ir.runInMode).toBe('SystemModeWithoutSharing');
  });

  it('records scheduledPaths as unsupported instead of silently dropping them', async () => {
    const ir = await parseFlowXml(
      `<?xml version="1.0" encoding="UTF-8"?>
      <Flow xmlns="http://soap.sforce.com/2006/04/metadata">
        <processType>Flow</processType>
        <start>
          <object>Account</object>
          <scheduledPaths>
            <name>ThreeDaysBefore</name>
            <offsetNumber>-3</offsetNumber>
          </scheduledPaths>
        </start>
      </Flow>`,
      'scheduled-paths-flow',
    );
    expect(ir.unsupported).toHaveLength(1);
    expect(ir.unsupported[0].kind).toBe('scheduledpaths');
  });
});
