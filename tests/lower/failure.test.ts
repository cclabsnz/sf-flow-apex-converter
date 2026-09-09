import { ApexTypeError } from '../../src/apex/errors.js';
import { LoweringRefusal } from '../../src/lower/context.js';
import { conversionFailureLines } from '../../src/lower/failure.js';
import { UnsupportedConstructError } from '../../src/lower/value.js';

describe('conversionFailureLines', () => {
  it('reports a whole-graph refusal, one line per problem', () => {
    const lines = conversionFailureLines(new LoweringRefusal(['first', 'second']));
    expect(lines).toEqual(['first', 'second']);
  });

  it('reports an unsupported construct', () => {
    expect(conversionFailureLines(new UnsupportedConstructError('no mapping for X')))
      .toEqual(['no mapping for X']);
  });

  it('reports an ApexTypeError, which used to escape as a raw Node stack trace', () => {
    // Real Flow, real CLI: `{!Acct.AnnualRevenue} > 1000` — the heuristic misses
    // AnnualRevenue, guesses String, the comparison constructor refuses, and the
    // user got a stack trace. Same for Probability, NumberOfEmployees, Quantity.
    const lines = conversionFailureLines(
      new ApexTypeError("While lowering 'D' (decisions): Apex cannot compare String with Decimal")
    );
    expect(lines).toEqual([
      "While lowering 'D' (decisions): Apex cannot compare String with Decimal",
    ]);
  });

  it('does not claim anything else as a conversion failure', () => {
    // A genuine bug must still surface as a crash, not be dressed up as a
    // refusal the user could act on.
    expect(conversionFailureLines(new TypeError('cannot read properties of undefined')))
      .toBeUndefined();
    expect(conversionFailureLines('a string')).toBeUndefined();
  });
});
