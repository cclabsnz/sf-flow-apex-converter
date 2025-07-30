# Salesforce Flow to Apex Converter

A powerful CLI tool that converts Salesforce Flows into bulkified Apex classes, with comprehensive analysis and deployment capabilities. The tool analyzes flow structure, generates optimized Apex code, and provides deployment with proper security contexts and test coverage.

## Features

### Flow Analysis
- Deep analysis of flow metadata and structure
- Detection of SOQL queries, DML operations, and subflows
- Identification of bulkification opportunities
- Security context analysis
- Automatic complexity scoring

### Bulkification
- Automatic query consolidation
- DML operation batching
- Collection-based processing
- Governor limit protection
- Performance optimization

### Security
- Automatic security context detection
- Object and field permission enforcement
- Sharing rule compliance
- Cross-object security handling
- Permission validation

### Deployment
- Test class generation
- Pre-deployment validation
- Org compatibility checks
- Security context validation
- Code coverage verification

## Installation

```bash
npm install -g @cclabsnz/sf-flow-apex-converter
```

## Usage

### Flow API Name vs Flow Label

When analyzing flows from a Salesforce org, you must use the Flow API Name (also known as DeveloperName), not the Flow Label. Here's how to find it:

1. In Salesforce Setup:
   - Go to Setup > Process Automation > Flows
   - Look for the "API Name" column

2. In Flow Builder URL:
   - When editing a flow, look at the URL
   - It will be like: /builder/flowBuilder.app?flowId=301XXXXX
   - The API Name is listed in the flow properties

### Prerequisites

To analyze flows from a Salesforce org:
1. Install Salesforce CLI:
```bash
npm install -g @salesforce/cli
```
2. Authenticate with your org:
```bash
sf login web
```

To analyze local flow files:
1. Navigate to your Salesforce project directory (where your flow definitions exist)
2. Ensure you have the following directory structure:
```
my-sf-project/
├── force-app/
│   └── main/
│       └── default/
│           └── flows/
│               └── MyFlow.flow-meta.xml
```

### Command Options

| Option | Description |
|--------|-------------|
| --from-org | Fetch flow directly from connected org |
| --verbose | Show detailed analysis and progress |
| --deploy | Deploy generated Apex class to org |
| --test-only | Validate deployment without deploying |
| --target-org | Specify target org (alias or username) |
| --log-level | Set log level (debug, info, warn, error) |
| --quiet | Disable logging |

### Basic Usage

```bash
# Basic analysis
sf-flow-apex-converter MyFlow --from-org

# Detailed analysis with verbose output
sf-flow-apex-converter MyFlow --from-org --verbose

# Generate and deploy Apex class
sf-flow-apex-converter MyFlow --from-org --deploy

# Validate deployment without deploying
sf-flow-apex-converter MyFlow --from-org --test-only

# Deploy to specific org
sf-flow-apex-converter MyFlow --from-org --deploy --target-org myOrg

# Analyze local flow file
sf-flow-apex-converter /path/to/MyFlow.flow-meta.xml
```

## Output Examples

### Analysis Output
```
Flow: MyCustomFlow
Version: 2.0 (Active)
Last Modified: 2025-07-30T12:34:56.789Z

Elements:
  Direct elements: 15
  Total (with subflows): 23
  Breakdown:
    recordLookups: 3
    recordUpdates: 2
    decisions: 4
    loops: 1
    subflows: 2

SOQL Analysis:
  Total Queries: 5
  Sources:
    - Record Lookups
    - Apex Action: MyCustomClass (Dynamic SOQL)
    - Subflow: SubflowA

Bulkification:
  Required: true
  Reason: Contains SOQL queries in loop
  Complexity Score: 75
```

### Generated Apex Class

```apex
@SuppressWarnings('PMD.ApexCRUDViolation')
public with sharing class MyCustomFlow {
    public static void execute() {
        // Security checks
        checkAccess();
        
        // Query consolidation
        List<Account> accounts = [
            SELECT Id, Name, Type
            FROM Account
            WHERE Type IN :accountTypes
        ];
        
        // Bulk processing
        List<Contact> contactsToUpdate = new List<Contact>();
        for (Account acc : accounts) {
            // Process in bulk
        }
        
        // DML batching
        if (!contactsToUpdate.isEmpty()) {
            List<List<Contact>> chunks = new List<List<Contact>>();
            Integer chunkSize = 200;
            for (Integer i = 0; i < contactsToUpdate.size(); i += chunkSize) {
                chunks.add(contactsToUpdate.subList(i, Math.min(i + chunkSize, contactsToUpdate.size())));
            }
            
            for (List<Contact> chunk : chunks) {
                update chunk;
            }
        }
    }
    
    private static void checkAccess() {
        if (!Account.SObjectType.isAccessible()) {
            throw new System.NoAccessException('Insufficient access rights on Account');
        }
    }
}
```

### Generated Test Class

```apex
@isTest
private class MyCustomFlow_Test {
    @TestSetup
    static void setupTestData() {
        Account testAccount = new Account(
            Name = 'Test Account'
        );
        insert testAccount;
    }
    
    @isTest
    static void testPositiveScenario() {
        Test.startTest();
        MyCustomFlow.execute();
        Test.stopTest();
        
        // Verify results
        List<Account> accounts = [SELECT Id FROM Account];
        System.assertEquals(1, accounts.size());
    }
    
    @isTest
    static void testWithoutPermissions() {
        User testUser = TestDataFactory.createStandardUser();
        
        System.runAs(testUser) {
            try {
                MyCustomFlow.execute();
                System.assert(false, 'Should have thrown an exception');
            } catch (System.NoAccessException e) {
                System.assert(e.getMessage().contains('insufficient access rights'));
            }
        }
    }
}
```

## License

MIT

## Support

Report issues at [GitHub Issues](https://github.com/cclabsnz/sf-flow-apex-converter/issues)