import { SecurityContext } from './FlowAnalyzer.js';

export class TestClassGenerator {
  generateTestClass(
    className: string,
    securityContext: SecurityContext,
    apiVersion: string
  ): string {
    const testClassName = `${className}_Test`;
    
    const testMethods = [];
    const requiredObjects = Array.from(securityContext.requiredObjects);
    
    // Generate test data setup
    testMethods.push(this.generateTestDataSetup(requiredObjects));
    
    // Generate positive test cases
    testMethods.push(this.generatePositiveTest(className, securityContext));
    
    // Generate negative test cases for permissions
    if (securityContext.enforceObjectPermissions) {
      testMethods.push(this.generatePermissionTest(className, securityContext));
    }

    // Generate sharing test if needed
    if (securityContext.enforceSharingRules) {
      testMethods.push(this.generateSharingTest(className));
    }

    return `@isTest
private class ${testClassName} {
    @TestSetup
    static void setupTestData() {
        ${testMethods[0]}
    }
    
    ${testMethods.slice(1).join('\n\n    ')}
}`;
  }

  private generateTestDataSetup(objects: string[]): string {
    const setup = objects.map(obj => `
        // Create test data for ${obj}
        ${obj} testRecord = new ${obj}(
            // TODO: Add required fields
        );
        insert testRecord;`).join('\n');

    return setup;
  }

  private generatePositiveTest(className: string, context: SecurityContext): string {
    return `@isTest
    static void testPositiveScenario() {
        // Given
        System.runAs(new User(Id = UserInfo.getUserId())) {
            // When
            Test.startTest();
            ${className}.execute();
            Test.stopTest();

            // Then
            // TODO: Add assertions based on expected behavior
        }
    }`;
  }

  private generatePermissionTest(className: string, context: SecurityContext): string {
    const permissions = Array.from(context.requiredPermissions);
    
    return `@isTest
    static void testWithoutPermissions() {
        // Given
        Profile p = [SELECT Id FROM Profile WHERE Name='Standard User'];
        User testUser = new User(
            ProfileId = p.Id,
            // TODO: Add required user fields
        );
        
        System.runAs(testUser) {
            // When
            Test.startTest();
            try {
                ${className}.execute();
                System.assert(false, 'Should have thrown an exception');
            } catch (System.NoAccessException e) {
                // Then
                System.assert(e.getMessage().contains('insufficient access rights'));
            }
            Test.stopTest();
        }
    }`;
  }

  private generateSharingTest(className: string): string {
    return `@isTest
    static void testWithSharing() {
        // Given
        Profile p = [SELECT Id FROM Profile WHERE Name='Standard User'];
        User testUser = new User(
            ProfileId = p.Id,
            // TODO: Add required user fields
        );
        
        System.runAs(testUser) {
            // When
            Test.startTest();
            try {
                ${className}.execute();
                // Then
                // TODO: Add sharing-specific assertions
            } catch (System.NoAccessException e) {
                System.assert(false, 'Should not have thrown an exception: ' + e.getMessage());
            }
            Test.stopTest();
        }
    }`;
  }
}