# Salesforce Flow to Apex Bulkification Tool

A powerful CLI tool that analyzes Salesforce Flows for governor limit issues and automatically converts them into bulkified Apex classes. This tool helps prevent hitting Salesforce governor limits by identifying and fixing common anti-patterns like SOQL queries and DML operations inside loops.

## 🎯 Problem This Solves

Salesforce Flows can easily hit governor limits when:
- SOQL queries are executed inside loops (100 SOQL limit)
- DML operations are performed inside loops (150 DML limit)
- Subflows are called inside loops (multiplying the above issues)

This tool automatically:
1. **Analyzes** your Flow to find these issues
2. **Generates** bulkified Apex code that moves operations outside loops
3. **Creates** test classes for the generated code
4. **Provides** clear recommendations for optimization

## 📦 Installation

```bash
# Clone the repository
git clone https://github.com/your-username/sf-flow-apex-converter.git
cd sf-flow-apex-converter

# Install dependencies
npm install

# Build the project
npm run build
```

## 🚀 Quick Start

### 1. Analyze a Flow

First, analyze your Flow to identify bulkification issues:

```bash
npm run analyze path/to/your-flow.flow-meta.xml
```

Example:
```bash
npm run analyze exampleflow.xml
```

Output:
```
📋 Flow: YourFlow
   Elements: 20
   Loops: 1
   Subflows: 4
   Issues: 3

⚠️  BULKIFICATION REQUIRED
   - SOQL query "Get_Records" inside loop "Loop_over_Items"
   - DML operation "Update_Records" inside loop "Loop_over_Items"
   - Subflow "Validation_Subflow" inside loop "Loop_over_Items"
```

### 2. Generate Bulkified Apex

Convert your Flow to optimized Apex code:

```bash
npm run bulkify path/to/your-flow.flow-meta.xml
```

This generates:
- `generated-apex/YourFlow_Bulkified.cls` - The bulkified Apex class
- `generated-apex/YourFlow_Bulkified_Test.cls` - Test class
- `generated-apex/analysis-report.json` - Detailed analysis report

### 3. Deploy to Salesforce

Deploy the generated code to your org:

```bash
sf deploy metadata -d generated-apex --target-org your-org-alias
```

## 📁 Project Structure

```
sf-flow-apex-converter/
├── src/
│   ├── utils/
│   │   ├── SimplifiedFlowAnalyzer.ts    # Core flow analysis engine
│   │   ├── BulkifiedApexGenerator.ts    # Apex code generator
│   │   ├── Logger.ts                    # Logging utility
│   │   └── ...                          # Other utilities
│   ├── analyze-flow.ts                  # Analysis CLI command
│   ├── flow-bulkifier-cli.ts           # Bulkification CLI command
│   └── index.ts                         # Main entry point
├── generated-apex/                      # Generated Apex output (created on run)
├── exampleflow.xml                      # Example flow for testing
├── package.json                         # Project configuration
└── README.md                           # This file
```

## 🔍 How It Works

### Flow Analysis Process

1. **XML Parsing**: The tool parses your Flow's XML structure
2. **Element Identification**: Identifies all elements (queries, DML, loops, subflows)
3. **Loop Detection**: Finds loops and tracks which elements execute inside them
4. **Issue Detection**: Identifies operations that will cause governor limit issues
5. **Subflow Analysis**: Recursively analyzes referenced subflows

### Bulkification Strategy

The generated Apex code follows these patterns:

```apex
// ❌ BEFORE (Flow with operations in loop)
for (Account acc : accounts) {
    Contact c = [SELECT Id FROM Contact WHERE AccountId = :acc.Id];  // SOQL in loop!
    c.Status = 'Updated';
    update c;  // DML in loop!
}

// ✅ AFTER (Bulkified Apex)
// Step 1: Collect all IDs
Set<Id> accountIds = new Set<Id>();
for (Account acc : accounts) {
    accountIds.add(acc.Id);
}

// Step 2: Query once for all records
Map<Id, Contact> contactMap = new Map<Id, Contact>(
    [SELECT Id, AccountId FROM Contact WHERE AccountId IN :accountIds]
);

// Step 3: Process in memory
List<Contact> contactsToUpdate = new List<Contact>();
for (Account acc : accounts) {
    Contact c = contactMap.get(acc.Id);
    if (c != null) {
        c.Status = 'Updated';
        contactsToUpdate.add(c);
    }
}

// Step 4: Single DML operation
update contactsToUpdate;
```

## 🛠️ CLI Commands

### Analyze Command
```bash
npm run analyze <flow-file> [options]

Options:
  -v, --verbose    Show detailed analysis
  -o, --output     Output directory for report
```

### Bulkify Command
```bash
npm run bulkify <flow-file> [options]

Options:
  -o, --output <dir>    Output directory for generated Apex (default: ./generated-apex)
  -v, --verbose         Show detailed analysis
  --no-test            Skip test class generation
```

## 📊 Understanding the Analysis Report

The tool generates a detailed `analysis-report.json`:

```json
{
  "flowName": "YourFlow",
  "issues": [
    "SOQL query 'Get_Account' inside loop 'Process_Items'",
    "DML operation 'Update_Contact' inside loop 'Process_Items'"
  ],
  "recommendations": [
    "✅ Moved all SOQL queries outside of loops",
    "✅ Consolidated DML operations after loops",
    "📝 Review generated code and customize business logic"
  ],
  "loops": [{
    "name": "Process_Items",
    "elementsInLoop": ["Get_Account", "Update_Contact"],
    "problematicElements": [{
      "element": "Get_Account",
      "type": "SOQL",
      "issue": "Will hit 100 SOQL query limit"
    }]
  }]
}
```

## 🧪 Testing

Run the test suite:
```bash
npm test
```

Test with the example flow:
```bash
npm run analyze exampleflow.xml
npm run bulkify exampleflow.xml
```

## ⚠️ Limitations & Considerations

1. **Complex Logic**: The tool handles standard patterns. Complex business logic may need manual adjustment
2. **Subflow Files**: Subflows must be in the same directory as the main flow for deep analysis
3. **Custom Apex**: Existing Apex actions are flagged but require manual review
4. **Permissions**: Generated Apex uses `with sharing` by default

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Workflow

1. Make your changes
2. Run tests: `npm test`
3. Run linter: `npm run lint`
4. Build: `npm run build`
5. Test with example: `npm run analyze exampleflow.xml`

## 📝 Example Flow

The repository includes `exampleflow.xml` which demonstrates common patterns:
- A loop over records (`Loop_over_Loans`)
- Multiple validation subflows called inside the loop
- Collection filtering operations
- Complex decision trees

This example flow would hit governor limits in production but the generated Apex handles it safely.

## 🐛 Troubleshooting

### "Flow file not found"
Ensure you're providing the correct path to your `.flow-meta.xml` file

### "No issues found"
Your flow is already optimized! No bulkification needed.

### Type errors during build
Run `npm install` to ensure all dependencies are installed

### Generated Apex doesn't compile
Review the generated code and customize for your specific business logic

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details

## 🆘 Support

For issues, questions, or contributions:
- Open an issue on [GitHub](https://github.com/your-username/sf-flow-apex-converter/issues)
- Check existing issues for solutions
- Contribute improvements via pull requests

## 🎯 Roadmap

- [ ] Support for Platform Events in Flows
- [ ] Handle Record-Triggered Flows
- [ ] Visual Studio Code extension
- [ ] Web-based UI for analysis
- [ ] Support for Flow Orchestrator
- [ ] Advanced pattern detection

---

**Built with ❤️ to save Salesforce developers from governor limit nightmares**