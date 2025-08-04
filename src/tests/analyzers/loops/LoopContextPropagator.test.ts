import { LoopContextPropagator } from '../../../utils/analyzers/loops/LoopContextPropagator';
import { FlowElementType } from '../../../utils/interfaces/FlowTypes';
import { FlowMetadata } from '../../../types/elements';

describe('LoopContextPropagator', () => {
  let propagator: LoopContextPropagator;

  beforeEach(() => {
    propagator = new LoopContextPropagator();
  });

  test('detects indirect subflow through decision', () => {
    const metadata = {
      _flowVersion: {
        version: '1.0',
        status: 'Active',
        lastModified: new Date().toISOString()
      },
      loops: [{
        name: ['MyLoop'],
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
        inputAssignments: [{
          name: ['input1'],
          value: {
            elementReference: ['MyLoop.currentItem']
          }
        }]
      }]
    } as FlowMetadata;

    const contexts = propagator.propagateLoopContexts(metadata);
    
    // Decision1 should be marked as in MyLoop
    const decision1Context = contexts.get('Decision1');
    expect(decision1Context).toBeDefined();
    expect(decision1Context?.isInLoop).toBe(true);
    expect(decision1Context?.loopReferenceName).toBe('MyLoop');
    expect(decision1Context?.path).toEqual(['Decision1']);
    expect(decision1Context?.pathTypes).toEqual([FlowElementType.DECISION]);

    // SubflowA should be marked as in MyLoop through Decision1
    const subflowContext = contexts.get('SubflowA');
    expect(subflowContext).toBeDefined();
    expect(subflowContext?.isInLoop).toBe(true);
    expect(subflowContext?.loopReferenceName).toBe('MyLoop');
    expect(subflowContext?.path).toEqual(['Decision1', 'SubflowA']);
    expect(subflowContext?.pathTypes).toEqual([FlowElementType.DECISION, FlowElementType.SUBFLOW]);
  });

  test('detects indirect subflow through assignment', () => {
    const metadata = {
      _flowVersion: {
        version: '1.0',
        status: 'Active',
        lastModified: new Date().toISOString()
      },
      loops: [{
        name: ['MyLoop'],
        connector: [{
          targetReference: ['Assignment1']
        }]
      }],
      assignments: [{
        name: ['Assignment1'],
        connector: [{
          targetReference: ['SubflowA']
        }]
      }],
      subflows: [{
        name: ['SubflowA'],
        inputAssignments: [{
          name: ['input1'],
          value: {
            elementReference: ['MyLoop.currentItem']
          }
        }]
      }]
    } as FlowMetadata;

    const contexts = propagator.propagateLoopContexts(metadata);
    
    // Assignment1 should be marked as in MyLoop
    const assignment1Context = contexts.get('Assignment1');
    expect(assignment1Context).toBeDefined();
    expect(assignment1Context?.isInLoop).toBe(true);
    expect(assignment1Context?.loopReferenceName).toBe('MyLoop');
    expect(assignment1Context?.path).toEqual(['Assignment1']);
    expect(assignment1Context?.pathTypes).toEqual([FlowElementType.ASSIGNMENT]);

    // SubflowA should be marked as in MyLoop through Assignment1
    const subflowContext = contexts.get('SubflowA');
    expect(subflowContext).toBeDefined();
    expect(subflowContext?.isInLoop).toBe(true);
    expect(subflowContext?.loopReferenceName).toBe('MyLoop');
    expect(subflowContext?.path).toEqual(['Assignment1', 'SubflowA']);
    expect(subflowContext?.pathTypes).toEqual([FlowElementType.ASSIGNMENT, FlowElementType.SUBFLOW]);
  });

  test('detects indirect subflow through multiple decisions', () => {
    const metadata = {
      _flowVersion: {
        version: '1.0',
        status: 'Active',
        lastModified: new Date().toISOString()
      },
      loops: [{
        name: ['MyLoop'],
        connector: [{
          targetReference: ['Decision1']
        }]
      }],
      decisions: [{
        name: ['Decision1'],
        connector: [{
          targetReference: ['Decision2']
        }]
      }, {
        name: ['Decision2'],
        connector: [{
          targetReference: ['SubflowA']
        }]
      }],
      subflows: [{
        name: ['SubflowA'],
        inputAssignments: [{
          name: ['input1'],
          value: {
            elementReference: ['MyLoop.currentItem']
          }
        }]
      }]
    } as FlowMetadata;

    const contexts = propagator.propagateLoopContexts(metadata);
    
    // Decision1 should be marked as in MyLoop
    const decision1Context = contexts.get('Decision1');
    expect(decision1Context).toBeDefined();
    expect(decision1Context?.isInLoop).toBe(true);
    expect(decision1Context?.loopReferenceName).toBe('MyLoop');
    expect(decision1Context?.path).toEqual(['Decision1']);
    expect(decision1Context?.pathTypes).toEqual([FlowElementType.DECISION]);

    // Decision2 should be marked as in MyLoop through Decision1
    const decision2Context = contexts.get('Decision2');
    expect(decision2Context).toBeDefined();
    expect(decision2Context?.isInLoop).toBe(true);
    expect(decision2Context?.loopReferenceName).toBe('MyLoop');
    expect(decision2Context?.path).toEqual(['Decision1', 'Decision2']);
    expect(decision2Context?.pathTypes).toEqual([FlowElementType.DECISION, FlowElementType.DECISION]);

    // SubflowA should be marked as in MyLoop through both decisions
    const subflowContext = contexts.get('SubflowA');
    expect(subflowContext).toBeDefined();
    expect(subflowContext?.isInLoop).toBe(true);
    expect(subflowContext?.loopReferenceName).toBe('MyLoop');
    expect(subflowContext?.path).toEqual(['Decision1', 'Decision2', 'SubflowA']);
    expect(subflowContext?.pathTypes).toEqual([FlowElementType.DECISION, FlowElementType.DECISION, FlowElementType.SUBFLOW]);
  });

  test('detects nested loops', () => {
    const metadata = {
      _flowVersion: {
        version: '1.0',
        status: 'Active',
        lastModified: new Date().toISOString()
      },
      loops: [{
        name: ['OuterLoop'],
        connector: [{
          targetReference: ['InnerLoop']
        }]
      }, {
        name: ['InnerLoop'],
        connector: [{
          targetReference: ['SubflowA']
        }]
      }],
      subflows: [{
        name: ['SubflowA'],
        inputAssignments: [{
          name: ['input1'],
          value: {
            elementReference: ['OuterLoop.currentItem']
          }
        }, {
          name: ['input2'],
          value: {
            elementReference: ['InnerLoop.currentItem']
          }
        }]
      }]
    } as FlowMetadata;

    const contexts = propagator.propagateLoopContexts(metadata);
    
    // InnerLoop should be marked as in OuterLoop
    const innerLoopContext = contexts.get('InnerLoop');
    expect(innerLoopContext).toBeDefined();
    expect(innerLoopContext?.isInLoop).toBe(true);
    expect(innerLoopContext?.loopReferenceName).toBe('OuterLoop');
    expect(innerLoopContext?.path).toEqual(['InnerLoop']);
    expect(innerLoopContext?.pathTypes).toEqual([FlowElementType.LOOP]);

    // SubflowA should be marked as in both loops
    const subflowContext = contexts.get('SubflowA');
    expect(subflowContext).toBeDefined();
    expect(subflowContext?.isInLoop).toBe(true);
    expect(subflowContext?.path).toEqual(['InnerLoop', 'SubflowA']);
    expect(subflowContext?.pathTypes).toEqual([FlowElementType.LOOP, FlowElementType.SUBFLOW]);
  });

  test('detects loops referencing subflow inputs', () => {
    const metadata = {
      _flowVersion: {
        version: '1.0',
        status: 'Active',
        lastModified: new Date().toISOString()
      },
      loops: [{
        name: ['MyLoop'],
        connector: [{
          targetReference: ['SubflowA']
        }]
      }],
      subflows: [{
        name: ['SubflowA'],
        inputAssignments: [{
          name: ['input1'],
          value: {
            elementReference: ['MyLoop.currentItem']
          }
        }]
      }]
    } as FlowMetadata;

    const contexts = propagator.propagateLoopContexts(metadata);
    
    // SubflowA should be marked as in MyLoop due to input reference
    const subflowContext = contexts.get('SubflowA');
    expect(subflowContext).toBeDefined();
    expect(subflowContext?.isInLoop).toBe(true);
    expect(subflowContext?.loopReferenceName).toBe('MyLoop');
    expect(subflowContext?.path).toEqual(['SubflowA']);
    expect(subflowContext?.pathTypes).toEqual([FlowElementType.SUBFLOW]);
  });
});