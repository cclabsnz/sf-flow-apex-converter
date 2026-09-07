import * as path from 'path';
import { parseBody } from '../../../src/ir/bodies/index.js';
import { parseFlowFile } from '../../../src/ir/parseFlow.js';

const EXAMPLE_FLOW = path.join(__dirname, '..', '..', '..', 'exampleflow.xml');

describe('parseBody', () => {
  it('dispatches each element kind to its parser', () => {
    expect(parseBody('recordlookups', { object: 'Account' })?.kind).toBe('record');
    expect(parseBody('decisions', {})?.kind).toBe('decision');
    expect(parseBody('assignments', {})?.kind).toBe('assignment');
    expect(parseBody('loops', { collectionreference: 'C' })?.kind).toBe('loop');
    expect(parseBody('subflows', { flowname: 'F' })?.kind).toBe('subflow');
    expect(parseBody('actioncalls', { actionname: 'A' })?.kind).toBe('action');
    expect(parseBody('collectionprocessors', { collectionreference: 'C' })?.kind).toBe('collectionProcessor');
  });

  it('returns undefined for a kind with no body parser', () => {
    expect(parseBody('screens', {})).toBeUndefined();
  });
});

describe('bodies attached to the example Flow', () => {
  it('types every node whose kind has a parser', async () => {
    const ir = await parseFlowFile(EXAMPLE_FLOW);
    // 20 modelled elements, every one of them now has a typed body parser.
    const typed = ir.nodes.filter((n) => n.body !== undefined);
    expect(typed).toHaveLength(20);
  });

  it('reads the real lookup object through the typed body', async () => {
    const ir = await parseFlowFile(EXAMPLE_FLOW);
    const lookup = ir.nodes.find((n) => n.kind === 'recordlookups')!;
    expect(lookup.body).toBeDefined();
    expect(lookup.body!.kind).toBe('record');
    if (lookup.body!.kind === 'record') {
      expect(lookup.body!.object).toBe('LLC_BI__Pricing_Stream__c');
    }
  });

  it('reads all 13 assignment items across the Flow', async () => {
    const ir = await parseFlowFile(EXAMPLE_FLOW);
    const total = ir.nodes
      .filter((n) => n.body?.kind === 'assignment')
      .reduce((sum, n) => sum + (n.body!.kind === 'assignment' ? n.body!.items.length : 0), 0);
    expect(total).toBe(13);
  });

  it('reads all 21 subflow input bindings across the Flow', async () => {
    const ir = await parseFlowFile(EXAMPLE_FLOW);
    const total = ir.nodes
      .filter((n) => n.body?.kind === 'subflow')
      .reduce((sum, n) => sum + (n.body!.kind === 'subflow' ? n.body!.inputs.length : 0), 0);
    expect(total).toBe(21);
  });
});
