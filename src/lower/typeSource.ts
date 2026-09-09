import {
  ApexType, BOOLEAN, DATE, DATETIME, DECIMAL, ID, STRING, listOf, sobjectType,
} from '../apex/types.js';
import { FlowIR } from '../ir/types.js';
import { ResolvedType, TypeSource } from './context.js';

/** Standard fields present on every SObject, typed from the platform, not guessed. */
const STANDARD_FIELDS: Record<string, ApexType> = {
  id: ID,
  ownerid: ID,
  createdbyid: ID,
  lastmodifiedbyid: ID,
  name: STRING,
  createddate: DATETIME,
  lastmodifieddate: DATETIME,
  isdeleted: BOOLEAN,
};

/** Flow's dataType vocabulary mapped onto the Apex type model. */
export function flowTypeToApex(
  dataType: string,
  objectType: string | undefined,
  isCollection: boolean,
  apexClass?: string
): ApexType {
  const scalar = ((): ApexType => {
    switch (dataType.toLowerCase()) {
      case 'string':
      case 'picklist':
      case 'multipicklist':
      case 'phone':
      case 'email':
      case 'url':
      case 'textarea':
        return STRING;
      case 'boolean':
        return BOOLEAN;
      case 'number':
      case 'currency':
      case 'double':
      case 'percent':
        return DECIMAL;
      // Flow has no separate integer storage: every numeric, whatever the
      // metadata calls it, is stored and surfaced as a Decimal. Deliberate,
      // not an oversight — do not "fix" this to Integer in a later milestone.
      case 'int':
      case 'integer':
        return DECIMAL;
      case 'date':
        return DATE;
      case 'datetime':
        return DATETIME;
      case 'sobject':
        return sobjectType(objectType);
      case 'apex':
        // An Apex-defined type is a class the converter cannot see, so it is
        // modelled as an SObject-free opaque name — its own <apexClass>, read
        // from Flow metadata, not guessed. A variable typed this way (an
        // invocable's request/response wrapper, e.g. ValidationMessage) has no
        // <objectType> at all, so falling back to that first would leave it
        // untyped as String, and every field write on it a compile error
        // against the real class.
        return sobjectType(apexClass ?? objectType);
      default:
        // Anything unrecognised. No name to go on, so String rather than a
        // guessed class reference.
        return objectType ? sobjectType(objectType) : STRING;
    }
  })();
  return isCollection ? listOf(scalar) : scalar;
}

/**
 * Naming heuristics — the 2.0.x behaviour, kept only as a last resort and
 * always reported as a guess. Milestone 3 replaces this with a describe.
 */
function heuristicFieldType(field: string): ApexType {
  const f = field.toLowerCase();
  if (f.endsWith('id') || f.endsWith('__r')) return ID;
  if (f.startsWith('is') || f.startsWith('has') || f.includes('flag')) return BOOLEAN;
  if (f.includes('amount') || f.includes('rate') || f.includes('total') || f.includes('count')) {
    return DECIMAL;
  }
  if (f.includes('date')) return DATETIME;
  return STRING;
}

/**
 * Types resolved from the Flow's own declarations, then the standard-field
 * table, then naming heuristics.
 *
 * Never throws. A reference this cannot place resolves to a flagged String
 * guess, because refusing here would refuse the whole Flow over one unknown
 * name — and the agreed policy is that unknown TYPES are flagged while unknown
 * STRUCTURE is refused.
 */
export function declarationTypeSource(ir: FlowIR): TypeSource {
  const declarations = new Map(ir.declarations.map((d) => [d.name.toLowerCase(), d]));
  const loops = new Map(
    ir.nodes
      .filter((n) => n.body?.kind === 'loop')
      .map((n) => [n.name.toLowerCase(), n])
  );

  /** The SObject a dotted reference's first segment refers to, if any. */
  const objectOf = (head: string): string | undefined => {
    const declared = declarations.get(head.toLowerCase());
    if (declared?.objectType) return declared.objectType;
    const loop = loops.get(head.toLowerCase());
    if (loop && loop.body?.kind === 'loop') {
      const source = declarations.get(loop.body.collection.toLowerCase());
      if (source?.objectType) return source.objectType;
    }
    return undefined;
  };

  const resolveField = (object: string | undefined, field: string): ResolvedType => {
    const standard = STANDARD_FIELDS[field.toLowerCase()];
    if (standard) {
      // 'standard' means "read from the platform for this object". Without a
      // resolved object there is no platform fact to read — the field NAME
      // matching the standard-field table is a guess like any other, so it is
      // reported as one rather than overstating what is actually known.
      if (object !== undefined) {
        return { type: standard, provenance: 'standard', note: `${field} is a standard field` };
      }
      return {
        type: standard,
        provenance: 'heuristic',
        note: `${field} looks like a standard field, but its object is unresolved`,
      };
    }
    return {
      type: heuristicFieldType(field),
      provenance: 'heuristic',
      note: `type of ${object ?? '?'}.${field} guessed from its name`,
    };
  };

  return {
    resolve(reference: string): ResolvedType {
      // Case-folded on the prefix only: Flow and Apex both treat this
      // identifier case-insensitively, but the permission NAME after the dot
      // stays verbatim because it is passed through to
      // FeatureManagement.checkPermission('...') later, where casing matters.
      if (/^\$permission\./i.test(reference)) {
        return { type: BOOLEAN, provenance: 'standard', note: 'custom permission check' };
      }

      const dot = reference.indexOf('.');
      if (dot === -1) {
        const declared = declarations.get(reference.toLowerCase());
        if (declared) {
          return {
            type: flowTypeToApex(declared.dataType, declared.objectType, declared.isCollection, declared.apexClass),
            provenance: 'declared',
            note: `${reference} declared as ${declared.dataType}`,
          };
        }
        return {
          type: STRING,
          provenance: 'heuristic',
          note: `${reference} is not declared in this Flow; assumed String`,
        };
      }

      const head = reference.slice(0, dot);
      const field = reference.slice(dot + 1);
      return resolveField(objectOf(head), field);
    },
  };
}
