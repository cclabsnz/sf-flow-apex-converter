# SF Flow Apex Converter Context

This file maintains context for Claude Code to assist with the SF Flow Apex Converter project.

## Project Overview
A CLI tool that converts Salesforce Flows into bulkified Apex classes, with built-in analysis for performance, security, and best practices.

## Key Features

### Flow Analysis

The tool performs comprehensive flow analysis including:

1. Loop Analysis
   - Detection of DML operations in loops
   - SOQL query usage within loops
   - Subflow calls inside loops
   - Nested element counting
   - Loop context tracking

2. Operation Detection
   - DML operations (Create, Update, Delete)
   - SOQL queries
   - Cross-object formula references
   - Record-triggered flow operations

3. Bulkification Analysis
   - Score calculation based on operation patterns
   - Specific recommendations for improvement
   - Loop-based penalty calculations
   - Subflow operation aggregation
- Comprehensive flow metadata analysis
- Detection of SOQL and DML operations
- Subflow and Apex action analysis
- Security context detection
- Element counting and complexity analysis

### Bulkification
- Automatic query consolidation
- DML operation batching
- Collection-based processing
- Governor limit protection
- Loop optimization

### Security
- System vs User mode detection
- Object and field permission checks
- Sharing rule enforcement
- Cross-object security handling
- Custom permission requirements

### Deployment
- Automatic test class generation
- Pre-deployment validation
- Org compatibility checks
- Security context validation
- Code coverage verification

## Commands

### Basic Analysis
```bash
sf-flow-apex-converter MyFlow --from-org
```

### Detailed Analysis
```bash
sf-flow-apex-converter MyFlow --from-org --verbose
```

### Deploy to Org
```bash
sf-flow-apex-converter MyFlow --from-org --deploy
```

### Validate Deployment
```bash
sf-flow-apex-converter MyFlow --from-org --test-only
```

### Target Specific Org
```bash
sf-flow-apex-converter MyFlow --from-org --deploy --target-org myOrg
```

## Validation Checks

### Pre-Generation
1. Flow metadata validation
2. Security context analysis
3. Object/field accessibility
4. API version compatibility
5. Sharing model compatibility

### Pre-Deployment
1. Code coverage requirements
2. Object permissions
3. Field-level security
4. Apex class naming
5. Org limits and constraints

## Best Practices

### Query Optimization
- Consolidate similar queries
- Avoid SOQL in loops
- Include necessary fields only
- Optimize filter conditions
- Use proper indexing

### DML Optimization
- Batch DML operations
- Use bulk patterns
- Handle partial success
- Avoid mixed DML
- Implement rollback

### Security Implementation
- Respect sharing rules
- Check object permissions
- Validate field access
- Handle custom permissions
- Implement with/without sharing

### Error Handling
- Bulk error collection
- Proper exception types
- Transaction management
- User feedback
- System logging

## Required Commands

### Run Tests
```bash
npm run test
```

### Build Project
```bash
npm run build
```

### Lint Code
```bash
npm run lint
```

### Start Development
```bash
npm run start
```

## Tool Dependencies
The tool requires the following to be installed and configured:
- Node.js >=14.20.0
- SF CLI
- Active Salesforce org connection

## Common Tasks

### Adding New Analysis
1. Extend FlowAnalyzer class
2. Add new metrics to ComprehensiveFlowAnalysis
3. Update bulkification score calculation
4. Add relevant tests
5. Update documentation

### Modifying Bulkification
1. Update BulkPatternGenerator
2. Modify operation consolidation logic
3. Update DML batching
4. Add new bulk patterns
5. Test with large datasets

### Security Updates
1. Modify SecurityContext interface
2. Update permission checks
3. Enhance sharing rule handling
4. Test with different profiles
5. Document security implications

### Deployment Changes
1. Update DeploymentManager
2. Modify test class generation
3. Update validation checks
4. Add new deployment options
5. Test in different org types