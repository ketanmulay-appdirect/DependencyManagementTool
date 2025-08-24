import { logger } from '../../utils/logger';
import * as semver from 'semver';

export interface NpmDependency {
  name: string;
  version: string;
  type: 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies';
  isRange: boolean;
  originalVersion: string;
}

export interface NpmFileModification {
  filePath: string;
  dependencies: NpmDependency[];
  packageJson: any;
  modifications: Array<{
    type: 'dependency' | 'override';
    section: string;
    dependencyName: string;
    oldVersion: string;
    newVersion: string;
    comment: string;
    cveId?: string;
  }>;
}

export class NpmFileParser {
  
  /**
   * Parse a package.json file and extract dependencies
   */
  async parseFile(filePath: string, content: string): Promise<NpmFileModification> {
    logger.info(`🔍 Parsing npm package.json file: ${filePath}`);
    
    try {
      const packageJson = JSON.parse(content);
      const dependencies: NpmDependency[] = [];
      const modifications: NpmFileModification['modifications'] = [];

      // Extract dependencies from different sections
      const dependencySections = [
        'dependencies',
        'devDependencies', 
        'peerDependencies',
        'optionalDependencies'
      ];

      dependencySections.forEach(section => {
        if (packageJson[section]) {
          Object.entries(packageJson[section]).forEach(([name, version]) => {
            dependencies.push({
              name,
              version: this.resolveVersion(version as string),
              type: section as any,
              isRange: this.isVersionRange(version as string),
              originalVersion: version as string
            });
          });
        }
      });

      logger.info(`📦 Found ${dependencies.length} dependencies in ${filePath}`);

      return {
        filePath,
        dependencies,
        packageJson,
        modifications
      };
    } catch (error) {
      logger.error(`❌ Failed to parse package.json file ${filePath}:`, error);
      throw new Error(`Invalid package.json file: ${error}`);
    }
  }

  /**
   * Resolve version range to actual version (remove ^, ~, etc.)
   */
  private resolveVersion(versionString: string): string {
    // Handle common npm version prefixes
    if (versionString.startsWith('^') || versionString.startsWith('~') || versionString.startsWith('>=')) {
      return versionString.substring(1);
    }
    if (versionString.startsWith('>=')) {
      return versionString.substring(2);
    }
    return versionString;
  }

  /**
   * Check if version string is a range (has ^, ~, etc.)
   */
  private isVersionRange(versionString: string): boolean {
    return /^[\^~>=<]/.test(versionString) || versionString.includes(' - ') || versionString.includes('||');
  }

  /**
   * Update a dependency version in package.json
   */
  updateDependencyVersion(
    modification: NpmFileModification,
    dependencyName: string,
    currentVersion: string,
    newVersion: string,
    cveId: string,
    reason: string
  ): boolean {
    logger.info(`🔄 Updating ${dependencyName} from ${currentVersion} to ${newVersion} for ${cveId}`);

    // Find the dependency to update
    const dependency = modification.dependencies.find(dep => dep.name === dependencyName);

    if (!dependency) {
      logger.warn(`❌ Dependency ${dependencyName} not found in package.json`);
      return false;
    }

    // Preserve version range prefix if it exists
    let newVersionString = newVersion;
    if (dependency.isRange && dependency.originalVersion.startsWith('^')) {
      newVersionString = `^${newVersion}`;
    } else if (dependency.isRange && dependency.originalVersion.startsWith('~')) {
      newVersionString = `~${newVersion}`;
    }

    // Update in packageJson object
    if (modification.packageJson[dependency.type] && 
        modification.packageJson[dependency.type][dependencyName]) {
      modification.packageJson[dependency.type][dependencyName] = newVersionString;
    }

    modification.modifications.push({
      type: 'dependency',
      section: dependency.type,
      dependencyName,
      oldVersion: dependency.originalVersion,
      newVersion: newVersionString,
      comment: `${cveId}: ${reason}`,
      cveId
    });

    logger.info(`✅ Updated ${dependencyName} in ${dependency.type}: ${dependency.originalVersion} → ${newVersionString}`);
    return true;
  }

  /**
   * Add npm override for transitive dependency (npm 8+)
   */
  addNpmOverride(
    modification: NpmFileModification,
    dependencyName: string,
    version: string,
    cveId: string,
    reason: string
  ): boolean {
    logger.info(`🎯 Adding npm override for ${dependencyName}:${version} (${cveId})`);

    // Ensure overrides section exists
    if (!modification.packageJson.overrides) {
      modification.packageJson.overrides = {};
    }

    // Add override
    modification.packageJson.overrides[dependencyName] = version;

    modification.modifications.push({
      type: 'override',
      section: 'overrides',
      dependencyName,
      oldVersion: '',
      newVersion: version,
      comment: `${cveId}: ${reason}`,
      cveId
    });

    logger.info(`✅ Added npm override for ${dependencyName}: ${version}`);
    return true;
  }

  /**
   * Add resolution for Yarn workspaces
   */
  addYarnResolution(
    modification: NpmFileModification,
    dependencyName: string,
    version: string,
    cveId: string,
    reason: string
  ): boolean {
    logger.info(`🎯 Adding Yarn resolution for ${dependencyName}:${version} (${cveId})`);

    // Ensure resolutions section exists
    if (!modification.packageJson.resolutions) {
      modification.packageJson.resolutions = {};
    }

    // Add resolution (various patterns for Yarn)
    const resolutionKeys = [
      dependencyName, // Direct resolution
      `**/${dependencyName}`, // Global resolution
      `*/${dependencyName}` // One level deep
    ];

    // Use the most specific resolution pattern
    modification.packageJson.resolutions[`**/${dependencyName}`] = version;

    modification.modifications.push({
      type: 'override',
      section: 'resolutions',
      dependencyName,
      oldVersion: '',
      newVersion: version,
      comment: `${cveId}: ${reason}`,
      cveId
    });

    logger.info(`✅ Added Yarn resolution for ${dependencyName}: ${version}`);
    return true;
  }

  /**
   * Check if version satisfies minimum security version
   */
  satisfiesSecurityVersion(currentVersion: string, securityVersion: string): boolean {
    try {
      // Clean versions for comparison
      const cleanCurrent = semver.clean(currentVersion) || currentVersion;
      const cleanSecurity = semver.clean(securityVersion) || securityVersion;
      
      return semver.gte(cleanCurrent, cleanSecurity);
    } catch (error) {
      logger.warn(`❌ Could not compare versions ${currentVersion} vs ${securityVersion}:`, error);
      return false;
    }
  }

  /**
   * Get the final modified content as formatted JSON
   */
  getModifiedContent(modification: NpmFileModification): string {
    // Add comments for changes (JSON doesn't support comments, so we'll add them to package description)
    const originalDescription = modification.packageJson.description || '';
    const changeComments = modification.modifications.map(mod => 
      `${mod.comment}`
    ).join(', ');

    if (changeComments && !originalDescription.includes('Security updates:')) {
      modification.packageJson.description = originalDescription + 
        (originalDescription ? ' ' : '') + 
        `(Security updates: ${changeComments})`;
    }

    return JSON.stringify(modification.packageJson, null, 2);
  }

  /**
   * Get summary of changes made
   */
  getChangesSummary(modification: NpmFileModification): string {
    const summary = modification.modifications.map(mod => {
      switch (mod.type) {
        case 'dependency':
          return `• Updated ${mod.dependencyName} in ${mod.section}: ${mod.oldVersion} → ${mod.newVersion}`;
        case 'override':
          return `• Added ${mod.section} for ${mod.dependencyName}: ${mod.newVersion}`;
        default:
          return `• Modified ${mod.dependencyName}: ${mod.oldVersion} → ${mod.newVersion}`;
      }
    }).join('\n');

    return `Changes made to ${modification.filePath}:\n${summary}`;
  }

  /**
   * Validate package.json after modifications
   */
  validate(modification: NpmFileModification): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    try {
      // Check if JSON is valid
      JSON.parse(JSON.stringify(modification.packageJson));
      
      // Check required fields
      if (!modification.packageJson.name) {
        errors.push('Missing required field: name');
      }
      
      if (!modification.packageJson.version) {
        errors.push('Missing required field: version');
      }

      // Validate version formats in dependencies
      const dependencySections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
      
      dependencySections.forEach(section => {
        if (modification.packageJson[section]) {
          Object.entries(modification.packageJson[section]).forEach(([name, version]) => {
            if (typeof version !== 'string') {
              errors.push(`Invalid version type for ${name} in ${section}: expected string, got ${typeof version}`);
            }
          });
        }
      });

    } catch (error) {
      errors.push(`Invalid JSON structure: ${error}`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get npm install command for updated dependencies
   */
  getNpmInstallCommand(modification: NpmFileModification): string {
    const regularDeps = modification.modifications
      .filter(mod => mod.type === 'dependency' && mod.section === 'dependencies')
      .map(mod => `${mod.dependencyName}@${mod.newVersion}`);
    
    const devDeps = modification.modifications
      .filter(mod => mod.type === 'dependency' && mod.section === 'devDependencies')
      .map(mod => `${mod.dependencyName}@${mod.newVersion}`);

    const commands: string[] = [];
    
    if (regularDeps.length > 0) {
      commands.push(`npm install ${regularDeps.join(' ')}`);
    }
    
    if (devDeps.length > 0) {
      commands.push(`npm install --save-dev ${devDeps.join(' ')}`);
    }

    // If overrides were added, just run npm install to apply them
    const hasOverrides = modification.modifications.some(mod => mod.type === 'override');
    if (hasOverrides && commands.length === 0) {
      commands.push('npm install');
    }

    return commands.join(' && ');
  }
} 