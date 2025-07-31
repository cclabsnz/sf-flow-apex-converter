import { FlowElements } from '../../../types/elements';
import { FlowElementsImpl } from '../../analyzers/FlowElementsImpl';

export class ElementCounterImpl {
  static createElements(): FlowElements {
    return new FlowElementsImpl();
  }
}