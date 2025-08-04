import { FlowElementType } from '../FlowTypes.js';

export interface LoopMetrics {
  totalLoops: number;
  itemsProcessed: string[];
  containsDML: boolean;
  containsSOQL: boolean;
  containsSubflows: boolean;
  nestedElements: {
    dml: number;
    soql: number;
    subflows: number;
    other: number;
  };
  loopVariables: {
    inputCollection: string;
    currentItem: string;
    iterationOrder: 'Asc' | 'Desc';
  };
}

export interface LoopContext {
  isInLoop: boolean;
  loopReferenceName?: string;
  parentLoopNames?: string[];
  depth: number;
  path?: string[];
  pathTypes?: FlowElementType[];
}