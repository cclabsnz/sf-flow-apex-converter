import { parseCondition, readValue, toArray } from '../parseValue.js';
import { FlowFieldAssignment, RecordBody } from '../types.js';

function toBool(value: unknown): boolean {
  return String(value) === 'true';
}

/**
 * The body of a record element: which object, which filters, which field writes.
 *
 * This is the source the emitter uses to build a SOQL WHERE clause and the field
 * writes preceding a DML collection add. Guessing any of it — as the 2.0.x generator
 * did when it hardcoded `FROM Account` — produces Apex that compiles and reads the
 * wrong table.
 */
export function parseRecordBody(raw: Record<string, unknown>): RecordBody {
  const inputAssignments: FlowFieldAssignment[] = toArray(raw.inputassignments).map((a) => ({
    field: String(a.field ?? ''),
    value: readValue(a.value),
  }));

  return {
    kind: 'record',
    object: raw.object === undefined ? undefined : String(raw.object),
    filterLogic: raw.filterlogic === undefined ? undefined : String(raw.filterlogic),
    filters: toArray(raw.filters).map(parseCondition),
    inputAssignments,
    queriedFields: toArray(raw.queriedfields).map((f) => String(f)).filter(Boolean),
    getFirstRecordOnly: toBool(raw.getfirstrecordonly),
    storeOutputAutomatically: toBool(raw.storeoutputautomatically),
  };
}
