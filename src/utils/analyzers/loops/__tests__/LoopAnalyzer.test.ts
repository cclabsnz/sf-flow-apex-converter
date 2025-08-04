import { LoopAnalyzer } from '../LoopAnalyzer';
import { FlowMetadata } from '../../../../types';

describe('LoopAnalyzer', () => {
  let analyzer: LoopAnalyzer;

  beforeEach(() => {
    analyzer = new LoopAnalyzer();
  });

  const defaultFlowVersion = {
    version: '1.0',
    status: 'Active',
    lastModified: '2025-08-04T00:00:00.000Z'
  };

  it('should correctly analyze loop metrics with DML operations', () => {
    const metadata: FlowMetadata = {
      _flowVersion: defaultFlowVersion,
      loops: [{
        name: ['TestLoop'],
        collectionReference: ['AccountList'],
        iterationVariable: ['CurrentAccount'],
        iterationOrder: ['Asc'],
        connector: [{
          targetReference: ['CreateRecord']
        }],
        recordCreates: [{
          name: ['CreateRecord'],
          object: ['Account']
        }]
      }]
    };

    const { loopMetrics, bulkificationIssues } = analyzer.analyze(metadata);

    expect(loopMetrics).toHaveLength(1);
    expect(loopMetrics[0].containsDML).toBe(true);
    expect(loopMetrics[0].nestedElements.dml).toBe(1);
    expect(loopMetrics[0].loopVariables).toEqual({
      inputCollection: 'AccountList',
      currentItem: 'CurrentAccount',
      iterationOrder: 'Asc'
    });
    expect(bulkificationIssues).toHaveLength(1);
    expect(bulkificationIssues[0]).toContain('DML operations found in loop');
  });

  it('should detect SOQL queries in loops', () => {
    const metadata: FlowMetadata = {
      _flowVersion: defaultFlowVersion,
      loops: [{
        name: ['TestLoop'],
        collectionReference: ['ContactList'],
        recordLookups: [{
          name: ['GetAccount'],
          object: ['Account']
        }]
      }]
    };

    const { loopMetrics, bulkificationIssues } = analyzer.analyze(metadata);

    expect(loopMetrics[0].containsSOQL).toBe(true);
    expect(loopMetrics[0].nestedElements.soql).toBe(1);
    expect(bulkificationIssues[0]).toContain('SOQL queries found in loop');
  });

  it('should detect subflows in loops', () => {
    const metadata: FlowMetadata = {
      _flowVersion: defaultFlowVersion,
      loops: [{
        name: ['MainLoop'],
        collectionReference: ['ItemList'],
        connector: [{
          targetReference: ['ProcessItem']
        }],
        subflows: [{
          name: ['ProcessItem'],
          flowName: ['Item_Processing_Flow']
        }]
      }]
    };

    const { loopMetrics, bulkificationIssues } = analyzer.analyze(metadata);

    expect(loopMetrics[0].containsSubflows).toBe(true);
    expect(loopMetrics[0].nestedElements.subflows).toBe(1);
    expect(bulkificationIssues[0]).toContain('Subflow calls found in loop');
  });

  it('should count multiple operations in the same loop', () => {
    const metadata: FlowMetadata = {
      _flowVersion: defaultFlowVersion,
      loops: [{
        name: ['ComplexLoop'],
        collectionReference: ['Items'],
        recordCreates: [
          { name: ['Create1'] },
          { name: ['Create2'] }
        ],
        recordLookups: [
          { name: ['Lookup1'] }
        ],
        assignments: [
          { name: ['Assignment1'] },
          { name: ['Assignment2'] }
        ]
      }]
    };

    const { loopMetrics } = analyzer.analyze(metadata);

    expect(loopMetrics[0].nestedElements).toEqual({
      dml: 2,
      soql: 1,
      subflows: 0,
      other: 2
    });
  });

  it('should handle flow without loops', () => {
    const metadata: FlowMetadata = {
      _flowVersion: defaultFlowVersion,
      recordCreates: [{
        name: ['CreateAccount']
      }]
    };

    const { loopMetrics, loopContexts, bulkificationIssues } = analyzer.analyze(metadata);

    expect(loopMetrics).toHaveLength(0);
    expect(loopContexts.size).toBe(0);
    expect(bulkificationIssues).toHaveLength(0);
  });

  it('should properly count array vs single elements', () => {
    const metadata: FlowMetadata = {
      _flowVersion: defaultFlowVersion,
      loops: [{
        name: ['TestLoop'],
        recordCreates: [{ // Single element in array form
          name: ['SingleCreate']
        }],
        recordLookups: [ // Array of elements
          { name: ['Lookup1'] },
          { name: ['Lookup2'] }
        ]
      }]
    };

    const { loopMetrics } = analyzer.analyze(metadata);

    expect(loopMetrics[0].nestedElements.dml).toBe(1);
    expect(loopMetrics[0].nestedElements.soql).toBe(2);
  });
});
