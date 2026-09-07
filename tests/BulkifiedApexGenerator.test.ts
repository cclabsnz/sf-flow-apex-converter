import * as path from 'path';
import { BulkifiedApexGenerator } from '../src/utils/BulkifiedApexGenerator.js';
import { SimplifiedFlowAnalyzer, FlowAnalysisResult } from '../src/utils/SimplifiedFlowAnalyzer.js';

/**
 * These tests exist because this generator shipped Apex that could not compile.
 * 2.0.1 emitted calls to handleValidationError, three validate<Subflow>_Bulkified
 * methods and a ValidationResult type, and defined none of them. Nothing caught it,
 * because nothing tested the generator's output.
 *
 * The bundled example Flow is the fixture: it is committed, deterministic, and
 * exercises the in-loop-subflow path that produced the bug.
 */

const EXAMPLE_FLOW = path.join(__dirname, '..', 'exampleflow.xml');

/** Identifiers Apex provides; anything else called must be defined in the class. */
const APEX_BUILTINS = new Set([
  'if', 'for', 'while', 'catch', 'switch', 'return', 'new', 'insert', 'update', 'delete',
  'isEmpty', 'add', 'put', 'get', 'getMessage', 'debug', 'addError', 'valueOf', 'remove',
  'clear', 'contains', 'startsWith', 'endsWith', 'keySet', 'values', 'containsKey', 'size',
]);

/** Strip comments so the scan reads code, not prose that happens to contain "word (". */
function stripComments(apex: string): string {
  return apex.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function callees(apex: string): Set<string> {
  return new Set(
    [...stripComments(apex).matchAll(/(?:^|[^\w.])([a-zA-Z_]\w*)\s*\(/g)].map((m) => m[1])
  );
}

/** Methods and inner classes both satisfy a call site — `new Foo()` needs `class Foo`. */
function definedNames(apex: string): Set<string> {
  const code = stripComments(apex);
  const methods = [...code.matchAll(/(?:private|public|protected)\s+[\w<>,\s[\]]+?\s+(\w+)\s*\(/g)].map((m) => m[1]);
  const classes = [...code.matchAll(/class\s+(\w+)/g)].map((m) => m[1]);
  return new Set([...methods, ...classes]);
}

describe('BulkifiedApexGenerator', () => {
  let generated: string;
  let analysis: Map<string, FlowAnalysisResult>;

  beforeAll(async () => {
    const analyzer = new SimplifiedFlowAnalyzer();
    analysis = await analyzer.analyzeSubflows(EXAMPLE_FLOW);
    const generator = new BulkifiedApexGenerator(analyzer);
    generated = generator.generateApex(analysis, 'exampleflow').apexCode;
  });

  test('the fixture actually exercises the in-loop subflow path', () => {
    // Guards against the suite passing vacuously if the example Flow is replaced.
    const flow = analysis.get('exampleflow');
    expect(flow!.subflows.filter((s) => s.isInLoop).length).toBeGreaterThan(0);
  });

  test('defines every method it calls', () => {
    const defined = definedNames(generated);
    const missing = [...callees(generated)].filter(
      (c) => !defined.has(c) && !APEX_BUILTINS.has(c)
    );
    expect(missing).toEqual([]);
  });

  test('defines the ValidationResult type it instantiates', () => {
    expect(generated).toContain('new ValidationResult()');
    expect(generated).toMatch(/class\s+ValidationResult/);
  });

  test('does not double the _Bulkified suffix on generated method names', () => {
    // sanitizeClassName already appends _Bulkified; appending it again produced
    // validateKey_Loan_Date_Validation_Bulkified_Bulkified in 2.0.3.
    expect(generated).not.toMatch(/_Bulkified_Bulkified/);
  });

  test('every validation call has a matching definition', () => {
    const called = [...generated.matchAll(/=\s*\n?\s*(validate\w+)\(record\)/g)].map((m) => m[1]);
    expect(called.length).toBeGreaterThan(0);
    for (const name of called) {
      expect(generated).toContain(`private ValidationResult ${name}(SObject record)`);
    }
  });

  describe('generated SOQL', () => {
    test('queries the object the Flow declares, not a hardcoded one', () => {
      // The example Flow's only lookup declares LLC_BI__Pricing_Stream__c. Emitting
      // `FROM Account` produces Apex that compiles and silently queries the wrong table.
      expect(generated).toContain('FROM LLC_BI__Pricing_Stream__c');
      expect(generated).not.toMatch(/FROM Account\b/);
    });

    test('runs queries in user mode', () => {
      // Generated code inherits the running user's context; without USER_MODE it
      // ignores FLS and sharing, which is exactly what an audit will flag.
      const selects = [...generated.matchAll(/SELECT[\s\S]*?\]/g)].map((m) => m[0]);
      expect(selects.length).toBeGreaterThan(0);
      for (const s of selects) {
        expect(s).toContain('WITH USER_MODE');
      }
    });

    test('gives each query result a distinct variable name', () => {
      const names = [...generated.matchAll(/List<SObject>\s+(\w+)\s*=\s*\[/g)].map((m) => m[1]);
      expect(new Set(names).size).toBe(names.length);
    });
  });

  describe('generated DML', () => {
    test('runs DML in user mode', () => {
      for (const op of ['insert', 'update', 'delete']) {
        const re = new RegExp(`\\b${op}\\s+recordsTo`, 'i');
        if (re.test(generated)) {
          expect(generated).toMatch(
            new RegExp(`Database\\.${op}\\(recordsTo\\w+, AccessLevel\\.USER_MODE\\)`, 'i')
          );
        }
      }
    });
  });

  describe('honesty of the output', () => {
    test('does not invent business logic the Flow never described', () => {
      // 2.0.x emitted a Status == 'Processing' -> 'Processed' block for every Flow,
      // whether or not the Flow had a Status field. Scaffolding is fine; scaffolding
      // that looks like extracted business rules is not.
      expect(generated).not.toContain("record.get('Status') == 'Processing'");
      expect(generated).not.toContain("record.put('Status', 'Processed')");
    });

    test('marks the un-migrated body as unimplemented', () => {
      expect(generated).toMatch(/TODO|not been (migrated|translated)/i);
    });

    test('does not claim subflow logic was integrated when it was not', () => {
      const analyzer2 = new SimplifiedFlowAnalyzer();
      const generator2 = new BulkifiedApexGenerator(analyzer2);
      const recs = generator2.generateApex(analysis, 'exampleflow').recommendations;
      const claims = recs.filter((r) => /has been integrated/i.test(r));
      expect(claims).toEqual([]);
    });
  });
});
