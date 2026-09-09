import { parseFlowFile } from '../../src/ir/parseFlow.js';
import { lowerFlow } from '../../src/lower/lowerFlow.js';

describe('converting the bundled example Flow', () => {
  it('lowers without refusing', async () => {
    const ir = await parseFlowFile('exampleflow.xml');
    expect(() => lowerFlow(ir)).not.toThrow();
  });

  it('produces a class whose shape is Apex', async () => {
    const { source } = lowerFlow(await parseFlowFile('exampleflow.xml'));
    expect(source).toContain('public with sharing class');
    // The bundled Flow declares two output variables (ValidationMessages,
    // BetterHomesTopupValidationMessage), so per lowerFlow's own tested
    // design (lowerFlow.test.ts: "returns output declarations on an inner
    // Result class" / "stays void when the Flow declares no outputs"),
    // execute returns Result rather than staying void.
    expect(source).toContain('public static Result execute(');
    expect(source.split('{').length).toBe(source.split('}').length);
  });

  it('reports the stubs it generated rather than hiding them', async () => {
    const { manifest } = lowerFlow(await parseFlowFile('exampleflow.xml'));
    // Two formulas with functions, and one apex action.
    expect(manifest.stubs.length).toBeGreaterThanOrEqual(3);
  });

  it('never emits an unescaped apostrophe inside a string literal', async () => {
    const { source } = lowerFlow(await parseFlowFile('exampleflow.xml'));
    for (const line of source.split('\n')) {
      // A doc comment is not a string literal, and ordinary English prose
      // legitimately contains a possessive apostrophe — e.g. this class's own
      // header, "It preserves the Flow's semantics exactly," from lowerFlow's
      // fixed doc text. Apex needs no escaping inside a comment, so only
      // non-comment lines are checked here.
      if (/^\s*(\*|\/\/|\/\*\*)/.test(line)) continue;
      const quotes = (line.match(/(?<!\\)'/g) ?? []).length;
      expect(quotes % 2).toBe(0);
    }
  });
});
