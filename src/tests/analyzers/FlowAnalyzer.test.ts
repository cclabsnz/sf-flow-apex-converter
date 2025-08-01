import { FlowAnalyzer } from '../../utils/FlowAnalyzer';
import { Connection } from 'jsforce';
import { SchemaManager } from '../../utils/SchemaManager';
import { SubflowManager } from '../../utils/SubflowManager';
import { SecurityAnalyzer } from '../../utils/analyzers/SecurityAnalyzer';
import { OrgMetadataFetcher } from '../../utils/fetchers/OrgMetadataFetcher';
import { ComprehensiveFlowAnalysis, FlowMetadata, SubflowAnalysis, FlowVersion } from '../../types';

jest.mock('jsforce');
jest.mock('../../utils/SchemaManager');
jest.mock('../../utils/SubflowManager');
jest.mock('../../utils/analyzers/SecurityAnalyzer');
jest.mock('../../utils/fetchers/OrgMetadataFetcher');

describe('FlowAnalyzer', () => {
  let connection: jest.Mocked<Connection>;
  let schemaManager: jest.Mocked<SchemaManager>;
  let subflowManager: jest.Mocked<SubflowManager>;
  let securityAnalyzer: jest.Mocked<SecurityAnalyzer>;
  let orgMetadataFetcher: jest.Mocked<OrgMetadataFetcher>;
  let flowAnalyzer: FlowAnalyzer;

  beforeEach(() => {
    connection = new Connection({}) as jest.Mocked<Connection>;
    schemaManager = new SchemaManager(connection) as jest.Mocked<SchemaManager>;
    subflowManager = new SubflowManager(connection, schemaManager) as jest.Mocked<SubflowManager>;
    securityAnalyzer = new SecurityAnalyzer() as jest.Mocked<SecurityAnalyzer>;
    orgMetadataFetcher = new OrgMetadataFetcher(connection) as jest.Mocked<OrgMetadataFetcher>;
    flowAnalyzer = new FlowAnalyzer(connection, schemaManager, subflowManager, securityAnalyzer, orgMetadataFetcher);
  });

  it('should perform a comprehensive analysis of a flow', async () => {
    const flowVersion: FlowVersion = {
        version: '1',
        status: 'Active',
        lastModified: new Date().toISOString()
    };
    const flowMetadata: { Metadata: FlowMetadata; definition: { DeveloperName: string; ProcessType: string; }} = {
      Metadata: {
        _flowVersion: flowVersion,
        apiVersion: ['58.0'],
        recordLookups: [
          {
            name: ['Get_Account'],
            object: ['Account'],
            filters: [
              {
                field: ['Id'],
                operator: ['EqualTo'],
                value: {
                  elementReference: ['recordId'],
                },
              },
            ],
          },
        ],
      },
      definition: {
        DeveloperName: 'TestFlow',
        ProcessType: 'Flow',
      },
    };

    const securityContext = {
        isSystemMode: false,
        enforceObjectPermissions: true,
        enforceFieldPermissions: true,
        enforceSharingRules: true,
        requiredPermissions: new Set('Read_Account'),
        requiredObjects: new Set('Account'),
        requiredFields: new Map([
            ['Account', new Set('Id')]
        ]),
    };

    const subflowAnalysis: SubflowAnalysis = {
        flowName: 'subflow',
        processType: 'Flow',
        totalElements: 0,
        dmlOperations: 0,
        soqlQueries: 0,
        bulkificationScore: 100,
        elements: new Map(),
        recommendations: [],
        apiVersion: '58.0',
        subflows: [],
        operationSummary: {
            totalOperations: {
                dml: { total: 0, inLoop: 0 },
                soql: { total: 0, inLoop: 0 }
            },
            dmlOperations: [],
            soqlQueries: []
        },
        loops: [],
        loopContexts: new Map(),
        totalElementsWithSubflows: 0,
        cumulativeDmlOperations: 0,
        cumulativeSoqlQueries: 0,
        depth: 1
    };

    securityAnalyzer.analyzeSecurityContext.mockReturnValue(securityContext);
    subflowManager.analyzeSubflow.mockResolvedValue(subflowAnalysis);

    const analysis = await flowAnalyzer.analyzeFlowComprehensive(flowMetadata);

    expect(analysis.flowName).toBe('TestFlow');
    expect(analysis.processType).toBe('Flow');
    expect(analysis.totalElements).toBe(1);
    expect(analysis.soqlQueries).toBe(1);
    expect(analysis.elements.has('Get_Account')).toBe(true);
    expect(analysis.objectDependencies.has('Account')).toBe(true);
    expect(analysis.securityContext).toEqual(securityContext);
  });

  it('should analyze a flow with a loop and DML operation', async () => {
    const flowVersion: FlowVersion = {
        version: '1',
        status: 'Active',
        lastModified: new Date().toISOString()
    };
    const flowMetadata: { Metadata: FlowMetadata; definition: { DeveloperName: string; ProcessType: string; }} = {
      Metadata: {
        _flowVersion: flowVersion,
        apiVersion: ['58.0'],
        loops: [
          {
            name: ['Loop_over_Accounts'],
            collectionReference: ['accounts'],
            iterationOrder: ['Asc'],
            connector: [
              {
                targetReference: ['Update_Account'],
              },
            ],
          },
        ],
        recordUpdates: [
          {
            name: ['Update_Account'],
            object: ['Account'],
            filters: [
              {
                field: ['Id'],
                operator: ['EqualTo'],
                value: {
                  elementReference: ['Loop_over_Accounts.Id'],
                },
              },
            ],
          },
        ],
      },
      definition: {
        DeveloperName: 'TestFlowWithLoop',
        ProcessType: 'Flow',
      },
    };

    const securityContext = {
        isSystemMode: false,
        enforceObjectPermissions: true,
        enforceFieldPermissions: true,
        enforceSharingRules: true,
        requiredPermissions: new Set('Edit_Account'),
        requiredObjects: new Set('Account'),
        requiredFields: new Map([
            ['Account', new Set('Id')]
        ]),
    };

    securityAnalyzer.analyzeSecurityContext.mockReturnValue(securityContext);
    subflowManager.analyzeSubflow.mockResolvedValue({} as SubflowAnalysis);

    const analysis = await flowAnalyzer.analyzeFlowComprehensive(flowMetadata);

    expect(analysis.flowName).toBe('TestFlowWithLoop');
    expect(analysis.totalElements).toBe(2);
    expect(analysis.dmlOperations).toBe(1);
    expect(analysis.loops.length).toBe(1);
    expect(analysis.recommendations.length).toBeGreaterThan(0);
    expect(analysis.recommendations[0].reason).toContain('Move DML operations outside of loop');
  });
});
