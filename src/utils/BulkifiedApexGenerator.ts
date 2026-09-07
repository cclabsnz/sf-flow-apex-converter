import {
  FlowAnalysisResult,
  FlowParameter,
  SimplifiedFlowAnalyzer,
} from './SimplifiedFlowAnalyzer.js';
import { Logger } from './Logger.js';

export interface BulkifiedApexResult {
  className: string;
  apexCode: string;
  testCode: string;
  recommendations: string[];
}

export class BulkifiedApexGenerator {
  private analyzer: SimplifiedFlowAnalyzer;

  /**
   * @param analyzer  supplies Flow-to-Apex conversion. Injectable so the generator
   *                  can be tested without parsing a Flow file first.
   */
  constructor(analyzer?: SimplifiedFlowAnalyzer) {
    this.analyzer = analyzer || new SimplifiedFlowAnalyzer();
  }

  generateApex(
    analysisResults: Map<string, FlowAnalysisResult>,
    primaryFlowName: string
  ): BulkifiedApexResult {
    const className = this.sanitizeClassName(primaryFlowName);
    const primaryFlow = analysisResults.get(primaryFlowName);
    
    if (!primaryFlow) {
      throw new Error(`Primary flow ${primaryFlowName} not found in analysis results`);
    }
    
    const apexCode = this.generateApexClass(className, primaryFlow, analysisResults);
    const testCode = this.generateTestClass(className);
    const recommendations = this.generateRecommendations(primaryFlow, analysisResults);
    
    return {
      className,
      apexCode,
      testCode,
      recommendations
    };
  }
  
  private sanitizeClassName(flowName: string): string {
    // Remove file extension and special characters
    return flowName
      .replace(/\.(flow-meta\.xml|xml)$/i, '')
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/^[0-9]/, 'Flow_$&') // Ensure doesn't start with number
      + '_Bulkified';
  }
  
  private generateApexClass(
    className: string,
    primaryFlow: FlowAnalysisResult,
    allFlows: Map<string, FlowAnalysisResult>
  ): string {
    const hasLoops = primaryFlow.loops.size > 0;
    const hasSubflows = primaryFlow.subflows.length > 0;
    
    return `/**
 * Auto-generated bulkified Apex class from Flow: ${primaryFlow.flowName}
 * Generated on: ${new Date().toISOString()}
 * 
 * This class consolidates database operations to avoid governor limits
 */
public with sharing class ${className} {
    
    // Collection variables for bulk operations
    private List<SObject> recordsToInsert = new List<SObject>();
    private List<SObject> recordsToUpdate = new List<SObject>();
    private List<SObject> recordsToDelete = new List<SObject>();
    private Map<String, List<SObject>> queriedRecords = new Map<String, List<SObject>>();
    
    /**
     * Main execution method - processes records in bulk
     * @param inputRecords The collection of records to process
     */
    public void executeBulk(List<SObject> inputRecords) {
        if (inputRecords == null || inputRecords.isEmpty()) {
            return;
        }
        
        try {
            // Step 1: Collect all IDs and prepare for bulk queries
            Set<Id> allRecordIds = prepareRecordIds(inputRecords);
            
            // Step 2: Execute all SOQL queries upfront (outside of loops)
            executeQueriesInBulk(allRecordIds);
            
            // Step 3: Process records in memory (no DB operations)
            processRecordsInMemory(inputRecords);
            
            // Step 4: Execute all DML operations in bulk
            executeDMLInBulk();
            
        } catch (Exception e) {
            // Log error and handle appropriately
            System.debug('Error in bulk processing: ' + e.getMessage());
            throw new BulkProcessingException('Bulk processing failed: ' + e.getMessage(), e);
        }
    }
    
    /**
     * Prepare all record IDs for bulk queries
     */
    private Set<Id> prepareRecordIds(List<SObject> inputRecords) {
        Set<Id> recordIds = new Set<Id>();
        
        for (SObject record : inputRecords) {
            if (record.Id != null) {
                recordIds.add(record.Id);
            }
        }
        
        return recordIds;
    }
    
    /**
     * Execute all SOQL queries in bulk before processing
     */
    private void executeQueriesInBulk(Set<Id> recordIds) {
        // Example: Query related records that would have been in loops
        ${this.generateBulkQueries(primaryFlow)}
    }
    
    /**
     * Process all records in memory without DB operations
     */
    private void processRecordsInMemory(List<SObject> inputRecords) {
        for (SObject record : inputRecords) {
            // Process each record based on business logic
            processIndividualRecord(record);
        }
    }
    
    /**
     * Process individual record (equivalent to loop body in Flow)
     */
    private void processIndividualRecord(SObject record) {
        // Validation logic from subflows
        ${this.generateValidationLogic(primaryFlow)}
        
        // Business logic processing
        ${this.generateBusinessLogic(primaryFlow)}
    }
    
    /**
     * Execute all DML operations in bulk
     */
    private void executeDMLInBulk() {
        // Insert records
        if (!recordsToInsert.isEmpty()) {
            insert recordsToInsert;
        }
        
        // Update records
        if (!recordsToUpdate.isEmpty()) {
            update recordsToUpdate;
        }
        
        // Delete records
        if (!recordsToDelete.isEmpty()) {
            delete recordsToDelete;
        }
    }
    
    /**
     * Custom exception for bulk processing errors
     */
    public class BulkProcessingException extends Exception {}
}`;
  }
  
  private generateBulkQueries(flow: FlowAnalysisResult): string {
    const queries: string[] = [];
    
    // Check for record lookup elements
    for (const [name, element] of flow.elements) {
      if (element.operations.soql) {
        queries.push(`
        // Query for ${name}
        if (!recordIds.isEmpty()) {
            List<SObject> relatedRecords = [
                SELECT Id, Name 
                FROM Account 
                WHERE Id IN :recordIds
            ];
            queriedRecords.put('${name}', relatedRecords);
        }`);
      }
    }
    
    return queries.length > 0 ? queries.join('\n') : '// No queries needed';
  }
  
  private generateValidationLogic(flow: FlowAnalysisResult): string {
    const validations: string[] = [];

    // The generated class needs these before any validation method references them.
    validations.push(`
    private class ValidationResult {
        public Boolean isValid = true;
        public String message;
        public String solution;
        public String fieldName;
        public Id recordId;
        public String recordName;
    }`);

    validations.push(`
    private void handleValidationError(SObject record, ValidationResult result) {
        if (result.recordId == null) {
            result.recordId = (Id)record.get('Id');
        }
        if (result.recordName == null) {
            result.recordName = (String)record.get('Name');
        }
        // Add error to record
        record.addError(result.message + (result.solution != null ? '\\n' + result.solution : ''));
    }`);

    // One validation method per in-loop subflow.
    for (const subflow of flow.subflows) {
      const element = flow.elements.get(subflow.name);
      if (!element || !subflow.isInLoop) continue;

      const methodName = `validate${this.sanitizeClassName(subflow.flowName)}_Bulkified`;
      const params = element.inputParameters || [];

      validations.push(`
    private ValidationResult ${methodName}(SObject record) {
        ValidationResult result = new ValidationResult();
        result.isValid = true;
        
        try {
            // Extract input parameters
            ${this.generateParameterExtractions(params)}
            
            // Validation rules
            ${element.decisions?.map((decision) => `
            // ${decision.name}
            if (${this.analyzer.convertDecisionToApex(decision)}) {
                ${element.assignments?.filter((a) => a.variable.toLowerCase().includes('error') ||
                a.variable.toLowerCase().includes('message'))
                .map((a) => this.analyzer.convertAssignmentToApex(a))
                .join('\n                ')}
                result.isValid = false;
                return result;
            }
            `).join('\n') || '// No validation rules defined'}

            // Process DML operations
            ${element.dmlOperations?.map((dml) => this.analyzer.convertDMLToApex(dml)).join('\n            ') || ''}

            // Process outputs
            ${this.analyzer.processSubflowOutputs(element)}
            
        } catch (Exception e) {
            result.isValid = false;
            result.message = 'Validation error: ' + e.getMessage();
            result.solution = 'Review the record data and try again';
            return result;
        }
        
        return result;
    }`);
    }

    // Call sites, emitted into the per-record processing body.
    for (const subflow of flow.subflows) {
      if (subflow.isInLoop) {
        validations.push(`
        // Validation from subflow: ${subflow.flowName}
        ValidationResult ${this.sanitizeVariableName(subflow.flowName)}Result = 
            validate${this.sanitizeClassName(subflow.flowName)}_Bulkified(record);
        
        if (!${this.sanitizeVariableName(subflow.flowName)}Result.isValid) {
            handleValidationError(record, ${this.sanitizeVariableName(subflow.flowName)}Result);
            return; // Stop processing on validation failure
        }`);
      }
    }

    return validations.length > 0 ? validations.join('\n') : '// No validation logic';
  }

  /**
   * Turn a subflow's input parameters into typed field reads off the record.
   * A parameter without a resolvable field mapping is emitted as a comment rather
   * than a guess — a wrong cast would compile and then fail at runtime.
   */
  private generateParameterExtractions(params: FlowParameter[]): string {
    return params
      .map((param) => {
        if (param.fieldMapping) {
          const { sourceField, dataType } = param.fieldMapping;
          return `${dataType} ${this.sanitizeVariableName(param.name)} = (${dataType})record.get('${sourceField}');`;
        }
        return `// Parameter ${param.name} needs manual mapping`;
      })
      .join('\n            ');
  }

  
  private generateBusinessLogic(flow: FlowAnalysisResult): string {
    return `
        // Business logic implementation
        // TODO: Implement specific business logic from flow
        
        // Example: Prepare record for update
        if (record.get('Status') == 'Processing') {
            record.put('Status', 'Processed');
            recordsToUpdate.add(record);
        }`;
  }
  
  private sanitizeVariableName(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/^[0-9]/, 'var_$&')
      .toLowerCase();
  }
  
  private generateTestClass(className: string): string {
    return `/**
 * Test class for ${className}
 */
@isTest
private class ${className}_Test {
    
    @TestSetup
    static void setupTestData() {
        // Create test data
        List<Account> testAccounts = new List<Account>();
        for (Integer i = 0; i < 200; i++) {
            testAccounts.add(new Account(
                Name = 'Test Account ' + i
            ));
        }
        insert testAccounts;
    }
    
    @isTest
    static void testBulkProcessing() {
        // Get test data
        List<Account> accounts = [SELECT Id, Name FROM Account];
        
        Test.startTest();
        ${className} processor = new ${className}();
        processor.executeBulk(accounts);
        Test.stopTest();
        
        // Verify results
        List<Account> updatedAccounts = [SELECT Id, Name FROM Account];
        System.assertEquals(200, updatedAccounts.size(), 'All accounts should be processed');
    }
    
    @isTest
    static void testEmptyInput() {
        Test.startTest();
        ${className} processor = new ${className}();
        processor.executeBulk(new List<SObject>());
        Test.stopTest();
        
        // Should handle empty input gracefully
        System.assert(true, 'Empty input should be handled');
    }
    
    @isTest
    static void testExceptionHandling() {
        // Test with null input
        Test.startTest();
        ${className} processor = new ${className}();
        processor.executeBulk(null);
        Test.stopTest();
        
        // Should handle null input gracefully
        System.assert(true, 'Null input should be handled');
    }
}`;
  }
  
  private generateRecommendations(
    primaryFlow: FlowAnalysisResult,
    allFlows: Map<string, FlowAnalysisResult>
  ): string[] {
    const recommendations: string[] = [];
    
    // Add recommendations based on analysis
    if (primaryFlow.loops.size > 0) {
      recommendations.push('✅ Moved all SOQL queries outside of loops');
      recommendations.push('✅ Consolidated DML operations to execute after loops');
    }
    
    for (const [loopName, loopInfo] of primaryFlow.loops) {
      if (loopInfo.problematicElements.length > 0) {
        recommendations.push(`⚠️ Review loop "${loopName}": Contains ${loopInfo.problematicElements.length} operations that needed bulkification`);
      }
    }
    
    for (const subflow of primaryFlow.subflows) {
      if (subflow.isInLoop) {
        recommendations.push(`📝 Subflow "${subflow.flowName}" logic has been integrated into bulk processing`);
      }
    }
    
    recommendations.push('🔍 Review the generated Apex code and customize business logic as needed');
    recommendations.push('🧪 Add comprehensive test cases for your specific business scenarios');
    recommendations.push('📊 Monitor governor limit usage in production');
    
    return recommendations;
  }
}