import { SimplifiedFlowAnalyzer } from '../src/utils/SimplifiedFlowAnalyzer.js';

describe('SimplifiedFlowAnalyzer', () => {
  test('includes fault connector targets in execution path', async () => {
    const analyzer = new SimplifiedFlowAnalyzer();
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<flow>
  <actioncalls>
    <name>Do_Something</name>
    <actionname>SomeAction</actionname>
    <connector>
      <targetreference>Done</targetreference>
    </connector>
    <faultconnector>
      <targetreference>Handle_Error</targetreference>
    </faultconnector>
  </actioncalls>
  <assignments>
    <name>Handle_Error</name>
    <connector>
      <targetreference>Done</targetreference>
    </connector>
  </assignments>
  <assignments>
    <name>Done</name>
  </assignments>
  <start>
    <connector>
      <targetreference>Do_Something</targetreference>
    </connector>
  </start>
</flow>`;

    const result = await analyzer.analyzeFlow(xml, 'TestFlow');
    expect(result.executionPath).toContain('Handle_Error');
  });
});
