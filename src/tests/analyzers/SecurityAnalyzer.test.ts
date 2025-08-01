import { SecurityAnalyzer } from '../../utils/analyzers/SecurityAnalyzer';
import { FlowElementType } from '../../types';
import { XMLNode } from '../../utils/types/XMLNode';

describe('SecurityAnalyzer', () => {
  let analyzer: SecurityAnalyzer;

  beforeEach(() => {
    analyzer = new SecurityAnalyzer();
  });

  it('should correctly analyze security context for a user-mode flow', () => {
    const metadata: XMLNode = {
      runInMode: ['USER'],
      recordCreates: [
        {
          object: ['Account'],
          fields: ['Name', 'Type'],
        },
      ],
      recordLookups: [
        {
          object: ['Contact'],
          fields: ['FirstName', 'LastName'],
        },
      ],
    };

    const context = analyzer.analyzeSecurityContext(metadata);

    expect(context.isSystemMode).toBe(false);
    expect(context.enforceObjectPermissions).toBe(true);
    expect(context.enforceFieldPermissions).toBe(true);
    expect(context.enforceSharingRules).toBe(true);
    expect(context.requiredPermissions).toEqual(new Set(['Create_Account', 'Read_Contact']));
    expect(context.requiredObjects).toEqual(new Set(['Account', 'Contact']));
    expect(context.requiredFields).toEqual(
      new Map([
        ['Account', new Set(['Name', 'Type'])],
        ['Contact', new Set(['FirstName', 'LastName'])],
      ])
    );
  });

  it('should correctly analyze security context for a system-mode flow', () => {
    const metadata: XMLNode = {
      runInMode: ['SYSTEM'],
      recordUpdates: [
        {
          object: ['Opportunity'],
          fields: ['StageName'],
        },
      ],
    };

    const context = analyzer.analyzeSecurityContext(metadata);

    expect(context.isSystemMode).toBe(true);
    expect(context.enforceObjectPermissions).toBe(false);
    expect(context.enforceFieldPermissions).toBe(false);
    expect(context.enforceSharingRules).toBe(false);
    expect(context.requiredPermissions).toEqual(new Set(['Edit_Opportunity']));
    expect(context.requiredObjects).toEqual(new Set(['Opportunity']));
    expect(context.requiredFields).toEqual(
      new Map([['Opportunity', new Set(['StageName'])]])
    );
  });

  it('should handle flows with no security-impacting elements', () => {
    const metadata: XMLNode = {
      assignments: [
        {
          assignToReference: ['myVar'],
          value: ['123'],
        },
      ],
    };

    const context = analyzer.analyzeSecurityContext(metadata);

    expect(context.isSystemMode).toBe(false);
    expect(context.requiredPermissions.size).toBe(0);
    expect(context.requiredObjects.size).toBe(0);
    expect(context.requiredFields.size).toBe(0);
  });
});
