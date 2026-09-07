import { parseCondition, readValue, toArray } from '../parseValue.js';
import { FlowFieldAssignment, FlowOutputAssignment, RecordBody } from '../types.js';

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
 *
 * The output side matters just as much as the input side: without `outputReference`
 * the emitter cannot name the variable a lookup's result lands in, without
 * `assignRecordIdToReference` it cannot emit the Id write-back after a DML insert, and
 * without `getFirstRecordOnly` + `sortField`/`sortOrder` a "first record" query can
 * silently pick a different row than the Flow did.
 */
export function parseRecordBody(raw: Record<string, unknown>): RecordBody {
  const inputAssignments: FlowFieldAssignment[] = toArray(raw.inputassignments).map((a) => ({
    field: String(a.field ?? ''),
    value: readValue(a.value),
  }));

  const outputAssignments: FlowOutputAssignment[] = toArray(raw.outputassignments).map((a) => ({
    field: String(a.field ?? ''),
    assignToReference: String(a.assigntoreference ?? ''),
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
    outputReference: raw.outputreference === undefined ? undefined : String(raw.outputreference),
    outputAssignments,
    assignRecordIdToReference:
      raw.assignrecordidtoreference === undefined ? undefined : String(raw.assignrecordidtoreference),
    inputReference: raw.inputreference === undefined ? undefined : String(raw.inputreference),
    sortField: raw.sortfield === undefined ? undefined : String(raw.sortfield),
    sortOrder: raw.sortorder === undefined ? undefined : String(raw.sortorder),
    limit: raw.limit === undefined ? undefined : Number(raw.limit),
    assignNullValuesIfNoRecordsFound: toBool(raw.assignnullvaluesifnorecordsfound),
  };
}
