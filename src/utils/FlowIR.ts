import { FlowAnalysisResult } from './SimplifiedFlowAnalyzer.js';

export interface FlowIRElement {
  name: string;
  type: string;
  nextElements: string[];
  isInLoop: boolean;
  loopContext?: string;
  operations: {
    soql: boolean;
    dml: boolean;
    apex: boolean;
    subflow: boolean;
  };
  rawData: Record<string, unknown>;
}

export interface FlowIRLoop {
  name: string;
  collection: string;
  nextElement: string;
  elements: string[];
  problematicElements: {
    element: string;
    type: string;
    issue: string;
  }[];
}

export interface FlowIRSubflow {
  name: string;
  flowName: string;
  isInLoop: boolean;
  loopContext?: string;
}

export interface FlowIR {
  flowName: string;
  elements: FlowIRElement[];
  loops: FlowIRLoop[];
  subflows: FlowIRSubflow[];
  executionPath: string[];
}

export function buildFlowIR(result: FlowAnalysisResult): FlowIR {
  return {
    flowName: result.flowName,
    elements: Array.from(result.elements.values()).map(e => ({
      name: e.name,
      type: e.type,
      nextElements: e.nextElements,
      isInLoop: e.isInLoop,
      loopContext: e.loopContext,
      operations: e.operations,
      rawData: e.rawData ?? {}
    })),
    loops: Array.from(result.loops.values()).map(loop => ({
      name: loop.name,
      collection: loop.collection,
      nextElement: loop.nextElement,
      elements: Array.from(loop.elementsInLoop),
      problematicElements: loop.problematicElements.map(p => ({
        element: p.element,
        type: p.type,
        issue: p.issue
      }))
    })),
    subflows: result.subflows.map(s => ({
      name: s.name,
      flowName: s.flowName,
      isInLoop: s.isInLoop,
      loopContext: s.loopContext
    })),
    executionPath: result.executionPath
  };
}

