import { FlowBody } from '../types.js';
import { parseAssignmentBody } from './assignmentBody.js';
import { parseCollectionProcessorBody } from './collectionProcessorBody.js';
import { parseDecisionBody } from './decisionBody.js';
import { parseActionBody, parseLoopBody, parseSubflowBody } from './flowControlBody.js';
import { parseRecordBody } from './recordBody.js';

/**
 * Element kind to typed body.
 *
 * A kind with no entry returns undefined rather than an empty body, so a caller can
 * tell "this element has no typed body yet" from "this element's body is empty".
 * Conflating the two is how a consumer ends up silently treating unparsed structure
 * as absent structure.
 */
export function parseBody(kind: string, raw: Record<string, unknown>): FlowBody | undefined {
  switch (kind) {
    case 'recordlookups':
    case 'recordcreates':
    case 'recordupdates':
    case 'recorddeletes':
      return parseRecordBody(raw);
    case 'decisions':
      return parseDecisionBody(raw);
    case 'assignments':
      return parseAssignmentBody(raw);
    case 'loops':
      return parseLoopBody(raw);
    case 'subflows':
      return parseSubflowBody(raw);
    case 'actioncalls':
      return parseActionBody(raw);
    case 'collectionprocessors':
      return parseCollectionProcessorBody(raw);
    default:
      return undefined;
  }
}
