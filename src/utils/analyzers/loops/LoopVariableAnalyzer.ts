import { FlowMetadata } from '../../interfaces/SubflowTypes.js';
import { Logger } from '../../Logger.js';

export interface LoopVariables {
  inputCollection: string;
  currentItem: string;
  iterationOrder: 'Asc' | 'Desc';
}

export class LoopVariableAnalyzer {
  analyzeLoopVariables(loop: any): LoopVariables {
    const variables: LoopVariables = {
      inputCollection: loop.collectionReference?.[0] || '',
      currentItem: loop.iterationVariable?.[0] || '',
      iterationOrder: (loop.iterationOrder?.[0] || 'Asc') as 'Asc' | 'Desc'
    };

    Logger.debug('LoopVariableAnalyzer', 
      `Loop processing collection ${variables.inputCollection} ` +
      `with iterator ${variables.currentItem} in ${variables.iterationOrder} order`);

    return variables;
  }
}