import { parseStart } from '../../src/ir/parseStart.js';

describe('parseStart', () => {
  it('reports an autolaunched Flow when no trigger is declared', () => {
    const start = parseStart({
      start: { connector: { targetreference: 'Init_Collection' } },
    })!;
    expect(start.triggerKind).toBe('autolaunched');
    expect(start.connector).toEqual({ target: 'Init_Collection', isFault: false });
  });

  it('reads the trigger type and object of a record-triggered Flow', () => {
    const start = parseStart({
      start: {
        object: 'LLC_BI__Loan__c',
        triggertype: 'RecordAfterSave',
        filterlogic: 'and',
        connector: { targetreference: 'Assign_Defaults' },
      },
    })!;
    expect(start.triggerKind).toBe('RecordAfterSave');
    expect(start.object).toBe('LLC_BI__Loan__c');
  });

  it('captures entry criteria when present', () => {
    const start = parseStart({
      start: { object: 'Account', triggertype: 'RecordBeforeSave', filterlogic: '1 AND 2' },
    })!;
    expect(start.entryCriteria).toBe('1 AND 2');
  });

  it('returns undefined when the Flow has no start element', () => {
    expect(parseStart({})).toBeUndefined();
  });

  it('does not fabricate a connector target when targetReference is missing', () => {
    // A malformed connector with no target must not produce a fake graph edge —
    // no connector at all is safer than a lie about where control goes.
    const start = parseStart({
      start: { connector: { locationX: '56' } },
    })!;
    expect(start.connector).toBeUndefined();
  });

  it('captures filters on the start element', () => {
    const start = parseStart({
      start: {
        object: 'LLC_BI__Loan__c',
        triggertype: 'RecordAfterSave',
        filterlogic: 'and',
        filters: { field: 'LLC_BI__Loan__c', operator: 'In', value: { elementreference: 'Get_Loan_IDs' } },
      },
    })!;
    expect(start.filters).toEqual([
      { field: 'LLC_BI__Loan__c', operator: 'In', value: { elementreference: 'Get_Loan_IDs' } },
    ]);
  });

  it('leaves filters undefined when the start element has none', () => {
    const start = parseStart({ start: { triggertype: 'RecordAfterSave' } })!;
    expect(start.filters).toBeUndefined();
  });
});
