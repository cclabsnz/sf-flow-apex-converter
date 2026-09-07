import { parseCondition, toArray } from '../parseValue.js';
import { CollectionProcessorBody } from '../types.js';

/**
 * The body of a collectionProcessor (FilterCollectionProcessor, SortCollectionProcessor,
 * MapCollectionProcessor, RecommendationMapCollectionProcessor).
 *
 * Before this parser existed, `collectionprocessors` was a modelled element type with
 * no body parser — the IR counted it as "understood" while every bit of its meaning
 * (which collection it filters, on what condition) lived only in `raw`, forcing the
 * emitter straight back to untyped xml2js output for a construct the coverage report
 * claimed to already model.
 */
export function parseCollectionProcessorBody(raw: Record<string, unknown>): CollectionProcessorBody {
  return {
    kind: 'collectionProcessor',
    collection: String(raw.collectionreference ?? ''),
    processorType: raw.collectionprocessortype === undefined ? undefined : String(raw.collectionprocessortype),
    conditionLogic: raw.conditionlogic === undefined ? undefined : String(raw.conditionlogic),
    conditions: toArray(raw.conditions).map(parseCondition),
    assignNextValueToReference: raw.assignnextvaluetoreference === undefined
      ? undefined
      : String(raw.assignnextvaluetoreference),
  };
}
