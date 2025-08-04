import { LoopContextPropagator } from '../LoopContextPropagator';
import { FlowMetadata } from '../../../../types';

describe('LoopContextPropagator', () => {
  let propagator: LoopContextPropagator;

  beforeEach(() => {
    propagator = new LoopContextPropagator();
  });

  const defaultFlowVersion = {
    version: '1.0',
    status: 'Active',
    lastModified: '2025-08-04T00:00:00.000Z'
  };

  it('should correctly propagate loop context through simple chain', () => {
    const metadata: FlowMetadata = {
      _flowVersion: defaultFlowVersion,
      loops: [{
        name: ['TestLoop'],
        connector: [{
          targetReference: ['ElementA']
        }]
      }],
      decisions: [{
        name: ['ElementA'],
        connector: [{
          targetReference: ['ElementB']
        }]
      }],
      recordCreates: [{
        name: ['ElementB']
      }]
    };

    const result = propagator.propagateLoopContexts(metadata);

    expect(result.get('ElementA')).toBeDefined();
    expect(result.get('ElementA')?.isInLoop).toBe(true);
    expect(result.get('ElementA')?.loopReferenceName).toBe('TestLoop');
    
    expect(result.get('ElementB')).toBeDefined();
    expect(result.get('ElementB')?.isInLoop).toBe(true);
    expect(result.get('ElementB')?.loopReferenceName).toBe('TestLoop');
  });

  it('should handle branching paths from loops', () => {
    const metadata: FlowMetadata = {
      _flowVersion: defaultFlowVersion,
      loops: [{
        name: ['TestLoop'],
        connector: [{
          targetReference: ['Decision1']
        }]
      }],
      decisions: [{
        name: ['Decision1'],
        connector: [
          { targetReference: ['Branch1'] },
          { targetReference: ['Branch2'] }
        ]
      }],
      recordCreates: [
        { name: ['Branch1'] },
        { name: ['Branch2'] }
      ]
    };

    const result = propagator.propagateLoopContexts(metadata);

    expect(result.get('Decision1')?.isInLoop).toBe(true);
    expect(result.get('Branch1')?.isInLoop).toBe(true);
    expect(result.get('Branch2')?.isInLoop).toBe(true);
  });

  it('should handle multiple loops with shared elements', () => {
    const metadata: FlowMetadata = {
      _flowVersion: defaultFlowVersion,
      loops: [
        {
          name: ['Loop1'],
          connector: [{
            targetReference: ['SharedElement']
          }]
        },
        {
          name: ['Loop2'],
          connector: [{
            targetReference: ['SharedElement']
          }]
        }
      ],
      recordLookups: [{
        name: ['SharedElement']
      }]
    };

    const result = propagator.propagateLoopContexts(metadata);

    expect(result.get('SharedElement')?.isInLoop).toBe(true);
    // Should preserve the first loop that claimed the element
    expect(result.get('SharedElement')?.loopReferenceName).toBe('Loop1');
  });

  it('should handle complex flow with subflows in loops', () => {
    const metadata: FlowMetadata = {
      _flowVersion: defaultFlowVersion,
      loops: [{
        name: ['MainLoop'],
        connector: [{
          targetReference: ['Decision1']
        }]
      }],
      decisions: [{
        name: ['Decision1'],
        connector: [{
          targetReference: ['SubflowA']
        }]
      }],
      subflows: [{
        name: ['SubflowA'],
        flowName: ['TestSubflow'],
        connector: [{
          targetReference: ['FinalOperation']
        }]
      }],
      recordUpdates: [{
        name: ['FinalOperation']
      }]
    };

    const result = propagator.propagateLoopContexts(metadata);

    expect(result.get('Decision1')?.isInLoop).toBe(true);
    expect(result.get('SubflowA')?.isInLoop).toBe(true);
    expect(result.get('FinalOperation')?.isInLoop).toBe(true);
  });

  it('should handle no loops in metadata', () => {
    const metadata: FlowMetadata = {
      _flowVersion: defaultFlowVersion,
      recordCreates: [{
        name: ['Operation1']
      }]
    };

    const result = propagator.propagateLoopContexts(metadata);
    expect(result.size).toBe(0);
  });

  it('should detect subflows and actions referencing loop variables', () => {
    const metadata: FlowMetadata = {
      _flowVersion: defaultFlowVersion,
      loops: [{
        name: ['Loop_over_Loans'],
        collectionReference: ['LoansInPP'],
        iterationOrder: ['Asc'],
        nextValueConnector: [{
          targetReference: ['Is_the_loan_a_Credit_Action']
        }]
      }],
      subflows: [
        {
          name: ['Validate_Better_Homes_Topup'],
          flowName: ['NC_Better_Homes_Topup_Validation'],
          inputAssignments: [{
            name: ['LoanId'],
            value: {
              elementReference: ['Loop_over_Loans.Id']
            }
          }]
        },
        {
          name: ['Validate_Key_Loan_Dates'],
          flowName: ['Key_Loan_Date_Validation'],
          inputAssignments: [{
            name: ['LoanId'],
            value: {
              elementReference: ['Loop_over_Loans.Id']
            }
          }]
        }
      ]
    };

    const result = propagator.propagateLoopContexts(metadata);

    // Should detect both subflows as being in the loop due to their input references
    expect(result.get('Validate_Better_Homes_Topup')?.isInLoop).toBe(true);
    expect(result.get('Validate_Better_Homes_Topup')?.loopReferenceName).toBe('Loop_over_Loans');
    
    expect(result.get('Validate_Key_Loan_Dates')?.isInLoop).toBe(true);
    expect(result.get('Validate_Key_Loan_Dates')?.loopReferenceName).toBe('Loop_over_Loans');
  });

  it('should handle empty or invalid connectors', () => {
    const metadata: FlowMetadata = {
      _flowVersion: defaultFlowVersion,
      loops: [{
        name: ['TestLoop'],
        connector: [{}] // Empty connector
      }],
      decisions: [{
        name: ['Decision1']
        // No connector
      }]
    };

    const result = propagator.propagateLoopContexts(metadata);
    expect(result.size).toBe(0);
  });
});