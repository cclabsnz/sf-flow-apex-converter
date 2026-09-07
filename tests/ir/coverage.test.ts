import { summariseCoverage } from '../../src/ir/coverage.js';
import { FlowIR } from '../../src/ir/types.js';

const ir: FlowIR = {
  flowName: 'MyFlow',
  processType: 'AutoLaunchedFlow',
  declarations: [
    { name: 'V', kind: 'variable', dataType: 'String', isCollection: false, isInput: false, isOutput: false, sourceJson: '{}' },
  ],
  nodes: [
    { name: 'Lookup', kind: 'recordlookups', connectors: [], sourceJson: '{}', raw: {} },
  ],
  unsupported: [
    { kind: 'screens', name: 'Confirm', reason: 'Flow element type "screens" is not modelled by the IR yet', sourceJson: '{}' },
  ],
};

describe('summariseCoverage', () => {
  it('counts what the IR captured', () => {
    const s = summariseCoverage(ir);
    expect(s.nodeCount).toBe(1);
    expect(s.declarationCount).toBe(1);
  });

  it('lists every unsupported construct with its reason', () => {
    const s = summariseCoverage(ir);
    expect(s.unsupported).toEqual([
      { kind: 'screens', name: 'Confirm', reason: 'Flow element type "screens" is not modelled by the IR yet' },
    ]);
  });

  it('drops the source XML, which is for the emitter and not for a summary', () => {
    const s = summariseCoverage(ir) as unknown as Record<string, unknown>;
    expect(JSON.stringify(s)).not.toContain('sourceJson');
  });
});
