# Salesforce Flow to Apex Converter

A CLI tool to analyze and convert Salesforce Flows into bulkified Apex classes.

## Installation

```bash
npm install -g @cclabsnz/sf-flow-apex-converter
```

## Usage

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

### Running the Tool

```bash
# Show help information
sf-flow-apex-converter --help

# Show version
sf-flow-apex-converter --version

# Method 1: Analyze flow from Salesforce org
# First authenticate with your org using: sf login web
sf-flow-apex-converter MyFlowName

# Method 2: Analyze local flow file using absolute path
sf-flow-apex-converter /path/to/MyFlow.flow-meta.xml

# Method 3: Analyze local flow file using relative path
# Navigate to your Salesforce project root first:
cd my-sf-project
sf-flow-apex-converter ./force-app/main/default/flows/MyFlow.flow-meta.xml
```

## Sample Flow Analysis

Given a flow like this:
```xml
<!-- MyFlow.flow-meta.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <recordLookups>
        <name>Get_Account</name>
        <label>Get Account</label>
        <locationX>176</locationX>
        <locationY>188</locationY>
        <assignNullValuesIfNoRecordsFound>false</assignNullValuesIfNoRecordsFound>
        <connector>
            <targetReference>Update_Account</targetReference>
        </connector>
        <filterLogic>and</filterLogic>
        <filters>
            <field>Id</field>
            <operator>EqualTo</operator>
            <value>
                <elementReference>AccountId</elementReference>
            </value>
        </filters>
        <object>Account</object>
        <outputReference>AccountRecord</outputReference>
        <queriedFields>Name</queriedFields>
        <queriedFields>Type</queriedFields>
    </recordLookups>
    <recordUpdates>
        <name>Update_Account</name>
        <label>Update Account</label>
        <locationX>176</locationX>
        <locationY>188</locationY>
        <inputReference>AccountRecord</inputReference>
    </recordUpdates>
</Flow>
```

Running the analysis:
```bash
sf-flow-apex-converter ./force-app/main/default/flows/MyFlow.flow-meta.xml
```

Will output something like:
```json
{
  "flowName": "MyFlow",
  "processType": "Flow",
  "totalElements": 2,
  "dmlOperations": 1,
  "soqlQueries": 1,
  "bulkificationScore": 80,
  "objectDependencies": ["Account"],
  "recommendations": [
    "Consider combining SOQL queries where possible",
    "Move SOQL queries outside of loop in element: Get_Account"
  ]
}
```

## License

MIT

## Support

Report issues at [GitHub Issues](https://github.com/cclabsnz/sf-flow-apex-converter/issues)