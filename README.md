# sf-flow-apex-converter

A Salesforce CLI plugin that converts Flow definitions into bulkified Apex classes with unit tests. The tool analyzes flow metadata and generates optimized, bulkified Apex code that follows best practices.

## Features

- Analyzes Flow XML metadata and provides bulkification recommendations
- Automatically consolidates DML operations for better performance
- Optimizes SOQL queries to prevent governor limits
- Generates comprehensive test classes
- Handles subflow dependencies and bulkification
- Supports complete Flow XML schema

## Getting Started

### System Requirements

1. Install Node.js (version 14.20.0 or higher)
   ```bash
   # Check if Node.js is installed
   node --version
   
   # If not installed, download from https://nodejs.org/
   ```

2. Install the Salesforce CLI
   ```bash
   # Install Salesforce CLI
   npm install -g @salesforce/cli
   
   # Verify installation
   sf --version
   ```

3. Authenticate with your Salesforce org
   ```bash
   # Log in to your org
   sf org login web
   
   # Verify connection
   sf org display
   ```

### Installing the Tool

```bash
# Install the tool globally
npm install -g @cclabsnz/sf-flow-apex-converter

# Verify installation
sf-flow-apex-converter --version
```

### Setting Up Your Project

1. Create a new directory for your project
   ```bash
   mkdir my-sf-project
   cd my-sf-project
   ```

2. Create the required directory structure
   ```bash
   mkdir -p force-app/main/default/flows
   ```

3. Add your Flow XML file
   - Copy your Flow XML file to `force-app/main/default/flows/`
   - Or create a new one (example below)
   ```bash
   # Example: Creating a simple flow XML
   cat > force-app/main/default/flows/MyTestFlow.flow-meta.xml << 'EOF'
   <?xml version="1.0" encoding="UTF-8"?>
   <Flow xmlns="http://soap.sforce.com/2006/04/metadata">
       <recordLookups>
           <name>Get_Account</name>
           <label>Get Account</label>
           <object>Account</object>
           <queriedFields>Name</queriedFields>
       </recordLookups>
   </Flow>
   EOF
   ```

## Usage

### Prerequisites

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
# Navigate to your Salesforce project root
cd my-sf-project

# Analyze flow using name (will look in force-app/main/default/flows/)
sf-flow-apex-converter MyFlow

# Analyze flow using absolute path
sf-flow-apex-converter /path/to/MyFlow.flow-meta.xml

# Analyze flow using relative path
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
sf-flow-apex-converter MyFlow
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
```

### Options

- `--target-org, -o`: (Required) Target org alias or username
- `--flow-input, -f`: Flow identifier (name, ID, or XML file path)
- `--input-type, -t`: Type of flow input (name|id|xml)
- `--output-dir, -d`: Output directory for generated classes
- `--class-prefix, -p`: Prefix for generated class names
- `--with-tests`: Generate test classes (default: true)
- `--analyze-only`: Only analyze flow without generating code
- `--bulk-threshold`: Record threshold for bulk operations
- `--subflow-strategy`: Strategy for handling subflows (inline|separate|smart)
- `--preserve-structure`: Preserve original flow structure in generated code

## Generated Code Features

1. **Bulk Processing Support**
   - Consolidates DML operations
   - Uses bulk collections
   - Handles governor limits

2. **SOQL Optimization**
   - Moves queries outside loops
   - Uses efficient relationship queries
   - Implements bulk data loading

3. **Best Practices**
   - Exception handling
   - Clear method organization
   - Descriptive comments
   - Proper variable naming

4. **Test Coverage**
   - Comprehensive test scenarios
   - Bulk testing patterns
   - Edge case handling

## Example

Original Flow:
```xml
<Flow>
    <recordUpdates>
        <name>UpdateAccount</name>
        <object>Account</object>
        <!-- ... -->
    </recordUpdates>
    <recordLookups>
        <name>GetContact</name>
        <object>Contact</object>
        <!-- ... -->
    </recordLookups>
</Flow>
```

Generated Apex:
```apex
public class MyFlowHandler {
    private List<Account> accountsToUpdate = new List<Account>();
    private Map<Id, Contact> contactMap = new Map<Id, Contact>();
    
    public void process(List<SObject> records) {
        // Bulk query contacts
        Set<Id> contactIds = new Set<Id>();
        for (SObject record : records) {
            contactIds.add((Id)record.get('ContactId'));
        }
        contactMap = new Map<Id, Contact>([SELECT Id, Name FROM Contact WHERE Id IN :contactIds]);
        
        // Process records
        for (SObject record : records) {
            processRecord(record);
        }
        
        // Bulk update
        if (!accountsToUpdate.isEmpty()) {
            update accountsToUpdate;
        }
    }
    // ...
}
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT

## Support

Report issues at [GitHub Issues](https://github.com/cclabs/sf-flow-apex-converter/issues)