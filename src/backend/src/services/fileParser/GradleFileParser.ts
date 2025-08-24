import { logger } from '../../utils/logger';
import { basename } from 'path';

export interface GradleDependency {
  group: string;
  name: string;
  version: string;
  configuration: string; // implementation, testImplementation, etc.
  lineNumber: number;
  isVariable: boolean;
  variableName?: string;
  originalLine: string;
}

export interface GradleVariable {
  name: string;
  value: string;
  lineNumber: number;
  originalLine: string;
}

export interface GradlePlugin {
  id: string;
  version: string;
  lineNumber: number;
  originalLine: string;
}

export interface GradleFileModification {
  filePath: string;
  dependencies: GradleDependency[];
  variables: GradleVariable[];
  plugins: GradlePlugin[];
  content: string;
  modifications: Array<{
    type: 'dependency' | 'variable' | 'constraint' | 'comment' | 'plugin';
    lineNumber: number;
    oldLine: string;
    newLine: string;
    comment: string;
    cveId?: string;
  }>;
}

export class GradleFileParser {
  // File-level tracking to prevent duplicate constraints across all operations
  private fileConstraintTracker: Map<string, Set<string>> = new Map(); // filePath -> Set of dependency names
  
  /**
   * Clear constraint tracker for a new analysis session
   */
  clearConstraintTracker(): void {
    this.fileConstraintTracker.clear();
    logger.info('🧹 Cleared constraint tracker for new analysis session');
  }
  
  /**
   * Parse a Gradle build file and extract dependencies and variables
   */
  async parseFile(filePath: string, content: string): Promise<GradleFileModification> {
    logger.info(`🔍 Parsing Gradle file: ${filePath}`);
    
    const dependencies: GradleDependency[] = [];
    const variables: GradleVariable[] = [];
    const plugins: GradlePlugin[] = [];
    const lines = content.split('\n');
    
    // Parse variables from ext block and standalone declarations
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Parse ext block variables
      if (line.includes('ext {') || line.includes('ext{')) {
        const extVars = this.parseVariable(lines, i);
        variables.push(...extVars.variables);
        i = extVars.endIndex;
      }
      
      // Parse standalone variable declarations
      const standaloneVar = this.parseStandaloneVariable(line);
      if (standaloneVar) {
        variables.push(standaloneVar);
      }
      
      // Parse plugin declarations
      const plugin = this.parsePlugin(line, i);
      if (plugin) {
        plugins.push(plugin);
        logger.info(`🔌 Found plugin: ${plugin.id}:${plugin.version}`);
      }
      
      // Parse dependency declarations
      const dependency = this.parseDependency(line, variables, i);
      if (dependency) {
        dependencies.push(dependency);
        logger.info(`📦 Found dependency: ${dependency.name}:${dependency.version} (config: ${dependency.configuration})`);
      }
    }
    
    logger.info(`📦 Found ${dependencies.length} dependencies, ${variables.length} variables, and ${plugins.length} plugins in ${filePath}`);
    logger.info(`📋 Dependencies in ${basename(filePath)}:`, dependencies.map(d => `${d.name}:${d.version}`));
    
    return {
      filePath,
      content,
      dependencies,
      variables,
      plugins,
      modifications: []
    };
  }

  /**
   * Parse a variable declaration in ext block
   */
  private parseVariable(lines: string[], startIndex: number): { variables: GradleVariable[], endIndex: number } {
    const variables: GradleVariable[] = [];
    let braceDepth = 0;
    let i = startIndex;

    for (; i < lines.length; i++) {
      const line = lines[i].trim();
      const trimmedLine = line.trim();

      if (trimmedLine.match(/^ext\s*\{/)) {
        braceDepth = 1;
        continue;
      }

      if (braceDepth > 0) {
        const openBraces = (line.match(/\{/g) || []).length;
        const closeBraces = (line.match(/\}/g) || []).length;
        braceDepth += openBraces - closeBraces;

        if (braceDepth <= 0) {
          break; // Exit the loop when the ext block ends
        }
      }

      // Match patterns like: springVersion = "5.3.21" or springVersion = '5.3.21'
      const match = trimmedLine.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*['"]([^'"]+)['"]/);
      if (match) {
        variables.push({
          name: match[1],
          value: match[2],
          lineNumber: i,
          originalLine: line
        });
      }
    }
    return { variables, endIndex: i };
  }

  /**
   * Parse standalone variable declaration (def or direct assignment)
   */
  private parseStandaloneVariable(line: string): GradleVariable | null {
    // Match patterns like: def springVersion = "5.3.21" or springVersion = "5.3.21"
    const match = line.match(/^\s*(?:def\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*['"]([^'"]+)['"]/);
    if (match) {
      return {
        name: match[1],
        value: match[2],
        lineNumber: 0, // Placeholder, will be updated later
        originalLine: line
      };
    }
    return null;
  }

  /**
   * Parse a plugin declaration line
   */
  private parsePlugin(line: string, lineNumber: number): GradlePlugin | null {
    // Match plugin patterns:
    // id "org.springframework.boot" version "3.1.1"
    // id 'org.springframework.boot' version '3.1.1'
    // id("org.springframework.boot") version("3.1.1")
    // id('org.springframework.boot') version('3.1.1')

    const trimmedLine = line.trim();
    
    // Skip comments and empty lines
    if (trimmedLine.startsWith('//') || trimmedLine === '') {
      return null;
    }

    // Pattern: id "org.springframework.boot" version "3.1.1"
    const pluginMatch = trimmedLine.match(/^id\s*\(?\s*['"]([^'"]+)['"]\s*\)?\s+version\s*\(?\s*['"]([^'"]+)['"]\s*\)?/);
    if (pluginMatch) {
      const [, id, version] = pluginMatch;
      return {
        id,
        version,
        lineNumber,
        originalLine: line
      };
    }

    return null;
  }

  /**
   * Parse a dependency declaration
   */
  private parseDependency(line: string, variables: GradleVariable[], lineNumber: number): GradleDependency | null {
    // Match various dependency patterns:
    // implementation 'group:name:version'
    // implementation "group:name:version"
    // implementation('group:name:version')  // With parentheses
    // implementation ('group:name:version') // With space and parentheses
    // implementation group: 'group', name: 'name', version: 'version'
    // implementation 'group:name:$variable'

    const trimmedLine = line.trim();
    
    // Skip comments and empty lines
    if (trimmedLine.startsWith('//') || trimmedLine === '') {
      return null;
    }

    // Pattern 1a: implementation 'group:name:version' or implementation('group:name:version')
    const shortFormMatch = trimmedLine.match(/^(implementation|testImplementation|api|compile|testCompile|runtimeOnly|compileOnly)\s*\(?\s*['"]([^:'"]+):([^:'"]+):([^'"]+)['"]\s*\)?/);
    if (shortFormMatch) {
      const [, configuration, group, name, versionPart] = shortFormMatch;
      
      // Check if version uses a variable
      const variableMatch = versionPart.match(/^\$\{?([a-zA-Z_][a-zA-Z0-9_]*)\}?$/);
      if (variableMatch) {
        const variableName = variableMatch[1];
        const variable = variables.find(v => v.name === variableName);
        const resolvedVersion = variable ? variable.value : versionPart;
        
        return {
          group,
          name,
          version: resolvedVersion,
          configuration,
          lineNumber,
          isVariable: true,
          variableName,
          originalLine: line
        };
      } else {
        return {
          group,
          name,
          version: versionPart,
          configuration,
          lineNumber,
          isVariable: false,
          originalLine: line
        };
      }
    }

    // Pattern 1b: implementation 'group:name' (no explicit version - relies on BOM/platform)
    const shortFormNoVersionMatch = trimmedLine.match(/^(implementation|testImplementation|api|compile|testCompile|runtimeOnly|compileOnly)\s*\(?\s*['"]([^:'"]+):([^:'"]+)['"]\s*\)?/);
    if (shortFormNoVersionMatch) {
      const [, configuration, group, name] = shortFormNoVersionMatch;
      
      return {
        group,
        name,
        version: 'BOM-managed', // Special marker for BOM-managed dependencies
        configuration,
        lineNumber,
        isVariable: false,
        originalLine: line
      };
    }

    // Pattern 2: implementation group: 'group', name: 'name', version: 'version'
    const longFormMatch = trimmedLine.match(/^(implementation|testImplementation|api|compile|testCompile|runtimeOnly|compileOnly)\s+group:\s*['"]([^'"]+)['"],?\s*name:\s*['"]([^'"]+)['"],?\s*version:\s*['"]([^'"]+)['"]/);
    if (longFormMatch) {
      const [, configuration, group, name, versionPart] = longFormMatch;
      
      // Check if version uses a variable
      const variableMatch = versionPart.match(/^\$\{?([a-zA-Z_][a-zA-Z0-9_]*)\}?$/);
      if (variableMatch) {
        const variableName = variableMatch[1];
        const variable = variables.find(v => v.name === variableName);
        const resolvedVersion = variable ? variable.value : versionPart;
        
        return {
          group,
          name,
          version: resolvedVersion,
          configuration,
          lineNumber,
          isVariable: true,
          variableName,
          originalLine: line
        };
      } else {
        return {
          group,
          name,
          version: versionPart,
          configuration,
          lineNumber,
          isVariable: false,
          originalLine: line
        };
      }
    }

    return null;
  }

  /**
   * Update a plugin version in the Gradle file
   */
  updatePluginVersion(
    modification: GradleFileModification,
    pluginId: string,
    currentVersion: string,
    newVersion: string,
    cveId: string,
    reason: string
  ): boolean {
    logger.info(`🔄 Updating plugin ${pluginId} from ${currentVersion} to ${newVersion} for ${cveId}`);

    // Find the plugin in the parsed plugins
    const plugin = modification.plugins.find(p => p.id === pluginId && p.version === currentVersion);
    if (!plugin) {
      logger.warn(`❌ Plugin ${pluginId}:${currentVersion} not found in Gradle file`);
      logger.warn(`📦 Available plugins:`, modification.plugins.map(p => `${p.id}:${p.version}`));
      return false;
    }

    logger.info(`✅ Found plugin match:`, { found: `${plugin.id}:${plugin.version}`, lineNumber: plugin.lineNumber, originalLine: plugin.originalLine, searched: pluginId });

    // Update the plugin version
    const lines = modification.content.split('\n');
    const line = lines[plugin.lineNumber];
    
    logger.info(`🔍 Attempting to update line: "${line}"`);

    // Replace the version in the line
    const updatedLine = line.replace(
      new RegExp(`version\\s*\\(?\\s*['"]([^'"]*)['"]\\s*\\)?`, 'g'),
      (match, version) => {
        if (version === currentVersion) {
          return match.replace(currentVersion, newVersion);
        }
        return match;
      }
    );

    if (updatedLine !== line) {
      logger.info(`✅ Updated plugin with preserved indentation: ${currentVersion} → ${newVersion}`);
      logger.info(`📝 Original: "${line}"`);
      logger.info(`📝 Updated:  "${updatedLine}"`);

      // Store the modification
      modification.modifications.push({
        type: 'plugin',
        lineNumber: plugin.lineNumber,
        oldLine: line,
        newLine: updatedLine,
        comment: reason,
        cveId: cveId
      });

      return true;
    }

    logger.warn(`❌ Failed to update plugin version in line: "${line}"`);
    return false;
  }

  /**
   * Update a variable version in the Gradle file
   */
  updateVariableVersion(
    modification: GradleFileModification,
    variableName: string,
    currentVersion: string,
    newVersion: string,
    cveId: string,
    reason: string
  ): boolean {
    logger.info(`🔄 Updating variable ${variableName} from ${currentVersion} to ${newVersion} for ${cveId}`);

    // Find the variable in the parsed variables
    const variable = modification.variables.find(v => v.name === variableName && v.value === currentVersion);
    if (!variable) {
      logger.warn(`❌ Variable ${variableName}:${currentVersion} not found in Gradle file`);
      logger.warn(`📦 Available variables:`, modification.variables.map(v => `${v.name}:${v.value}`));
      return false;
    }

    logger.info(`✅ Found variable match:`, { found: `${variable.name}:${variable.value}`, lineNumber: variable.lineNumber, originalLine: variable.originalLine, searched: variableName });

    // Update the variable version
    const lines = modification.content.split('\n');
    const line = lines[variable.lineNumber];
    
    logger.info(`🔍 Attempting to update line: "${line}"`);

    // Replace the version in the line
    const updatedLine = line.replace(
      new RegExp(`=\\s*['"]([^'"]*)['"]`, 'g'),
      (match, value) => {
        if (value === currentVersion) {
          return match.replace(currentVersion, newVersion);
        }
        return match;
      }
    );

    if (updatedLine !== line) {
      logger.info(`✅ Updated variable with preserved indentation: ${currentVersion} → ${newVersion}`);
      logger.info(`📝 Original: "${line}"`);
      logger.info(`📝 Updated:  "${updatedLine}"`);

      // Store the modification
      modification.modifications.push({
        type: 'variable',
        lineNumber: variable.lineNumber,
        oldLine: line,
        newLine: updatedLine,
        comment: reason,
        cveId: cveId
      });

      return true;
    }

    logger.warn(`❌ Failed to update variable version in line: "${line}"`);
    return false;
  }

  /**
   * Update a dependency version in the Gradle file
   */
  updateDependencyVersion(
    modification: GradleFileModification,
    dependencyName: string,
    currentVersion: string,
    newVersion: string,
    cveId: string,
    reason: string
  ): boolean {
    logger.info(`🔄 Updating ${dependencyName} from ${currentVersion} to ${newVersion} for ${cveId}`);

    // Find the dependency to update - try multiple matching strategies
    let dependency = modification.dependencies.find(dep => 
      dep.name === dependencyName || 
      `${dep.group}:${dep.name}` === dependencyName ||
      // Handle commons-io case specifically
      (dependencyName === 'commons-io:commons-io' && dep.group === 'commons-io' && dep.name === 'commons-io')
    );

    // If not found, try more flexible matching
    if (!dependency) {
      // Extract artifact name from group:artifact format
      const artifactName = dependencyName.includes(':') ? dependencyName.split(':').pop() : dependencyName;
      const groupName = dependencyName.includes(':') ? dependencyName.split(':')[0] : '';
      
      logger.info(`🔍 Trying flexible matching for ${dependencyName}:`, {
        artifactName,
        groupName,
        availableDependencies: modification.dependencies.slice(0, 5).map(dep => ({
          group: dep.group,
          name: dep.name,
          version: dep.version,
          fullName: `${dep.group}:${dep.name}`
        }))
      });

      // Try matching by exact group and artifact
      if (!dependency && groupName && artifactName) {
        dependency = modification.dependencies.find(dep => 
          dep.group === groupName && dep.name === artifactName
        );
      }
      
      // Try matching by artifact name only
      if (!dependency) {
        dependency = modification.dependencies.find(dep => dep.name === artifactName);
      }
      
      // Try case-insensitive matching
      if (!dependency) {
        dependency = modification.dependencies.find(dep => {
          const depFullName = `${dep.group}:${dep.name}`.toLowerCase();
          const targetFullName = dependencyName.toLowerCase();
          return depFullName === targetFullName || dep.name.toLowerCase() === artifactName?.toLowerCase();
        });
      }

      // Try matching with common variations (e.g., commons-io vs commons-io:commons-io)
      if (!dependency && dependencyName.includes('commons-io')) {
        dependency = modification.dependencies.find(dep => 
          dep.name.includes('commons-io') || dep.group.includes('commons-io') ||
          `${dep.group}:${dep.name}`.includes('commons-io')
        );
      }
    }

    if (!dependency) {
      logger.warn(`❌ Dependency ${dependencyName} not found in Gradle file`);
      logger.warn(`📦 Available dependencies:`, modification.dependencies.map(dep => `${dep.group}:${dep.name}:${dep.version}`));
      return false;
    }

    logger.info(`✅ Found dependency match:`, {
      searched: dependencyName,
      found: `${dependency.group}:${dependency.name}:${dependency.version}`,
      isVariable: dependency.isVariable,
      variableName: dependency.variableName,
      lineNumber: dependency.lineNumber,
      originalLine: dependency.originalLine
    });

    const lines = modification.content.split('\n');

    if (dependency.isVariable && dependency.variableName) {
      // Update the variable instead of the dependency line
      const variable = modification.variables.find(v => v.name === dependency.variableName);
      if (variable) {
        const newVariableLine = variable.originalLine.replace(
          new RegExp(`(['"])${escapeRegExp(currentVersion)}(['"])`),
          `$1${newVersion}$2`
        );

        // Only add comments if CVE ID is provided
        if (cveId && cveId.trim()) {
          const comment = `    // ${cveId}: ${reason}`;
          lines.splice(variable.lineNumber, 0, comment);
          lines[variable.lineNumber + 1] = newVariableLine;
        } else {
          lines[variable.lineNumber] = newVariableLine;
        }

        modification.modifications.push({
          type: 'variable',
          lineNumber: variable.lineNumber,
          oldLine: variable.originalLine,
          newLine: newVariableLine,
          comment: cveId && cveId.trim() ? `    // ${cveId}: ${reason}` : '',
          cveId
        });

        modification.content = lines.join('\n');
        logger.info(`✅ Updated variable ${dependency.variableName}: ${currentVersion} → ${newVersion}`);
        return true;
      }
    } else if (dependency.version === 'BOM-managed') {
      // Handle BOM-managed dependencies by adding explicit version
      logger.info(`🎯 Handling BOM-managed dependency: ${dependency.group}:${dependency.name}`);
      
      const originalLine = dependency.originalLine.trim();
      
      // Convert from BOM-managed to explicit version
      // From: implementation("com.fasterxml.jackson.core:jackson-databind")
      // To:   implementation("com.fasterxml.jackson.core:jackson-databind:2.15.4")
      
      const bomManagedPattern = new RegExp(`(implementation|testImplementation|api|compile|testCompile|runtimeOnly|compileOnly)\\s*\\(\\s*['"]([^:'"]+):([^'"]+)['"]\\s*\\)`);
      const match = originalLine.match(bomManagedPattern);
      
      if (match) {
        const [, configuration, group, name] = match;
        const newLine = dependency.originalLine.replace(
          bomManagedPattern,
          `$1("${group}:${name}:${newVersion}")`
        );
        
        lines[dependency.lineNumber] = newLine;
        
        // Add comment about the change
        if (cveId && cveId.trim()) {
          const comment = `        // ${cveId}: ${reason}`;
          lines.splice(dependency.lineNumber, 0, comment);
          // Update line number since we inserted a comment
          modification.modifications.push({
            type: 'dependency',
            lineNumber: dependency.lineNumber + 1,
            oldLine: dependency.originalLine,
            newLine: newLine,
            comment: comment,
            cveId
          });
        } else {
          modification.modifications.push({
            type: 'dependency',
            lineNumber: dependency.lineNumber,
            oldLine: dependency.originalLine,
            newLine: newLine,
            comment: reason,
            cveId
          });
        }
        
        modification.content = lines.join('\n');
        logger.info(`✅ Updated BOM-managed dependency to explicit version: ${dependency.group}:${dependency.name} → ${newVersion}`);
        return true;
      } else {
        logger.warn(`❌ Could not parse BOM-managed dependency pattern: ${originalLine}`);
        return false;
      }
    } else {
      // Update the dependency line directly
      
      // More specific regex patterns for commons-io
      const originalLine = dependency.originalLine.trim();
      let newDependencyLine = dependency.originalLine;
      let patternMatched = false;
      
      logger.info(`🔍 Attempting to update line: "${originalLine}"`);
      
      // Try exact replacement first - look for the specific version pattern
      const versionPattern = new RegExp(`(['"])([^:'"]+):([^:'"]+):${escapeRegExp(currentVersion)}(['"])`, 'g');
      if (versionPattern.test(originalLine)) {
        newDependencyLine = dependency.originalLine.replace(versionPattern, `$1$2:$3:${newVersion}$4`);
        patternMatched = true;
        logger.info(`✅ Used version pattern replacement`);
      }
      
      // If that didn't work, try more specific patterns
      if (!patternMatched) {
        // Pattern for commons-io specifically: 'commons-io:commons-io:2.8.0'
        const commonsIoPattern = new RegExp(`(['"])commons-io:commons-io:${escapeRegExp(currentVersion)}(['"])`, 'g');
        if (commonsIoPattern.test(originalLine)) {
          newDependencyLine = dependency.originalLine.replace(commonsIoPattern, `$1commons-io:commons-io:${newVersion}$2`);
          patternMatched = true;
          logger.info(`✅ Used commons-io specific pattern`);
        }
      }
      
      // Fallback: try to replace just the version number (most permissive)
      if (!patternMatched) {
        const versionOnlyPattern = new RegExp(`(['"])${escapeRegExp(currentVersion)}(['"])`, 'g');
        if (versionOnlyPattern.test(originalLine)) {
          newDependencyLine = dependency.originalLine.replace(versionOnlyPattern, `$1${newVersion}$2`);
          patternMatched = true;
          logger.info(`✅ Used fallback version-only pattern`);
        }
      }

      if (patternMatched) {
        // Enhanced indentation preservation
        const originalIndentation = dependency.originalLine.match(/^(\s*)/)?.[1] || '';
        
        // Extract just the content part (without original indentation) from newDependencyLine
        let newLineContent = newDependencyLine.replace(/^\s*/, '');
        
        // Ensure we don't accidentally add extra quotes or modify the structure
        if (!newLineContent.endsWith('\n')) {
          newLineContent = newLineContent.trimEnd();
        }
        
        // Use the exact original indentation to maintain file consistency
        const properlyIndentedLine = originalIndentation + newLineContent;
        
        // Validate that we haven't broken the line structure
        if (originalIndentation.length > 0 && !properlyIndentedLine.startsWith(originalIndentation)) {
          logger.warn(`⚠️ Indentation mismatch detected, using fallback approach`);
          // Fallback: just replace the version in the original line
          const fallbackLine = dependency.originalLine.replace(
            new RegExp(`(['"])${escapeRegExp(currentVersion)}(['"])`, 'g'),
            `$1${newVersion}$2`
          );
          lines[dependency.lineNumber] = fallbackLine;
          
          modification.modifications.push({
            type: 'dependency',
            lineNumber: dependency.lineNumber,
            oldLine: dependency.originalLine,
            newLine: fallbackLine,
            comment: reason,
            cveId: cveId
          });
          
          modification.content = lines.join('\n');
          logger.info(`✅ Updated dependency with fallback: ${currentVersion} → ${newVersion}`);
          return true;
        }
        
        lines[dependency.lineNumber] = properlyIndentedLine;

        modification.modifications.push({
          type: 'dependency',
          lineNumber: dependency.lineNumber,
          oldLine: dependency.originalLine,
          newLine: properlyIndentedLine,
          comment: reason,
          cveId: cveId
        });

        modification.content = lines.join('\n');
        logger.info(`✅ Updated dependency with preserved indentation: ${currentVersion} → ${newVersion}`);
        logger.info(`📝 Original: "${dependency.originalLine}"`);
        logger.info(`📝 Updated:  "${properlyIndentedLine}"`);
        logger.info(`📏 Indentation preserved: "${originalIndentation}" (${originalIndentation.length} chars)`);
        
        // Additional validation
        const originalSpaces = (dependency.originalLine.match(/^\s*/) || [''])[0];
        const updatedSpaces = (properlyIndentedLine.match(/^\s*/) || [''])[0];
        if (originalSpaces !== updatedSpaces) {
          logger.warn(`⚠️ Indentation changed from "${originalSpaces}" to "${updatedSpaces}"`);
        }
        
        return true;
      } else {
        logger.error(`❌ Could not find pattern to update dependency line: ${dependency.originalLine}`);
        logger.error(`❌ Tried to replace version: ${currentVersion} with: ${newVersion}`);
        return false;
      }
    }

    return false;
  }

  /**
   * Add dependency constraint for transitive dependency override
   */
  addDependencyConstraint(
    modification: GradleFileModification,
    dependencyName: string,
    version: string,
    cveId: string,
    reason: string
  ): boolean {
    logger.info(`🎯 Adding dependency constraint for ${dependencyName}:${version} (${cveId})`);

    const lines = modification.content.split('\n');
    
    // Check if this is a buildscript dependencies block - constraints are not supported there
    let isInsideBuildscript = false;
    let buildscriptStartIndex = -1;
    let buildscriptEndIndex = -1;
    
    // Find buildscript blocks first
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.match(/^buildscript\s*\{/)) {
        buildscriptStartIndex = i;
        let buildscriptBraceDepth = 1;
        
        for (let j = i + 1; j < lines.length; j++) {
          const buildscriptLine = lines[j].trim();
          const openBraces = (buildscriptLine.match(/\{/g) || []).length;
          const closeBraces = (buildscriptLine.match(/\}/g) || []).length;
          buildscriptBraceDepth += openBraces - closeBraces;
          
          if (buildscriptBraceDepth <= 0) {
            buildscriptEndIndex = j;
            break;
          }
        }
        break;
      }
    }
    
    // Find the dependencies block end
    let dependenciesEndIndex = -1;
    let braceDepth = 0;
    let inDependenciesBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.match(/^dependencies\s*\{/)) {
        // Check if this dependencies block is inside buildscript
        if (buildscriptStartIndex !== -1 && i > buildscriptStartIndex && i < buildscriptEndIndex) {
          isInsideBuildscript = true;
          logger.info(`🚫 Found dependencies block inside buildscript block - constraints not supported`);
        }
        
        inDependenciesBlock = true;
        braceDepth = 1;
        continue;
      }

      if (inDependenciesBlock) {
        const openBraces = (line.match(/\{/g) || []).length;
        const closeBraces = (line.match(/\}/g) || []).length;
        braceDepth += openBraces - closeBraces;

        if (braceDepth <= 0) {
          dependenciesEndIndex = i;
          break;
        }
      }
    }

    if (dependenciesEndIndex === -1) {
      logger.error(`❌ Could not find dependencies block end in Gradle file`);
      return false;
    }
    
    // If this is a buildscript dependencies block, don't add constraints
    if (isInsideBuildscript) {
      logger.warn(`⚠️ Skipping constraint addition for ${dependencyName} - buildscript dependencies blocks do not support constraints`);
      logger.info(`💡 Suggestion: Consider adding this constraint to the main project dependencies block instead`);
      return false;
    }
    
    // Check for known problematic dependencies that should be skipped
    if (this.shouldSkipDependencyConstraint(dependencyName, version)) {
      logger.warn(`⚠️ Skipping constraint addition for ${dependencyName}:${version} - dependency is deprecated or version doesn't exist`);
      return false;
    }

    // Check if constraints block already exists and if this constraint already exists
    let constraintsBlockExists = false;
    let constraintsEndIndex = -1;
    let constraintAlreadyExists = false;
    let firstConstraintsBlockStart = -1;
    
    // File-level constraint tracking - check if we've already added a constraint for this dependency
    const filePath = modification.filePath;
    if (!this.fileConstraintTracker.has(filePath)) {
      this.fileConstraintTracker.set(filePath, new Set());
    }
    const fileConstraints = this.fileConstraintTracker.get(filePath)!;
    
    if (fileConstraints.has(dependencyName)) {
      logger.info(`⏭️ File-level constraint tracking: ${dependencyName} already processed for ${filePath}`);
      return true; // Already added constraint for this dependency in this session
    }

    // Check ALL content for any existing constraint for this dependency (any version)
    const existingConstraintPattern = new RegExp(`implementation\\(['"]${dependencyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`);
    for (let i = 0; i < lines.length; i++) {
      if (existingConstraintPattern.test(lines[i])) {
        constraintAlreadyExists = true;
        logger.info(`⏭️ Constraint for ${dependencyName} already exists on line ${i + 1}: ${lines[i].trim()}`);
        // Mark as processed so we don't try again
        fileConstraints.add(dependencyName);
        return true; // Don't add duplicate constraints for same dependency
      }
    }
    
    // Detect proper indentation levels by analyzing the dependencies block specifically
    const dependenciesIndentation = this.detectDependenciesBlockIndentation(lines);
    const constraintIndentation = this.detectConstraintIndentation(modification.content, dependenciesIndentation);
    
    logger.info(`📏 Using indentation: dependencies="${dependenciesIndentation}", constraint="${constraintIndentation}"`);

    // Format comment lines only if reason is provided, using dependencies block indentation
    const commentLines = reason ? [
      `${dependenciesIndentation}// ${cveId}: ${reason.split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0]}`,
      ...reason.split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(1).map(l => `${dependenciesIndentation}// ${l}`)
    ] : [];
    
    // Check if a constraints block was already added via modifications
    const existingConstraintMod = modification.modifications.find(mod => 
      mod.type === 'constraint' && mod.newLine && mod.newLine.includes('constraints {')
    );
    
    if (existingConstraintMod) {
      // A constraints block was already added in a previous call, add to it
      constraintsBlockExists = true;
      // Find the line where we should add the new constraint (before the closing brace)
      const constraintBlockLines = existingConstraintMod.newLine.split('\n');
      const insertIndex = constraintBlockLines.length - 1; // Before the closing }
      
      logger.info(`🔍 Found existing constraint block in modifications, adding to it`);
      
      // Insert the new constraint before the closing brace
      const constraintLine = `${constraintIndentation}implementation('${dependencyName}:${version}')`;
      const linesToAdd = reason ? ['', ...commentLines, constraintLine] : ['', constraintLine];
      
      // Update the existing modification
      const newConstraintLines = [...constraintBlockLines];
      newConstraintLines.splice(insertIndex, 0, ...linesToAdd);
      existingConstraintMod.newLine = newConstraintLines.join('\n');
      
      // Add CVE comment to existing modification
      if (reason) {
        existingConstraintMod.comment += '\n' + commentLines.join('\n');
      }
      
      logger.info(`✅ Added constraint to existing constraints block modification for ${dependencyName}`);
      
      // Mark as processed and return
      fileConstraints.add(dependencyName);
      logger.info(`✅ Added dependency constraint for ${dependencyName}`);
      return true;
    }
    
    // Find the FIRST constraints block in the dependencies section (original file)
    for (let i = 0; i < dependenciesEndIndex; i++) {
      const line = lines[i].trim();
      if (line.match(/^\s*constraints\s*\{/)) {
        if (firstConstraintsBlockStart === -1) {
          firstConstraintsBlockStart = i;
        }
        constraintsBlockExists = true;
        // Find the end of THIS constraints block
        let constraintsBraceDepth = 1;
        for (let j = i + 1; j < dependenciesEndIndex; j++) {
          const constraintsLine = lines[j].trim();
          const openBraces = (constraintsLine.match(/\{/g) || []).length;
          const closeBraces = (constraintsLine.match(/\}/g) || []).length;
          constraintsBraceDepth += openBraces - closeBraces;
          
          if (constraintsBraceDepth <= 0) {
            constraintsEndIndex = j;
            break;
          }
        }
        
        // If we didn't find a closing brace, the constraints block is malformed
        if (constraintsEndIndex === -1) {
          logger.warn(`⚠️ Found malformed constraints block starting at line ${i + 1} - missing closing brace`);
          // Find the last non-empty line that should be inside the constraints block
          for (let j = dependenciesEndIndex - 1; j > i; j--) {
            const line = lines[j].trim();
            if (line !== '' && !line.startsWith('//') && !line.includes('dependencies') && !line.includes('}')) {
              constraintsEndIndex = j + 1; // Insert after the last constraint line
              logger.info(`📍 Setting constraintsEndIndex to ${constraintsEndIndex} to fix malformed block`);
              break;
            }
          }
        }
        break; // Use the FIRST constraints block we find
      }
    }
    
    // If constraint already exists, don't add it again
    if (constraintAlreadyExists) {
      logger.info(`⏭️ Skipping duplicate constraint for ${dependencyName}:${version}`);
      return true; // Return true since the constraint exists
    }

    if (constraintsBlockExists && constraintsEndIndex > -1) {
      // Add to existing constraints block (insert before the closing brace or fix malformed block)
      logger.info(`✅ Adding constraint to existing constraints block for ${dependencyName} at line ${constraintsEndIndex}`);
      const constraintLine = `${constraintIndentation}implementation('${dependencyName}:${version}')`;
      
      // Check if the constraints block is malformed (missing closing brace)
      const needsClosingBrace = lines[constraintsEndIndex - 1] && 
        !lines[constraintsEndIndex - 1].trim().endsWith('}') && 
        !lines.slice(constraintsEndIndex).some(line => line.trim() === `${dependenciesIndentation}}`);
      
      const linesToAdd = reason ? ['', ...commentLines, constraintLine] : ['', constraintLine];
      
      // If the constraints block needs a closing brace, add it
      if (needsClosingBrace) {
        logger.info(`🔧 Adding missing closing brace to constraints block`);
        linesToAdd.push(`${dependenciesIndentation}}`);
      }
      
      modification.modifications.push({
        type: 'constraint',
        lineNumber: constraintsEndIndex,
        oldLine: '',
        newLine: linesToAdd.join('\n'),
        comment: commentLines.join('\n'),
        cveId
      });
    } else {
      // Create new constraints block
      logger.info(`✅ Creating new constraints block for ${dependencyName} at line ${dependenciesEndIndex}`);
      const constraintLines = reason ? [
        '',
        ...commentLines,
        `${dependenciesIndentation}constraints {`,
        `${constraintIndentation}implementation('${dependencyName}:${version}')`,
        `${dependenciesIndentation}}`
      ] : [
        '',
        `${dependenciesIndentation}constraints {`,
        `${constraintIndentation}implementation('${dependencyName}:${version}')`,
        `${dependenciesIndentation}}`
      ];

      modification.modifications.push({
        type: 'constraint', 
        lineNumber: dependenciesEndIndex,
        oldLine: '',
        newLine: constraintLines.join('\n'),
        comment: commentLines.join('\n'),
        cveId
      });
    }

    // DO NOT update modification.content here - let getModifiedContent handle it
    // This prevents double application of constraints
    
    // Mark this dependency as processed for this file to prevent future duplicates
    fileConstraints.add(dependencyName);
    
    logger.info(`✅ Added dependency constraint for ${dependencyName}`);
    return true;
  }



  /**
   * Add informational comments about transitive dependencies covered by parent updates
   * Only called when constraints are actually added to a file
   */
  addTransitiveDependencyComments(
    modification: GradleFileModification,
    comments: string[]
  ): boolean {
    if (!comments || comments.length === 0) {
      return false;
    }

    const lines = modification.content.split('\n');
    
    // Detect dependencies block indentation for consistent formatting
    const dependenciesIndentation = this.detectDependenciesBlockIndentation(lines);
    
    // Find the dependencies block to add comments
    let dependenciesStartIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().includes('dependencies {')) {
        dependenciesStartIndex = i;
        break;
      }
    }

    if (dependenciesStartIndex === -1) {
      logger.error(`❌ Could not find dependencies block in Gradle file`);
      return false;
    }

    // Add comments after the dependencies { line
    const commentLines = [
      '',
      `${dependenciesIndentation}// ===============================================`,
      `${dependenciesIndentation}// Transitive Dependencies Covered by Parent Updates`,
      `${dependenciesIndentation}// ===============================================`
    ];

    comments.forEach(comment => {
      commentLines.push(`${dependenciesIndentation}// ${comment}`);
    });

    commentLines.push(`${dependenciesIndentation}// ===============================================`);
    commentLines.push('');

    // Insert comments after dependencies {
    lines.splice(dependenciesStartIndex + 1, 0, ...commentLines);

    modification.content = lines.join('\n');
    modification.modifications.push({
      type: 'comment' as any,
      lineNumber: dependenciesStartIndex + 1,
      oldLine: '',
      newLine: commentLines.join('\n'),
      comment: 'Added transitive dependency information',
      cveId: 'INFO'
    });

    logger.info(`✅ Added ${comments.length} transitive dependency comments to Gradle file`);
    return true;
  }

  /**
   * Get the final modified content
   */
  getModifiedContent(modification: GradleFileModification): string {
    let content = modification.content;
    const lines = content.split('\n');
    
    // Apply modifications in reverse order to maintain line numbers
    const sortedModifications = [...modification.modifications].sort((a, b) => b.lineNumber - a.lineNumber);
    
    for (const mod of sortedModifications) {
      if (mod.type === 'dependency' || mod.type === 'variable' || mod.type === 'plugin') {
        // Replace the line with the updated version
        if (mod.newLine && mod.newLine !== mod.oldLine) {
          lines[mod.lineNumber] = mod.newLine;
        }
        
        // Add CVE comment if provided - add it BEFORE the updated line
        if (mod.cveId && mod.cveId.trim()) {
          // Get the indentation from the original line
          const originalIndentation = mod.oldLine.match(/^(\s*)/)?.[1] || '    ';
          const comment = `${originalIndentation}// ${mod.cveId}: ${mod.comment || 'Security update'}`;
          lines.splice(mod.lineNumber, 0, comment);
        }
      } else if (mod.type === 'constraint') {
        // For constraints, the newLine contains the full block to insert
        if (mod.newLine) {
          const newLines = mod.newLine.split('\n');
          lines.splice(mod.lineNumber, 0, ...newLines);
        }
      }
    }
    
    return lines.join('\n');
  }

  /**
   * Get summary of changes made
   */
  getChangesSummary(modification: GradleFileModification): string {
    const summary = modification.modifications.map(mod => {
      switch (mod.type) {
        case 'dependency':
          return `• Updated dependency on line ${mod.lineNumber + 1}`;
        case 'variable':
          return `• Updated version variable on line ${mod.lineNumber + 1}`;
        case 'constraint':
          return `• Added dependency constraint for transitive override`;
        default:
          return `• Made change on line ${mod.lineNumber + 1}`;
      }
    }).join('\n');

    return `Changes made to ${modification.filePath}:\n${summary}`;
  }

  /**
   * Detect the indentation used within the dependencies block
   */
  private detectDependenciesBlockIndentation(lines: string[]): string {
    let inDependenciesBlock = false;
    let braceDepth = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      if (trimmedLine.match(/^dependencies\s*\{/)) {
        inDependenciesBlock = true;
        braceDepth = 1;
        continue;
      }

      if (inDependenciesBlock) {
        const openBraces = (trimmedLine.match(/\{/g) || []).length;
        const closeBraces = (trimmedLine.match(/\}/g) || []).length;
        braceDepth += openBraces - closeBraces;

        // If we're still in the dependencies block and this line has content
        if (braceDepth > 0 && trimmedLine && !trimmedLine.startsWith('//')) {
          const leadingSpaces = line.match(/^(\s*)/)?.[1] || '';
          if (leadingSpaces.length > 0) {
            logger.info(`📏 Detected dependencies block indentation: "${leadingSpaces}" (${leadingSpaces.length} chars)`);
            return leadingSpaces;
          }
        }

        if (braceDepth <= 0) {
          break;
        }
      }
    }
    
    // Fallback to 4 spaces if we can't detect from dependencies block
    logger.info(`📏 Using fallback dependencies indentation: "    " (4 chars)`);
    return '    ';
  }

  private detectIndentationStyle(content: string, startLine: number = 0, endLine?: number): string {
    const lines = content.split('\n');
    const end = endLine || lines.length;
    const relevantLines = lines.slice(startLine, end);
    
    // Count different indentation patterns
    const indentationCounts: { [key: string]: number } = {};
    let hasTabs = false;
    let hasSpaces = false;
    
    for (const line of relevantLines) {
      if (line.trim() === '') continue; // Skip empty lines
      
      const leadingWhitespace = line.match(/^(\s*)/)?.[1] || '';
      if (leadingWhitespace) {
        // Check if this line uses tabs or spaces
        if (leadingWhitespace.includes('\t')) {
          hasTabs = true;
        } else if (leadingWhitespace.includes(' ')) {
          hasSpaces = true;
        }
        
        indentationCounts[leadingWhitespace] = (indentationCounts[leadingWhitespace] || 0) + 1;
      }
    }
    
    // If there's a mix of tabs and spaces, prefer spaces for consistency
    if (hasTabs && hasSpaces) {
      logger.warn(`⚠️ Mixed tab/space indentation detected. Converting to spaces for consistency.`);
      return '    '; // Use 4 spaces as standard
    }
    
    // If only tabs are used, convert to spaces
    if (hasTabs && !hasSpaces) {
      logger.info(`📏 Converting tab indentation to spaces for consistency.`);
      return '    '; // Use 4 spaces as standard
    }
    
    // Find the most common space-based indentation pattern
    let dominantIndentation = '    '; // Default 4 spaces
    let maxCount = 0;
    
    for (const [indentation, count] of Object.entries(indentationCounts)) {
      // Only consider space-based indentation
      if (!indentation.includes('\t') && count > maxCount) {
        maxCount = count;
        dominantIndentation = indentation;
      }
    }
    
    logger.info(`📏 Detected dominant indentation: "${dominantIndentation}" (${dominantIndentation.length} chars) used ${maxCount} times`);
    return dominantIndentation;
  }

  /**
   * Check if a dependency constraint should be skipped due to known issues
   */
  private shouldSkipDependencyConstraint(dependencyName: string, version: string): boolean {
    // List of known problematic dependencies that should be skipped
    const problematicDependencies = [
      // Spring Social - deprecated project, versions like 1.1.3 don't exist
      { 
        pattern: /^org\.springframework\.social:/,
        reason: 'Spring Social project has been deprecated and many versions are not available'
      },
      // Add more problematic patterns here as needed
    ];
    
    for (const problem of problematicDependencies) {
      if (problem.pattern.test(dependencyName)) {
        logger.info(`🚫 Skipping ${dependencyName}:${version} - ${problem.reason}`);
        return true;
      }
    }
    
    return false;
  }

  /**
   * Detect the proper indentation level for constraints block content
   */
  private detectConstraintIndentation(content: string, dependenciesIndentation: string): string {
    const lines = content.split('\n');
    
    // Look for existing constraints blocks to determine proper indentation
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === 'constraints {') {
        // Found a constraints block, check the indentation of the next non-empty line
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j];
          if (nextLine.trim() === '') continue; // Skip empty lines
          if (nextLine.trim() === '}') break; // End of constraints block
          
          // Found content inside constraints block, use its indentation
          const leadingSpaces = nextLine.match(/^(\s*)/)?.[1] || '';
          if (leadingSpaces.length > dependenciesIndentation.length) {
            logger.info(`📏 Detected constraint indentation from existing block: "${leadingSpaces}" (${leadingSpaces.length} chars)`);
            return leadingSpaces;
          }
        }
      }
    }
    
    // If no existing constraints block found, use dependencies indentation + 4 spaces
    const standardIndentation = dependenciesIndentation + '    ';
    logger.info(`📏 Using standard constraint indentation: "${standardIndentation}" (${standardIndentation.length} chars)`);
    return standardIndentation;
  }
}

/**
 * Escape special regex characters
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
} 