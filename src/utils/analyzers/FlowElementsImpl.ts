import { FlowElements } from '../../types/elements';

export class FlowElementsImpl implements FlowElements {
  recordLookups?: number;
  recordCreates?: number;
  recordUpdates?: number;
  recordDeletes?: number;
  decisions?: number;
  loops?: number;
  assignments?: number;
  subflows?: number;
  actionCalls?: number;
  total: number = 0;
  size: number = 0;
  private _map: Map<string, number> = new Map();

  constructor() {
    this.get = this.get.bind(this);
  }

  get(key: string): { size: number } | undefined {
    const value = this._map.get(key);
    return value !== undefined ? { size: value } : undefined;
  }

  set(key: string, value: number): void {
    this._map.set(key, value);
    if (key === 'total') {
      this.total = value;
      this.size = value;
    } else {
      switch (key) {
        case 'recordLookups':
          this.recordLookups = value;
          break;
        case 'recordCreates':
          this.recordCreates = value;
          break;
        case 'recordUpdates':
          this.recordUpdates = value;
          break;
        case 'recordDeletes':
          this.recordDeletes = value;
          break;
        case 'decisions':
          this.decisions = value;
          break;
        case 'loops':
          this.loops = value;
          break;
        case 'assignments':
          this.assignments = value;
          break;
        case 'subflows':
          this.subflows = value;
          break;
        case 'actionCalls':
          this.actionCalls = value;
          break;
      }
    }
  }
}