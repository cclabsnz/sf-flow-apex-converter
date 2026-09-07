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
});
