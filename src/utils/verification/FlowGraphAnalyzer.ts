import { FlowMetadata, FlowElement, FlowElementType } from '../interfaces/types';
import { FlowGraph, FlowNode, FlowEdge, FlowState } from './types';

export class FlowGraphAnalyzer {
  private visitedPaths: Set<string> = new Set();
  private states: Map<string, FlowState> = new Map();

  constructor(private graph: FlowGraph) {}

  public findAllPaths(): string[][] {
    const startNodes = Array.from(this.graph.nodes.values())
      .filter(node => node.type === 'START' || node.type === 'TRIGGER');

    const allPaths: string[][] = [];
    
    startNodes.forEach(startNode => {
      const paths = this.depthFirstSearch(startNode.id, []);
      allPaths.push(...paths);
    });

    return allPaths;
  }

  public analyzeStateTransitions(): Map<string, FlowState> {
    const paths = this.findAllPaths();
    
    paths.forEach(path => {
      let previousState = 'START';
      
      path.forEach(nodeId => {
        const node = this.graph.nodes.get(nodeId)!;
        const currentState = this.determineState(node);
        
        if (!this.states.has(previousState)) {
          this.states.set(previousState, {
            name: previousState,
            type: 'state',
            transitions: [],
            validations: []
          });
        }

        const state = this.states.get(previousState)!;
        const transition = {
          toState: currentState,
          condition: this.determineTransitionCondition(node),
          actions: this.determineActions(node)
        };

        // Add transition if not already present
        if (!state.transitions.some(t => 
          t.toState === transition.toState && 
          t.condition === transition.condition
        )) {
          state.transitions.push(transition);
        }

        previousState = currentState;
      });
    });

    return this.states;
  }

  public findCriticalPaths(): string[][] {
    return this.findAllPaths().filter(path => 
      path.some(nodeId => {
        const node = this.graph.nodes.get(nodeId)!;
        return this.isDMLOperation(node) || this.isSOQLQuery(node);
      })
    );
  }

  private depthFirstSearch(currentId: string, path: string[]): string[][] {
    const paths: string[][] = [];
    path.push(currentId);

    const edges = this.graph.edges.get(currentId) || [];
    
    if (edges.length === 0) {
      // End of path
      paths.push([...path]);
    } else {
      edges.forEach(edge => {
        if (!path.includes(edge.to)) { // Avoid cycles
          paths.push(...this.depthFirstSearch(edge.to, [...path]));
        }
      });
    }

    return paths;
  }

  private determineState(node: FlowNode): string {
    switch (node.type) {
      case 'DECISION':
        return 'DECISION_STATE';
      case 'ASSIGNMENT':
        return 'ASSIGNMENT_STATE';
      case 'RECORD_CREATE':
      case 'RECORD_UPDATE':
      case 'RECORD_DELETE':
        return 'DML_STATE';
      case 'LOOP':
        return 'LOOP_STATE';
      case 'SUBFLOW':
        return 'SUBFLOW_STATE';
      default:
        return 'PROCESSING_STATE';
    }
  }

  private determineTransitionCondition(node: FlowNode): string {
    if (node.type === 'DECISION') {
      return node.metadata.conditions?.[0]?.expression || 'true';
    }
    return 'true';
  }

  private determineActions(node: FlowNode): any[] {
    const actions = [];

    if (this.isDMLOperation(node)) {
      actions.push({
        type: 'DML',
        operation: node.type,
        object: node.metadata.object,
        fields: node.metadata.fields
      });
    }

    if (this.isAssignment(node)) {
      actions.push({
        type: 'ASSIGNMENT',
        target: node.outputRefs[0],
        value: node.metadata.value
      });
    }

    return actions;
  }

  private isDMLOperation(node: FlowNode): boolean {
    return ['RECORD_CREATE', 'RECORD_UPDATE', 'RECORD_DELETE'].includes(node.type);
  }

  private isSOQLQuery(node: FlowNode): boolean {
    return node.type === 'RECORD_LOOKUP';
  }

  private isAssignment(node: FlowNode): boolean {
    return node.type === 'ASSIGNMENT';
  }

  public validateGraph(): string[] {
    const issues: string[] = [];

    // Check for unreachable nodes
    const reachableNodes = new Set<string>();
    this.findAllPaths().forEach(path => 
      path.forEach(nodeId => reachableNodes.add(nodeId))
    );

    this.graph.nodes.forEach((node, id) => {
      if (!reachableNodes.has(id)) {
        issues.push(`Unreachable node: ${id} (${node.type})`);
      }
    });

    // Check for invalid references
    this.graph.nodes.forEach((node, id) => {
      node.inputRefs.forEach(ref => {
        if (!this.isValidReference(ref)) {
          issues.push(`Invalid input reference in node ${id}: ${ref}`);
        }
      });

      node.outputRefs.forEach(ref => {
        if (!this.isValidReference(ref)) {
          issues.push(`Invalid output reference in node ${id}: ${ref}`);
        }
      });
    });

    // Check for cycles in non-loop contexts
    const cycles = this.findUnintendedCycles();
    cycles.forEach(cycle => {
      issues.push(`Unintended cycle detected: ${cycle.join(' -> ')}`);
    });

    return issues;
  }

  private isValidReference(ref: string): boolean {
    // Check if reference points to a valid variable or field
    // This would need to be implemented based on your specific reference format
    return true; // Placeholder
  }

  private findUnintendedCycles(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (nodeId: string, path: string[]) => {
      visited.add(nodeId);
      recursionStack.add(nodeId);
      path.push(nodeId);

      const edges = this.graph.edges.get(nodeId) || [];
      edges.forEach(edge => {
        if (!visited.has(edge.to)) {
          dfs(edge.to, [...path]);
        } else if (recursionStack.has(edge.to)) {
          const node = this.graph.nodes.get(nodeId)!;
          if (node.type !== 'LOOP') {
            cycles.push([...path, edge.to]);
          }
        }
      });

      recursionStack.delete(nodeId);
    };

    this.graph.nodes.forEach((_, id) => {
      if (!visited.has(id)) {
        dfs(id, []);
      }
    });

    return cycles;
  }
}
