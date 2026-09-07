import { FlowIR } from './types.js';

export interface CoverageSummary {
  flowName: string;
  nodeCount: number;
  declarationCount: number;
  typedBodies: number;
  unsupported: { kind: string; name?: string; reason: string }[];
}

/** What the IR understood about a Flow, and what it did not. */
export function summariseCoverage(ir: FlowIR): CoverageSummary {
  return {
    flowName: ir.flowName,
    nodeCount: ir.nodes.length,
    declarationCount: ir.declarations.length,
    typedBodies: ir.nodes.filter((n) => n.body !== undefined).length,
    unsupported: ir.unsupported.map(({ kind, name, reason }) => ({ kind, name, reason })),
  };
}
