import { parseFlowFile } from '../../src/ir/parseFlow.js';
import { lowerFlow } from '../../src/lower/lowerFlow.js';
import { UnsupportedConstructError } from '../../src/lower/value.js';

describe('converting the bundled example Flow', () => {
  // exampleflow.xml calls four subflows. Two of their names —
  // NC_Validation_Loans_Servicing_Comply_with_BS20 (46 chars) and
  // NC_Loan_Validate_Rates_and_Payments_Components (46 chars) — exceed
  // Apex's 40-character class-name limit (verified against the org: 40
  // deploys, 41 fails with "Identifier name is too long"). A class reference
  // cannot be shortened by a converter that does not generate that class, so
  // this Flow correctly refuses rather than emitting a reference to a name
  // Apex can never accept. This is the intended, correct outcome for this
  // fixture today, not a defect: the fixture genuinely cannot produce
  // deployable Apex until the offending subflows are renamed.
  it('refuses because a subflow name exceeds the 40-character Apex class-name limit', async () => {
    const ir = await parseFlowFile('exampleflow.xml');
    expect(() => lowerFlow(ir)).toThrow(UnsupportedConstructError);
    expect(() => lowerFlow(ir)).toThrow(/is 46 characters/);
  });

  it('names the offending subflow in the refusal, not just "too long"', async () => {
    const ir = await parseFlowFile('exampleflow.xml');
    try {
      lowerFlow(ir);
      throw new Error('expected lowerFlow to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedConstructError);
      expect((error as Error).message).toContain('NC_Validation_Loans_Servicing_Comply_with_BS20');
    }
  });
});

/**
 * exampleflow.xml refuses, correctly, so the assertions below lost their only
 * coverage when it stopped converting: nothing else took a Flow from XML all
 * the way to a class and inspected it. This fixture is deliberately WITHIN every
 * limit the converter enforces, and exercises an input parameter, a Get
 * Records, a loop, a decision, a field write onto the loop variable, a
 * collection append, an output variable, a formula stub, and string values
 * containing apostrophes.
 */
describe('converting a within-limit example Flow end to end', () => {
  const FIXTURE = 'tests/fixtures/NC_Flag_Overdue_Loans.flow-meta.xml';

  it('lowers without refusing', async () => {
    const ir = await parseFlowFile(FIXTURE);
    expect(() => lowerFlow(ir)).not.toThrow();
  });

  it('produces a class whose shape is Apex', async () => {
    const { source } = lowerFlow(await parseFlowFile(FIXTURE));
    // runInMode DefaultMode is 'inherited sharing' — the sharing decision made
    // end to end, not just in lowerFlow's unit tests.
    expect(source).toContain('public inherited sharing class NC_Flag_Overdue_Loans');
    // Two output variables, so execute returns the inner Result rather than
    // staying void, and the one isInput declaration is its parameter.
    expect(source).toContain('public static Result execute(List<String> AccountIds)');
    expect(source.split('{').length).toBe(source.split('}').length);
  });

  it('reports the stubs it generated rather than hiding them', async () => {
    const { manifest } = lowerFlow(await parseFlowFile(FIXTURE));
    // The one formula with a function in it. A stub compiles and throws; the
    // failure mode this guards against is generating it and saying nothing.
    expect(manifest.stubs).toHaveLength(1);
    expect(manifest.stubs[0]).toContain('SummaryText');
  });

  it('never emits an unescaped apostrophe inside a string literal', async () => {
    const { source } = lowerFlow(await parseFlowFile(FIXTURE));
    // The pipeline-level guard against the defect stringLiteral exists to
    // prevent. This Flow carries an apostrophe in a constant, in a decision's
    // comparison value, and in a field write's value — three separate routes
    // from raw Flow data to Apex source.
    expect(source).toContain("O\\'Brien");
    for (const line of source.split('\n')) {
      // A doc comment is not a string literal, and ordinary English prose
      // legitimately contains a possessive apostrophe — e.g. this class's own
      // header, "It preserves the Flow's semantics exactly". Apex needs no
      // escaping inside a comment, so only non-comment lines are checked here.
      if (/^\s*(\*|\/\/|\/\*\*)/.test(line)) continue;
      const quotes = (line.match(/(?<!\\)'/g) ?? []).length;
      expect(quotes % 2).toBe(0);
    }
  });
});
