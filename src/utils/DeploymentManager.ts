import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Logger } from './Logger.js';

export interface DeploymentResult {
  success: boolean;
  errors: string[];
  testResults?: {
    outcome: string;
    message: string;
    stackTrace?: string;
    coverage?: number;
  }[];
}

export class DeploymentManager {
  constructor() {}

  async deployApexClass(
    className: string,
    classContent: string,
    testClassName: string,
    testClassContent: string,
    targetOrg?: string
  ): Promise<DeploymentResult> {
    try {
      Logger.info('DeploymentManager', `Starting deployment of ${className}`);

      // Create temporary directory for deployment
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-deployment-'));
      const classesDir = path.join(tempDir, 'force-app', 'main', 'default', 'classes');
      fs.mkdirSync(classesDir, { recursive: true });

      // Write Apex class files
      fs.writeFileSync(path.join(classesDir, `${className}.cls`), classContent);
      fs.writeFileSync(path.join(classesDir, `${className}.cls-meta.xml`), this.generateMetaXml());
      fs.writeFileSync(path.join(classesDir, `${testClassName}.cls`), testClassContent);
      fs.writeFileSync(path.join(classesDir, `${testClassName}.cls-meta.xml`), this.generateMetaXml());

      // Create package.xml
      const manifestPath = path.join(tempDir, 'package.xml');
      const packageXml = this.generatePackageXml(className, testClassName);
      fs.writeFileSync(manifestPath, packageXml);

      // Validate deployment first
      Logger.info('DeploymentManager', 'Validating deployment');
      let validateCmd = `sf project deploy validate -x "${manifestPath}" --test-level RunSpecifiedTests --tests ${testClassName}`;
      if (targetOrg) {
        validateCmd += ` -o ${targetOrg}`;
      }
      
      try {
        execSync(validateCmd, { stdio: 'inherit' });
      } catch (error) {
        const errorMessage = (error as Error).message;
        return {
          success: false,
          errors: errorMessage.split('\n')
        };
      }

      // Deploy if validation succeeds
      Logger.info('DeploymentManager', 'Deploying Apex classes');
      let deployCmd = `sf project deploy start -x "${manifestPath}" --test-level RunSpecifiedTests --tests ${testClassName}`;
      if (targetOrg) {
        deployCmd += ` -o ${targetOrg}`;
      }

      execSync(deployCmd, { stdio: 'inherit' });

      // Clean up
      fs.rmSync(tempDir, { recursive: true, force: true });

      return {
        success: true,
        errors: []
      };

    } catch (error) {
      Logger.error('DeploymentManager', 'Deployment failed', error);
      const errorMessage = (error as Error).message;
      return {
        success: false,
        errors: errorMessage.split('\n')
      };
    }
  }

  private generateMetaXml(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>58.0</apiVersion>
    <status>Active</status>
</ApexClass>`;
  }

  private generatePackageXml(className: string, testClassName: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types>
        <members>${className}</members>
        <members>${testClassName}</members>
        <name>ApexClass</name>
    </types>
    <version>58.0</version>
</Package>`;
  }
}