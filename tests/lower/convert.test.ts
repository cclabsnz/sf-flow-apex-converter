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
