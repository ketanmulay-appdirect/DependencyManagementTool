import { logger } from '../../utils/logger';
import { GradleFileParser, GradleFileModification } from './GradleFileParser';
import { MavenFileParser, MavenFileModification } from './MavenFileParser';
import { NpmFileParser, NpmFileModification } from './NpmFileParser';
import { MajorUpgradeRequirement, RequiredUpgrade, VulnerabilitySeverity, PackageManager } from '../../types';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Escape special regex characters
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type FileModification = GradleFileModification | MavenFileModification | NpmFileModification | DockerFileModification | VersionFileModification;

// Simple file modification interfaces for compatibility analysis
export interface DockerFileModification {
  filePath: string;
  content: string;
  modifications: any[];
}

export interface VersionFileModification {
  filePath: string;
  content: string;
  modifications: any[];
}

export interface VulnerabilityFix {
  dependencyName: string;
  currentVersion: string;
  recommendedVersion: string;
  cveId: string;
  severity: string;
  description: string;
}

export interface FileParsingResult {
  filePath: string;
  fileType: 'gradle' | 'maven' | 'npm' | 'docker' | 'version';
  modification: FileModification;
  dependencies?: any[]; // Dependencies extracted from modification for easy access
  applied: boolean;
  fixes: VulnerabilityFix[];
  errors: string[];
}

export class FileParserService {
  private gradleParser: GradleFileParser;
  private mavenParser: MavenFileParser;
  private npmParser: NpmFileParser;

  constructor() {
    this.gradleParser = new GradleFileParser();
    this.mavenParser = new MavenFileParser();
    this.npmParser = new NpmFileParser();
  }

  /**
   * Detect file type based on filename
   */
  detectFileType(filePath: string): 'gradle' | 'maven' | 'npm' | 'docker' | 'version' | 'unknown' {
    const fileName = path.basename(filePath).toLowerCase();
    const fullPath = filePath.toLowerCase();
    
    if (fileName === 'build.gradle' || fileName === 'build.gradle.kts' || fileName.endsWith('.gradle')) {
      return 'gradle';
    }
    
    if (fileName === 'pom.xml') {
      return 'maven';
    }
    
    if (fileName === 'package.json') {
      return 'npm';
    }
    
    // Dockerfile detection
    if (fileName.includes('dockerfile') || 
        fileName === 'dockerfile' || 
        fileName.endsWith('.dockerfile') ||
        fullPath.includes('dockerfile')) {
      return 'docker';
    }
    
    // Version files for Java version detection
    if (['.java-version', '.sdkmanrc', '.tool-versions', 'runtime.txt'].includes(fileName)) {
      return 'version';
    }
    
    return 'unknown';
  }

  /**
   * Find all build files in a repository
   */
  async findBuildFiles(repositoryPath: string): Promise<string[]> {
    logger.info(`🔍 Finding build files in ${repositoryPath}`);
    
    const buildFiles: string[] = [];
    
    try {
      await this.findFilesRecursively(repositoryPath, buildFiles);
      logger.info(`📦 Found ${buildFiles.length} build files`);
      return buildFiles;
    } catch (error) {
      logger.error(`❌ Error finding build files:`, error);
      return [];
    }
  }

  /**
   * Recursively find build files
   */
  private async findFilesRecursively(dirPath: string, buildFiles: string[]): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory()) {
          // Skip common directories that won't have build files
          if (!['node_modules', '.git', 'target', 'build', '.gradle'].includes(entry.name)) {
            await this.findFilesRecursively(fullPath, buildFiles);
          }
        } else if (entry.isFile()) {
          const fileType = this.detectFileType(fullPath);
          if (fileType !== 'unknown') {
            buildFiles.push(fullPath);
          }
        }
      }
    } catch (error) {
      // Ignore permission errors and continue
      logger.warn(`❌ Could not read directory ${dirPath}:`, error);
    }
  }

  /**
   * Parse a build file and prepare for modifications
   */
  async parseFile(filePath: string): Promise<FileParsingResult> {
    logger.info(`🔍 Parsing build file: ${filePath}`);
    
    const fileType = this.detectFileType(filePath);
    const errors: string[] = [];
    
    if (fileType === 'unknown') {
      const error = `Unsupported file type: ${filePath}`;
      logger.error(error);
      return {
        filePath,
        fileType: 'unknown' as any,
        modification: null as any,
        dependencies: [],
        applied: false,
        fixes: [],
        errors: [error]
      };
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      let modification: FileModification;

      switch (fileType) {
        case 'gradle':
          modification = await this.gradleParser.parseFile(filePath, content);
          break;
        case 'maven':
          modification = await this.mavenParser.parseFile(filePath, content);
          break;
        case 'npm':
          modification = await this.npmParser.parseFile(filePath, content);
          break;
        case 'docker':
          // Simple content parser for Dockerfiles
          modification = {
            filePath,
            content,
            modifications: []
          } as DockerFileModification;
          break;
        case 'version':
          // Simple content parser for version files
          modification = {
            filePath,
            content,
            modifications: []
          } as VersionFileModification;
          break;
        default:
          throw new Error(`Unsupported file type: ${fileType}`);
      }

      // Extract dependencies from modification for easy access
      let dependencies: any[] = [];
      if (modification && 'dependencies' in modification) {
        dependencies = (modification as any).dependencies || [];
      }

      return {
        filePath,
        fileType,
        modification,
        dependencies,
        applied: false,
        fixes: [],
        errors
      };
    } catch (error) {
      const errorMsg = `Failed to parse ${filePath}: ${error}`;
      logger.error(errorMsg);
      errors.push(errorMsg);
      
      return {
        filePath,
        fileType,
        modification: null as any,
        dependencies: [],
        applied: false,
        fixes: [],
        errors
      };
    }
  }

  /**
   * Apply vulnerability fixes to parsed files
   */
  async applyVulnerabilityFixes(
    parsingResults: FileParsingResult[],
    vulnerabilityFixes: VulnerabilityFix[],
    dependencyTree?: { name: string; version: string; filePath: string; type: string; packageManager: string; parent?: string; targetVersion?: string }[],
    prAnnotations?: string[],
    majorUpgradeRequirements?: MajorUpgradeRequirement[]
  ): Promise<FileParsingResult[]> {
    logger.info(`🔧 Applying ${vulnerabilityFixes.length} vulnerability fixes across ${parsingResults.length} files (dependency tree aware)`);

    // Clear constraint tracker for new analysis session
    this.gradleParser.clearConstraintTracker();

    // Log parsing results summary for debugging
    logger.info(`📊 Parsing Results Summary:`);
    parsingResults.forEach((result, index) => {
      const depsCount = (result.modification && 'dependencies' in result.modification) ? result.modification.dependencies?.length || 0 : 0;
      const hasErrors = result.errors.length > 0;
      logger.info(`  ${index + 1}. ${path.basename(result.filePath)} (${result.fileType}): ${depsCount} deps, ${hasErrors ? 'HAS ERRORS' : 'OK'}`);
      if (hasErrors) {
        logger.warn(`     Errors: ${result.errors.join(', ')}`);
      }
    });

    // Log vulnerability fixes for debugging
    logger.info(`🎯 Vulnerability Fixes to Apply:`);
    vulnerabilityFixes.forEach((fix, index) => {
      logger.info(`  ${index + 1}. ${fix.dependencyName} (${fix.cveId}): ${fix.currentVersion} → ${fix.recommendedVersion}`);
    });

    const results: FileParsingResult[] = parsingResults.map(r => ({ ...r, applied: false, fixes: [] }));
    const alreadyConstrained: Set<string> = new Set(); // Track which dependency+file combinations have been applied
    const alreadyProcessed: Set<string> = new Set(); // Track comprehensively processed dependencies
    const globallyProcessed: Set<string> = new Set(); // Global deduplication across ALL processing types
    const parentFixes: Record<string, string> = {};
    const parentCveAnnotations: string[] = prAnnotations || [];
    
    // Initialize majorUpgradeRequirements if not provided
    if (!majorUpgradeRequirements) {
      majorUpgradeRequirements = [];
    }

    // GLOBAL DEDUPLICATION: Consolidate vulnerability fixes by dependency to prevent duplicates
    const consolidatedFixes = new Map<string, VulnerabilityFix>();
    logger.info(`🔧 Consolidating ${vulnerabilityFixes.length} vulnerability fixes to prevent duplicates...`);
    
    for (const fix of vulnerabilityFixes) {
      const key = fix.dependencyName;
      
      if (consolidatedFixes.has(key)) {
        const existingFix = consolidatedFixes.get(key)!;
        logger.info(`🔄 Merging fix for ${fix.dependencyName}: CVE ${existingFix.cveId} + CVE ${fix.cveId}`);
        
        // Merge CVE IDs and keep the highest recommended version
        existingFix.cveId = `${existingFix.cveId}, ${fix.cveId}`;
        existingFix.description = `${existingFix.description}; ${fix.description}`;
        
        // Use the higher version if different
        if (fix.recommendedVersion !== existingFix.recommendedVersion) {
          logger.info(`📝 Version conflict: ${existingFix.recommendedVersion} vs ${fix.recommendedVersion}, using higher version`);
          // Simple version comparison - could be enhanced
          if (fix.recommendedVersion > existingFix.recommendedVersion) {
            existingFix.recommendedVersion = fix.recommendedVersion;
          }
        }
      } else {
        logger.info(`✅ First fix for ${fix.dependencyName}: CVE ${fix.cveId} → ${fix.recommendedVersion}`);
        consolidatedFixes.set(key, { ...fix });
      }
    }
    
    const consolidatedFixesList = Array.from(consolidatedFixes.values());
    logger.info(`📊 Consolidated ${vulnerabilityFixes.length} fixes into ${consolidatedFixesList.length} unique dependency updates`);

    // First, collect all parent dependencies being updated and their target versions
    for (const fix of consolidatedFixesList) {
      if (dependencyTree && dependencyTree.length > 0) {
        const dep = dependencyTree.find(d => d.name === fix.dependencyName && d.type === 'direct');
        if (dep && fix.recommendedVersion) {
          parentFixes[fix.dependencyName] = fix.recommendedVersion;
        }
      }
      
      // Note: Removed automatic Spring Framework dependency suppression 
      // Each Spring dependency should be evaluated individually for CVE fixes
    }

    for (const fix of consolidatedFixesList) {
      let targetFilePaths: string[] = [];
      let skipDueToParent = false;
      let parentName = '';
      
      // GLOBAL DEDUPLICATION CHECK: Skip if already processed by any mechanism
      if (globallyProcessed.has(fix.dependencyName)) {
        logger.info(`⏭️ Skipping ${fix.dependencyName} - already globally processed`);
        continue;
      }
      
      // COMPATIBILITY CHECK: Skip if major version upgrade is required
      const compatibilityIssue = await this.checkCompatibilityIssues(fix, results);
      if (compatibilityIssue) {
        logger.info(`⚠️ Skipping ${fix.dependencyName} due to compatibility issue: ${compatibilityIssue.reason}`);
        majorUpgradeRequirements!.push(compatibilityIssue);
        continue; // Skip this fix - requires manual major version upgrade
      }
      
      // SKIP CHECK: Skip if already comprehensively processed
      if (alreadyProcessed.has(fix.dependencyName)) {
        logger.info(`⏭️ Skipping ${fix.dependencyName} - already comprehensively processed`);
        continue;
      }
      
      // EARLY CHECK: Skip Spring dependencies if Spring Boot is being updated (but only for transitive dependencies)
      if (parentFixes[fix.dependencyName] === 'covered-by-spring-boot') {
        // Only skip if this is a transitive dependency, not a direct dependency
        const isDirectDependency = results.some(result => {
          if (result.modification && result.fileType === 'gradle') {
            const gradleMod = result.modification as any;
            return gradleMod.dependencies && gradleMod.dependencies.some((dep: any) => 
              `${dep.group}:${dep.name}` === fix.dependencyName && dep.version === fix.currentVersion
            );
          } else if (result.modification && result.fileType === 'maven') {
            const mavenMod = result.modification as any;
            return mavenMod.dependencies && mavenMod.dependencies.some((dep: any) => 
              `${dep.groupId}:${dep.artifactId}` === fix.dependencyName && dep.version === fix.currentVersion
            );
          }
          return false;
        });
        
        if (!isDirectDependency) {
          skipDueToParent = true;
          parentName = 'org.springframework.boot:spring-boot';
          logger.info(`⏭️ Skipping ${fix.dependencyName} because Spring Boot is being updated (transitive dependency)`);
          
          // Add annotation for transitive CVE fixed via parent
          const annotation = `CVE ${fix.cveId}: ${fix.dependencyName} is fixed via parent upgrade (${parentName}). No explicit override needed.`;
          parentCveAnnotations.push(annotation);
          logger.info(`⏭️ Skipping explicit fix for ${fix.dependencyName} (CVE ${fix.cveId}) because parent ${parentName} is being updated to cover this CVE.`);
          continue;
        } else {
          logger.info(`✅ ${fix.dependencyName} is a direct dependency - will apply fix even though Spring Boot is being updated`);
        }
      }
      
      // CONSISTENCY CHECK: Ensure Spring Boot component versions are aligned
      if (fix.dependencyName.startsWith('org.springframework.boot:')) {
        logger.info(`🔧 Spring Boot dependency detected: ${fix.dependencyName}`);
        
        // Get the target version for this Spring Boot component
        const compatibleVersion = await this.getCompatibleVersion(fix.dependencyName, fix.currentVersion, fix.recommendedVersion, results);
        let variableUpdated = false;
        
        // Update Spring Boot version variables to maintain consistency across all components
        for (const result of results) {
          if (result.modification && result.fileType === 'gradle') {
            const gradleMod = result.modification as any;
            
            // Look for Spring Boot version variables and update them
            if (gradleMod.variables) {
              for (const variable of gradleMod.variables) {
                if (variable.name.toLowerCase().includes('springboot') || 
                    variable.name.toLowerCase().includes('spring_boot') ||
                    variable.name === 'springBootVersion') {
                  
                  logger.info(`🔄 Updating Spring Boot version variable: ${variable.name} from ${variable.value} to ${compatibleVersion}`);
                  
                  // Update the variable value
                  const lines = gradleMod.content.split('\n');
                  const newVariableLine = variable.originalLine.replace(
                    new RegExp(`(['"])${escapeRegExp(variable.value)}(['"])`),
                    `$1${compatibleVersion}$2`
                  );
                  
                  lines[variable.lineNumber] = newVariableLine;
                  gradleMod.content = lines.join('\n');
                  
                  // Update the variable object
                  variable.value = compatibleVersion;
                  variable.originalLine = newVariableLine;
                  
                  // Track the modification
                  gradleMod.modifications = gradleMod.modifications || [];
                  gradleMod.modifications.push({
                    type: 'variable',
                    lineNumber: variable.lineNumber,
                    oldLine: variable.originalLine,
                    newLine: newVariableLine,
                    comment: '',
                    cveId: fix.cveId
                  });
                  
                  // Mark this file as applied if not already
                  if (!result.applied) {
                    result.applied = true;
                    result.fixes = result.fixes || [];
                  }
                  
                  // Add this fix to the file's fixes
                  result.fixes.push(fix);
                  variableUpdated = true;
                  
                  logger.info(`✅ Updated Spring Boot version variable ${variable.name} to ${compatibleVersion}`);
                  
                  // Variable updated successfully - skip normal dependency processing for this Spring Boot component
                  break;
                }
              }
            }
          }
        }
        
                  // If we updated a variable, ensure all Spring Boot dependencies and plugins use the variable consistently
          if (variableUpdated) {
            logger.info(`✅ Spring Boot dependency ${fix.dependencyName} resolved via variable update - ensuring consistency across all files`);
            
            // Now update all Spring Boot dependencies and plugins in all files
            for (const result of results) {
              if (result.modification && result.fileType === 'gradle') {
                const gradleMod = result.modification as any;
                
                // Update Spring Boot dependencies to use the variable
                if (gradleMod.dependencies) {
                  for (const dep of gradleMod.dependencies) {
                    // Check if this is a Spring Boot dependency with a hardcoded version
                    if (dep.group === 'org.springframework.boot' && 
                        dep.version && 
                        !dep.version.includes('${') && 
                        dep.version !== compatibleVersion) {
                      
                      logger.info(`🔄 Updating hardcoded Spring Boot dependency ${dep.group}:${dep.name} from ${dep.version} to use variable`);
                      
                      // Update the dependency to use the variable
                      const success = this.gradleParser.updateDependencyVersion(
                        gradleMod,
                        `${dep.group}:${dep.name}`,
                        dep.version,
                        `\${springBootVersion}`,
                        fix.cveId,
                        `Updated to use centralized Spring Boot version variable for consistency`
                      );
                      
                      if (success) {
                        // Mark this file as applied if not already
                        if (!result.applied) {
                          result.applied = true;
                          result.fixes = result.fixes || [];
                        }
                        
                        // Add this fix to the file's fixes
                        result.fixes.push(fix);
                      }
                    }
                  }
                }
                
                // Update Spring Boot plugin to use the new version
                if (gradleMod.plugins) {
                  for (const plugin of gradleMod.plugins) {
                    if (plugin.id === 'org.springframework.boot' && 
                        plugin.version !== compatibleVersion) {
                      
                      logger.info(`🔄 Updating Spring Boot plugin from ${plugin.version} to ${compatibleVersion}`);
                      
                      // Update the plugin version
                      const success = this.gradleParser.updatePluginVersion(
                        gradleMod,
                        'org.springframework.boot',
                        plugin.version,
                        compatibleVersion,
                        fix.cveId,
                        `Updated Spring Boot plugin version for security`
                      );
                      
                      if (success) {
                        // Mark this file as applied if not already
                        if (!result.applied) {
                          result.applied = true;
                          result.fixes = result.fixes || [];
                        }
                        
                        // Add this fix to the file's fixes
                        result.fixes.push(fix);
                      }
                    }
                  }
                }
              }
            }
            
            continue;
          }
      }
      
      // SPRING BOOT CONSISTENCY CHECK: Ensure all Spring Boot dependencies use consistent versions
      if (fix.dependencyName.includes('spring-boot')) {
        logger.info(`🔧 Spring Boot dependency detected: ${fix.dependencyName} - checking for Spring Boot version consistency`);
        const compatibleVersion = await this.getCompatibleVersion(fix.dependencyName, fix.currentVersion, fix.recommendedVersion, results);
        await this.ensureSpringBootVersionConsistency(results, fix, compatibleVersion, globallyProcessed);
        
        // Mark Spring Boot dependency as comprehensively processed
        alreadyProcessed.add(fix.dependencyName);
        globallyProcessed.add(fix.dependencyName);
        logger.info(`✅ Marked ${fix.dependencyName} as comprehensively processed`);
        
        // Also mark related Spring dependencies that would be handled by Spring Boot consistency
        const relatedSpringDeps = consolidatedFixesList.filter(f => 
          f.dependencyName !== fix.dependencyName && 
          (f.dependencyName.includes('org.springframework') || f.dependencyName.includes('spring-security'))
        );
        relatedSpringDeps.forEach(dep => {
          alreadyProcessed.add(dep.dependencyName);
          globallyProcessed.add(dep.dependencyName);
          logger.info(`✅ Marked related Spring dependency ${dep.dependencyName} as comprehensively processed`);
        });
        
        // Skip individual processing for this Spring Boot dependency since comprehensive updates were applied
        continue;
        
      } else if (fix.dependencyName.includes('org.springframework') || fix.dependencyName.includes('spring-security')) {
        logger.info(`🔧 Spring-related dependency detected: ${fix.dependencyName} - will be handled by Spring Boot comprehensive logic if present`);
        // DO NOT trigger individual Spring Framework updates here - they will be handled by Spring Boot consistency
        // This prevents the same dependency from being updated multiple times
      }
      
      // FINAL GLOBAL DEDUPLICATION CHECK: Skip if already processed by any mechanism (including Spring Boot consistency)
      if (globallyProcessed.has(fix.dependencyName)) {
        logger.info(`⏭️ Skipping ${fix.dependencyName} - already globally processed by comprehensive Spring Boot logic`);
        continue;
      }
      
      // STEP 1: First check for DIRECT dependency declarations in parsed files
      logger.info(`🔍 Step 1: Looking for direct dependency declaration of ${fix.dependencyName} in parsed files`);
      const directMatchFiles: string[] = [];
      
      // Determine expected file types based on dependency name format
      const expectedFileTypes: ('gradle' | 'maven' | 'npm' | 'docker' | 'version')[] = [];
      if (fix.dependencyName.includes(':') && fix.dependencyName.match(/^[a-z0-9.-]+:[a-z0-9.-]+$/)) {
        // Format like "org.springframework:spring-boot" - likely Java
        expectedFileTypes.push('gradle', 'maven');
      } else if (fix.dependencyName.match(/^[a-z0-9@/-]+$/)) {
        // Format like "react" or "@types/node" - likely npm
        expectedFileTypes.push('npm');
      } else {
        // Unknown format, check all types
        expectedFileTypes.push('gradle', 'maven', 'npm');
      }
      
      logger.info(`📋 Expected file types for ${fix.dependencyName}:`, expectedFileTypes);
      
      for (const parsingResult of results) {
        // Skip files that don't match the expected type
        if (!expectedFileTypes.includes(parsingResult.fileType)) {
          logger.info(`⏭️ Skipping ${parsingResult.fileType} file for Java dependency: ${path.basename(parsingResult.filePath)}`);
          continue;
        }
        
        if (parsingResult.modification && 'dependencies' in parsingResult.modification && parsingResult.modification.dependencies) {
          const deps = parsingResult.modification.dependencies;
          
          logger.info(`📂 Checking file: ${path.basename(parsingResult.filePath)} (${parsingResult.fileType}, ${deps.length} dependencies)`);
          
          // Log all dependencies in this file for debugging
          deps.forEach((dep: any, index: number) => {
            let depName: string;
            
            if ('groupId' in dep && 'artifactId' in dep) {
              // Maven dependency: groupId:artifactId
              depName = `${dep.groupId}:${dep.artifactId}`;
            } else if ('group' in dep && 'name' in dep) {
              // Gradle dependency: group:name
              depName = `${dep.group}:${dep.name}`;
            } else if ('name' in dep) {
              // npm dependency or Gradle with just name
              depName = dep.name;
            } else {
              depName = 'UNKNOWN_FORMAT';
            }
            
            logger.info(`  📦 Dep ${index + 1}: ${depName}:${dep.version || 'unknown'}`);
          });
          
          // Check if this file contains the dependency directly
          const hasDirectDependency = deps.some(dep => {
            // Get the dependency name based on the type
            let depName: string;
            
            if ('groupId' in dep && 'artifactId' in dep) {
              // Maven dependency: groupId:artifactId
              depName = `${dep.groupId}:${dep.artifactId}`;
            } else if ('group' in dep && 'name' in dep) {
              // Gradle dependency: group:name
              depName = `${dep.group}:${dep.name}`;
            } else if ('name' in dep) {
              // npm dependency or Gradle with just name
              depName = dep.name;
            } else {
              return false;
            }
            
            if (fix.dependencyName.includes(':')) {
              const [group, artifact] = fix.dependencyName.split(':');
              const matches = (
                depName === fix.dependencyName ||
                depName === artifact ||
                depName.endsWith(`:${artifact}`) ||
                (depName.includes(group) && depName.includes(artifact))
              );
              
              // Enhanced debug logging for dependency matching
              logger.info(`🔍 DETAILED MATCH CHECK for ${fix.dependencyName}:`);
              logger.info(`  📦 Parsed dep: "${depName}"`);
              logger.info(`  🎯 Looking for: "${fix.dependencyName}"`);
              logger.info(`  �� Group: "${group}", Artifact: "${artifact}"`);
              logger.info(`  ✔️ Exact match: ${depName === fix.dependencyName}`);
              logger.info(`  ✔️ Artifact match: ${depName === artifact}`);
              logger.info(`  ✔️ Ends with artifact: ${depName.endsWith(`:${artifact}`)}`);
              logger.info(`  ✔️ Contains both: ${depName.includes(group) && depName.includes(artifact)}`);
              logger.info(`  🎯 Final result: ${matches}`);
              
              if (matches) {
                logger.info(`  ✅ MATCH FOUND: ${depName} matches ${fix.dependencyName}`);
              }
              
              return matches;
            } else {
              // For non-Maven coordinates, use exact match only to prevent partial matches
              const matches = depName === fix.dependencyName;
              
              if (matches) {
                logger.info(`  ✅ MATCH FOUND: ${depName} matches ${fix.dependencyName}`);
              }
              
              return matches;
            }
          });
          
          if (hasDirectDependency) {
            directMatchFiles.push(parsingResult.filePath);
            logger.info(`✅ Found direct dependency ${fix.dependencyName} in ${parsingResult.filePath}`);
          }
        }
      }
      
      // STEP 2: If direct matches found, use those exclusively
      if (directMatchFiles.length > 0) {
        targetFilePaths = directMatchFiles;
        logger.info(`🎯 Using direct dependency files for ${fix.dependencyName}:`, targetFilePaths);
      } else {
        // STEP 3: Fall back to dependency tree if no direct matches
        logger.info(`🔍 Step 2: No direct matches found, checking dependency tree for ${fix.dependencyName}`);
        
        if (dependencyTree && dependencyTree.length > 0) {
          // Find all filePaths in the dependency tree where the vulnerable dependency is present
          const matchingDeps = dependencyTree.filter(dep => {
            if (fix.dependencyName.includes(':')) {
              const [group, artifact] = fix.dependencyName.split(':');
              return (
                dep.name === fix.dependencyName ||
                dep.name === artifact ||
                dep.name.endsWith(`:${artifact}`)
              );
            } else {
              return dep.name === fix.dependencyName;
            }
          });
          targetFilePaths = matchingDeps.map(dep => dep.filePath);

          // Check for parent update covering this transitive dependency
          for (const dep of matchingDeps) {
            if (dep.type === 'transitive' && dep.parent && parentFixes[dep.parent]) {
              // Find the parent's fix version and the required version for this CVE
              const parentTargetVersion = parentFixes[dep.parent];
              if (parentTargetVersion && fix.recommendedVersion &&
                  (parentTargetVersion === fix.recommendedVersion || parentTargetVersion > fix.recommendedVersion)) {
                skipDueToParent = true;
                parentName = dep.parent;
                break;
              }
            }
          }
          
          logger.info(`🎯 Dependency tree targeting for ${fix.dependencyName}:`, targetFilePaths, { skipDueToParent, parentName });
        }
      }

      // Remove duplicates
      targetFilePaths = [...new Set(targetFilePaths)];

      if (skipDueToParent) {
        // Add annotation for transitive CVE fixed via parent
        const annotation = `CVE ${fix.cveId}: ${fix.dependencyName} is fixed via parent upgrade (${parentName} → ${parentFixes[parentName]}). No explicit override needed.`;
        parentCveAnnotations.push(annotation);
        logger.info(`⏭️ Skipping explicit fix for ${fix.dependencyName} (CVE ${fix.cveId}) because parent ${parentName} is being updated to cover this CVE.`);
        continue;
      }

      if (targetFilePaths.length > 0) {
        // Apply fix only to those files
        for (const filePath of targetFilePaths) {
          const parsingResult = results.find(r => r.filePath === filePath);
          const constraintKey = `${fix.dependencyName}:${filePath}`;
          
          if (!parsingResult || alreadyConstrained.has(constraintKey)) {
            if (alreadyConstrained.has(constraintKey)) {
              logger.info(`⏭️ Skipping ${fix.dependencyName} in ${filePath} - already applied`);
            }
            continue;
          }
          
          const applied = await this.applyFixToFile(parsingResult, fix, results, globallyProcessed);
          if (applied) {
            parsingResult.applied = true;
            parsingResult.fixes = parsingResult.fixes || [];
            parsingResult.fixes.push(fix);
            alreadyConstrained.add(constraintKey); // Track dependency+file combination
            globallyProcessed.add(fix.dependencyName); // Global deduplication tracking
            logger.info(`✅ Successfully applied ${fix.dependencyName} to ${filePath}`);
          } else {
            logger.warn(`❌ Failed to apply ${fix.dependencyName} to ${filePath}`);
          }
        }
      } else {
        // Fallback: Choose file with related dependencies, not just shallowest file
        let candidate: FileParsingResult | undefined;
        let bestScore = -1;
        
        // First, try to find files that actually use this dependency according to dependency tree
        if (dependencyTree && dependencyTree.length > 0) {
          logger.info(`🔍 Using dependency tree to find files that use ${fix.dependencyName}`);
          logger.info(`📊 Dependency tree has ${dependencyTree.length} entries`);
          
          // Log some sample entries for debugging
          const sampleEntries = dependencyTree.slice(0, 5);
          logger.info(`📋 Sample dependency tree entries:`, sampleEntries.map(dep => ({
            name: dep.name,
            filePath: dep.filePath,
            type: dep.type
          })));
          
          // Find all files that have this dependency in their tree
          const filesUsingDependency = dependencyTree
            .filter(dep => {
              // More flexible matching - check both exact name and artifact name
              const depName = dep.name;
              const fixName = fix.dependencyName;
              const fixArtifact = fix.dependencyName.split(':').pop();
              
              const matches = depName === fixName || 
                     depName === fixArtifact ||
                     (depName && fixArtifact && depName.includes(fixArtifact)) ||
                     (depName && fixName.includes(depName));
              
              if (matches) {
                logger.info(`✅ Dependency tree match found: ${depName} matches ${fix.dependencyName}`);
              }
              
              return matches;
            })
            .map(dep => dep.filePath)
            .filter(Boolean);
          
          logger.info(`📦 Files using ${fix.dependencyName} according to dependency tree:`, filesUsingDependency);
          
          // Also check for files that have related dependencies (same group)
          const fixGroup = fix.dependencyName.split(':')[0];
          const filesWithRelatedDeps = dependencyTree
            .filter(dep => dep.name && dep.name.startsWith(fixGroup))
            .map(dep => dep.filePath)
            .filter(Boolean);
          
          logger.info(`📦 Files with related dependencies (${fixGroup}):`, filesWithRelatedDeps);
          
          // Prioritize files that actually use this dependency
          for (const parsingResult of results) {
            if (!parsingResult.modification || parsingResult.errors.length > 0) continue;
            
            const isFileUsingDependency = filesUsingDependency.some(filePath => 
              parsingResult.filePath.includes(filePath) || 
              path.basename(parsingResult.filePath) === path.basename(filePath)
            );
            
            const isFileWithRelatedDeps = filesWithRelatedDeps.some(filePath => 
              parsingResult.filePath.includes(filePath) || 
              path.basename(parsingResult.filePath) === path.basename(filePath)
            );
            
            if (isFileUsingDependency) {
              logger.info(`🎯 Found file that uses ${fix.dependencyName}: ${parsingResult.filePath}`);
              candidate = parsingResult;
              bestScore = 1000; // Very high score for files that actually use the dependency
              break;
            } else if (isFileWithRelatedDeps) {
              logger.info(`🎯 Found file with related dependencies (${fixGroup}): ${parsingResult.filePath}`);
              candidate = parsingResult;
              bestScore = 800; // High score for files with related dependencies
              break;
            }
          }
        }
        
        // If no file found via dependency tree, fall back to scoring logic
        if (!candidate) {
          logger.info(`🔍 No dependency tree match found, using scoring logic for ${fix.dependencyName}`);
          
          // Simple heuristic: For Spring dependencies, prefer service modules
          const isSpringDependency = fix.dependencyName.includes('spring');
          const isLoggingDependency = fix.dependencyName.includes('logback') || fix.dependencyName.includes('json');
          
          for (const parsingResult of results) {
            if (!parsingResult.modification || parsingResult.errors.length > 0) continue;
            
            let score = 0;
            const fileName = path.basename(parsingResult.filePath);
            const isRootFile = fileName === 'build.gradle' && !parsingResult.filePath.includes('/');
            const isModuleFile = parsingResult.filePath.includes('/');
            const isServiceModule = parsingResult.filePath.includes('service') || 
                                   parsingResult.filePath.includes('api') || 
                                   parsingResult.filePath.includes('app');
            
            // Priority 0: Strongly prefer module files over root files
            if (isModuleFile && !isRootFile) {
              score += 500; // Very strong preference for module files
            } else if (isRootFile) {
              score -= 200; // Heavy penalty for root files
            }
            
            // Priority 1: For Spring/logging dependencies, prefer service modules
            if ((isSpringDependency || isLoggingDependency) && isServiceModule) {
              score += 300; // Strong preference for service modules
              logger.info(`   +300 points: Service module for ${isSpringDependency ? 'Spring' : 'logging'} dependency`);
            }
            
            // Priority 2: File that already has applied fixes for related dependencies
            if (parsingResult.applied && parsingResult.fixes.length > 0) {
              score += 100;
              
              // Extra points for same group/organization
              const fixGroup = fix.dependencyName.split(':')[0];
              for (const appliedFix of parsingResult.fixes) {
                const appliedGroup = appliedFix.dependencyName.split(':')[0];
                if (appliedGroup === fixGroup) {
                  score += 50; // Same organization (e.g., org.springframework)
                }
              }
            }
            
            // Priority 3: File with related dependencies (same group/org)
            if ('dependencies' in parsingResult.modification && parsingResult.modification.dependencies) {
              const deps = parsingResult.modification.dependencies;
              const fixGroup = fix.dependencyName.split(':')[0];
              
              // Special logging for Spring Security dependencies
              if (fix.dependencyName.includes('spring-security')) {
                logger.info(`🔍 Spring Security dependency analysis for ${fix.dependencyName} in ${parsingResult.filePath}:`);
                const springSecurityDeps = deps.filter((dep: any) => {
                  const depName = dep.group ? `${dep.group}:${dep.name}` : dep.name;
                  return depName && depName.includes('spring-security');
                });
                logger.info(`   Found ${springSecurityDeps.length} Spring Security dependencies:`, 
                  springSecurityDeps.map((dep: any) => `${dep.group || ''}:${dep.name}:${dep.version}`));
              }
              
              for (const dep of deps) {
                let depName: string;
                if ('groupId' in dep && 'artifactId' in dep) {
                  depName = `${dep.groupId}:${dep.artifactId}`;
                } else if ('group' in dep && 'name' in dep) {
                  depName = `${dep.group}:${dep.name}`;
                } else if ('name' in dep) {
                  depName = dep.name;
                } else {
                  continue;
                }
                
                const depGroup = depName.split(':')[0];
                if (depGroup === fixGroup) {
                  score += 25; // Has related dependencies
                  logger.info(`   +25 points: Found related dependency ${depName} (same group: ${fixGroup})`);
                }
              }
            }
            
            // Priority 4: Special bonus for Spring/logging dependencies in service modules
            if (isModuleFile && (fix.dependencyName.includes('spring') || 
                                fix.dependencyName.includes('logback') ||
                                fix.dependencyName.includes('json'))) {
              score += 75; // These typically belong in service modules
            }
            
            // Priority 5: Prefer deeper module files
            const depth = parsingResult.filePath.split(path.sep).length;
            if (depth > 3) { // Deeper files (module files) get bonus
              score += 10;
            }
            
            logger.info(`📊 File scoring for ${fix.dependencyName}:`, {
              file: path.basename(parsingResult.filePath),
              fullPath: parsingResult.filePath,
              isModuleFile,
              isRootFile,
              isServiceModule,
              score,
              hasAppliedFixes: parsingResult.applied,
              fixesCount: parsingResult.fixes?.length || 0,
              hasRelatedDependencies: ('dependencies' in parsingResult.modification) && parsingResult.modification.dependencies ? 
                (parsingResult.modification.dependencies as any[]).some((dep: any) => {
                  const depGroup = dep.group || dep.name?.split(':')[0];
                  const fixGroup = fix.dependencyName.split(':')[0];
                  return depGroup === fixGroup;
                }) : false
            });
            
            if (score > bestScore) {
              candidate = parsingResult;
              bestScore = score;
            }
          }
        } else {
          logger.info(`✅ Using dependency tree result for ${fix.dependencyName}: ${candidate.filePath} (score: ${bestScore})`);
        }
        
        // If no scored candidate, fall back to shallowest file
        if (!candidate) {
          let minDepth = Infinity;
          for (const parsingResult of results) {
            if (!parsingResult.modification || parsingResult.errors.length > 0) continue;
            const depth = parsingResult.filePath.split(path.sep).length;
            if (depth < minDepth) {
              candidate = parsingResult;
              minDepth = depth;
            }
          }
        }
        
        if (candidate && !alreadyConstrained.has(`${fix.dependencyName}:${candidate.filePath}`)) {
          logger.info(`📦 Selected ${path.basename(candidate.filePath)} for constraint (score: ${bestScore})`);
          logger.info(`🎯 Selection reason: ${candidate.filePath} chosen for ${fix.dependencyName} constraint`);
          
          const originalApplyFixToFile = this.applyFixToFile.bind(this);
          this.applyFixToFile = async (pr, fix) => {
            const transitiveReason = `Patch ${fix.severity} vulnerability - ${fix.description}`;
            const fixWithTransitiveComment = { ...fix, description: transitiveReason };
            return await originalApplyFixToFile(pr, fixWithTransitiveComment, results, globallyProcessed);
          };
          const applied = await this.applyFixToFile(candidate, fix, results, globallyProcessed);
          this.applyFixToFile = originalApplyFixToFile;
          if (applied) {
            candidate.applied = true;
            candidate.fixes.push(fix);
            alreadyConstrained.add(`${fix.dependencyName}:${candidate.filePath}`); // Track dependency+file combination
            logger.info(`✅ Successfully added constraint for ${fix.dependencyName} to ${candidate.filePath}`);
          } else {
            logger.warn(`❌ Failed to add constraint for ${fix.dependencyName} to ${candidate.filePath}`);
          }
        } else {
          if (alreadyConstrained.has(`${fix.dependencyName}:${candidate?.filePath}`)) {
            logger.warn(`⏭️ Constraint already exists for ${fix.dependencyName} in ${candidate?.filePath}`);
          } else {
            logger.warn(`❌ No suitable file found for constraint/override for ${fix.dependencyName}`);
          }
        }
      }
    }

    // Log summary
    const totalAppliedFixes = results.reduce((sum, result) => sum + result.fixes.length, 0);
    const modifiedFiles = results.filter(result => result.applied).length;
    logger.info(`🎯 Dependency tree aware fix application summary:`, {
      totalVulnerabilityFixes: vulnerabilityFixes.length,
      totalAppliedFixes,
      modifiedFiles,
      totalFiles: results.length,
      success: totalAppliedFixes > 0,
      parentCveAnnotations
    });

    // Add transitive dependency comments to files that had constraints added
    if (parentCveAnnotations.length > 0) {
      logger.info(`📝 Adding transitive dependency comments to files with constraints...`);
      for (const result of results) {
        if (result.applied && result.modification) {
          // Handle Gradle files
          if (result.fileType === 'gradle') {
            const gradleModification = result.modification as any;
            
            // Only add comments if this file actually had constraints added (not direct updates)
            const hasConstraints = gradleModification.modifications && 
              gradleModification.modifications.some((mod: any) => mod.type === 'constraint');
            
            if (hasConstraints && this.gradleParser.addTransitiveDependencyComments) {
              logger.info(`✅ Adding transitive comments to ${result.filePath} (has constraints)`);
              this.gradleParser.addTransitiveDependencyComments(gradleModification, parentCveAnnotations);
            }
          }
          
          // Handle Maven files
          else if (result.fileType === 'maven') {
            const mavenModification = result.modification as any;
            
            // Only add comments if this file actually had dependency management added (not direct updates)
            const hasDependencyManagement = mavenModification.modifications && 
              mavenModification.modifications.some((mod: any) => mod.type === 'dependencyManagement');
            
            if (hasDependencyManagement && mavenModification.addTransitiveDependencyComments) {
              logger.info(`✅ Adding transitive comments to ${result.filePath} (has dependency management)`);
              mavenModification.addTransitiveDependencyComments(mavenModification, parentCveAnnotations);
            }
          }
        }
      }
    }

    // Optionally, return parentCveAnnotations for PR summary
    (results as any).parentCveAnnotations = parentCveAnnotations;
    return results;
  }

  /**
   * Apply a single fix to a file
   */
  private async applyFixToFile(parsingResult: FileParsingResult, fix: VulnerabilityFix, allParsingResults: FileParsingResult[], globallyProcessed?: Set<string>): Promise<boolean> {
    const { modification, fileType } = parsingResult;
    const reason = `Patch ${fix.severity} vulnerability - ${fix.description}`;

    // Skip fixes with invalid recommended versions
    if (fix.recommendedVersion === 'VERSION_NOT_FOUND' || 
        fix.recommendedVersion === 'latest' || 
        fix.recommendedVersion === 'unknown' || 
        !fix.recommendedVersion) {
      logger.warn(`⏭️ Skipping fix for ${fix.dependencyName} due to invalid recommended version: ${fix.recommendedVersion}`);
      return false;
    }

    try {
      // Log debug information about the fix attempt
      logger.info(`🔍 Attempting to apply fix: ${fix.dependencyName} (${fix.cveId}) in ${fileType} file ${parsingResult.filePath}`);
      logger.info(`📝 Version update: ${fix.currentVersion} → ${fix.recommendedVersion}`);
      
      // Debug: Log available dependencies in this file
      if ('dependencies' in modification) {
        const deps = (modification as any).dependencies || [];
        logger.info(`📦 Available dependencies in ${parsingResult.filePath}:`, 
          deps.slice(0, 10).map((dep: any) => {
            if (dep.group && dep.name) {
              return `${dep.group}:${dep.name}:${dep.version}`;
            } else if (dep.name) {
              return `${dep.name}:${dep.version}`;
            }
            return dep;
          })
        );
        
        // Try to find potential matches with strict matching to prevent partial matches
        const potentialMatches = deps.filter((dep: any) => {
          const depName = dep.group ? `${dep.group}:${dep.name}` : dep.name;
          return depName && (
            depName === fix.dependencyName ||
            (dep.name && dep.name === fix.dependencyName.split(':').pop())
          );
        });
        
        if (potentialMatches.length > 0) {
          logger.info(`🎯 Potential matches found for ${fix.dependencyName}:`, potentialMatches);
        } else {
          logger.warn(`❌ No potential matches found for ${fix.dependencyName} in ${parsingResult.filePath}`);
          logger.info(`🔍 Looking for exact match: "${fix.dependencyName}"`);
          logger.info(`🔍 Also checking artifact name: "${fix.dependencyName.split(':').pop()}"`);
        }
      }

      // First try to update as direct dependency
      let directUpdateSuccess = false;

      switch (fileType) {
        case 'gradle':
          const gradleMod = modification as GradleFileModification;
          const compatibleVersion = await this.getCompatibleVersion(fix.dependencyName, fix.currentVersion, fix.recommendedVersion, allParsingResults);
          
          // Generate proper comment with CVE ID and reason
          const reason = `Security update: ${fix.cveId} - ${fix.description || 'Vulnerability fix'}`;
          
          // Try updating as dependency first
          directUpdateSuccess = this.gradleParser.updateDependencyVersion(
            gradleMod,
            fix.dependencyName,
            fix.currentVersion,
            compatibleVersion,
            fix.cveId,
            reason
          );
          
          // If dependency update failed, try updating as plugin
          if (!directUpdateSuccess) {
            directUpdateSuccess = this.gradleParser.updatePluginVersion(
              gradleMod,
              fix.dependencyName,
              fix.currentVersion,
              compatibleVersion,
              fix.cveId,
              reason
            );
          }
          
          // For Spring Boot, also try to update the plugin even if dependency update succeeded
          if (fix.dependencyName.includes('spring-boot') && directUpdateSuccess) {
            logger.info(`🔧 Spring Boot dependency updated successfully, also updating plugin version`);
            const pluginUpdateSuccess = this.gradleParser.updatePluginVersion(
              gradleMod,
              'org.springframework.boot',
              fix.currentVersion,
              compatibleVersion,
              fix.cveId,
              reason
            );
            if (pluginUpdateSuccess) {
              logger.info(`✅ Spring Boot plugin version also updated to ${compatibleVersion}`);
            }
          }
          
          // If plugin update failed, try updating as variable
          if (!directUpdateSuccess) {
            // Extract variable name from dependency name (e.g., "org.springframework.boot" -> "springBootVersion")
            const variableName = this.extractVariableName(fix.dependencyName);
            if (variableName) {
              directUpdateSuccess = this.gradleParser.updateVariableVersion(
                gradleMod,
                variableName,
                fix.currentVersion,
                compatibleVersion,
                fix.cveId,
                reason
              );
            }
          }
          
          // If all direct updates failed, try variable substitution (converting hardcoded versions to use variables)
          if (!directUpdateSuccess) {
            directUpdateSuccess = this.tryVariableSubstitution(
              gradleMod,
              fix.dependencyName,
              fix.currentVersion,
              compatibleVersion,
              fix.cveId,
              reason,
              allParsingResults
            );
          }
          
          // Mark as globally processed if any direct update succeeded (dependency, plugin, or variable)
          if (directUpdateSuccess) {
            globallyProcessed.add(fix.dependencyName);
            logger.info(`✅ Marked ${fix.dependencyName} as globally processed after direct update`);
          }
          
          // If direct update failed, try adding as transitive dependency constraint
          if (!directUpdateSuccess) {
            logger.info(`🔄 Direct update failed, trying transitive dependency constraint for ${fix.dependencyName}`);
            
            // Only add constraints for dependencies that are likely transitive
            // (not found in any parsed files but may exist in dependency tree)
            const isDependencyInParsedFiles = allParsingResults.some(result => {
              if (!result.modification) return false;
              
              // Check dependencies based on file type
              if (result.fileType === 'gradle') {
                const gradleMod = result.modification as any;
                return gradleMod.dependencies && gradleMod.dependencies.some((dep: any) => 
                  `${dep.group}:${dep.name}` === fix.dependencyName || 
                  dep.name === fix.dependencyName.split(':').pop()
                );
              } else if (result.fileType === 'maven') {
                const mavenMod = result.modification as any;
                return mavenMod.dependencies && mavenMod.dependencies.some((dep: any) => 
                  `${dep.groupId}:${dep.artifactId}` === fix.dependencyName || 
                  dep.artifactId === fix.dependencyName.split(':').pop()
                );
              } else if (result.fileType === 'npm') {
                const npmMod = result.modification as any;
                return npmMod.dependencies && npmMod.dependencies.some((dep: any) => 
                  dep.name === fix.dependencyName
                );
              }
              return false;
            });
            
            if (!isDependencyInParsedFiles) {
              logger.info(`📦 ${fix.dependencyName} not found in parsed files - treating as transitive dependency`);
              directUpdateSuccess = this.gradleParser.addDependencyConstraint(
                gradleMod,
                fix.dependencyName,
                compatibleVersion,
                fix.cveId,
                reason
              );
              
              // Mark as globally processed to prevent Spring Framework compatibility logic from adding duplicates
              if (directUpdateSuccess) {
                globallyProcessed.add(fix.dependencyName);
                logger.info(`✅ Marked ${fix.dependencyName} as globally processed to prevent duplicates`);
              }
            } else {
              logger.warn(`❌ ${fix.dependencyName} exists in parsed files but update failed - skipping constraint to prevent duplicates`);
            }
          }
          break;

        case 'maven':
          const mavenMod = modification as MavenFileModification;
          const compatibleVersionMaven = await this.getCompatibleVersion(fix.dependencyName, fix.currentVersion, fix.recommendedVersion, allParsingResults);
          
          // Generate proper comment with CVE ID and reason
          const reasonMaven = `Security update: ${fix.cveId} - ${fix.description || 'Vulnerability fix'}`;
          
          directUpdateSuccess = this.mavenParser.updateDependencyVersion(
            mavenMod,
            fix.dependencyName,
            fix.currentVersion,
            compatibleVersionMaven,
            fix.cveId,
            reasonMaven
          );
          
          // If direct update failed, try adding to dependency management
          if (!directUpdateSuccess) {
            logger.info(`🔄 Direct update failed, trying dependency management for ${fix.dependencyName}`);
            
            // Only add dependency management for dependencies that are likely transitive
            const isDependencyInParsedFiles = allParsingResults.some(result => {
              if (!result.modification) return false;
              
              if (result.fileType === 'maven') {
                const mavenMod = result.modification as any;
                return mavenMod.dependencies && mavenMod.dependencies.some((dep: any) => 
                  `${dep.groupId}:${dep.artifactId}` === fix.dependencyName
                );
              }
              return false;
            });
            
            if (!isDependencyInParsedFiles) {
              logger.info(`📦 ${fix.dependencyName} not found in parsed files - treating as transitive dependency`);
              const [groupId, artifactId] = fix.dependencyName.includes(':') 
                ? fix.dependencyName.split(':') 
                : ['unknown', fix.dependencyName];
              directUpdateSuccess = this.mavenParser.addDependencyManagement(
                mavenMod,
                groupId,
                artifactId,
                compatibleVersionMaven,
                fix.cveId,
                reasonMaven
              );
            } else {
              logger.warn(`❌ ${fix.dependencyName} exists in parsed files but update failed - skipping dependency management to prevent duplicates`);
            }
          }
          break;

        case 'npm':
          const npmMod = modification as NpmFileModification;
          const compatibleVersionNpm = await this.getCompatibleVersion(fix.dependencyName, fix.currentVersion, fix.recommendedVersion, allParsingResults);
          
          // Generate proper comment with CVE ID and reason
          const reasonNpm = `Security update: ${fix.cveId} - ${fix.description || 'Vulnerability fix'}`;
          
          directUpdateSuccess = this.npmParser.updateDependencyVersion(
            npmMod,
            fix.dependencyName,
            fix.currentVersion,
            compatibleVersionNpm,
            fix.cveId,
            reasonNpm
          );
          
          // If direct update failed, try adding npm override
          if (!directUpdateSuccess) {
            logger.info(`🔄 Direct update failed, trying npm override for ${fix.dependencyName}`);
            
            // Only add overrides for dependencies that are likely transitive
            const isDependencyInParsedFiles = allParsingResults.some(result => {
              if (!result.modification) return false;
              
              if (result.fileType === 'npm') {
                const npmMod = result.modification as any;
                return npmMod.dependencies && npmMod.dependencies.some((dep: any) => 
                  dep.name === fix.dependencyName
                );
              }
              return false;
            });
            
            if (!isDependencyInParsedFiles) {
              logger.info(`📦 ${fix.dependencyName} not found in parsed files - treating as transitive dependency`);
              directUpdateSuccess = this.npmParser.addNpmOverride(
                npmMod,
                fix.dependencyName,
                compatibleVersionNpm,
                fix.cveId,
                reasonNpm
              );
            } else {
              logger.warn(`❌ ${fix.dependencyName} exists in parsed files but update failed - skipping override to prevent duplicates`);
            }
          }
          break;

        default:
          logger.warn(`❌ Unsupported file type for fix: ${fileType}`);
          return false;
      }

      if (directUpdateSuccess) {
        logger.info(`✅ Successfully applied fix for ${fix.dependencyName} in ${parsingResult.filePath}`);
      } else {
        logger.warn(`❌ All update strategies failed for ${fix.dependencyName} in ${parsingResult.filePath}`);
      }

      return directUpdateSuccess;
    } catch (error) {
      logger.error(`❌ Failed to apply fix for ${fix.dependencyName}:`, error);
      return false;
    }
  }

  /**
   * Write modified files back to disk
   */
  async writeModifiedFiles(parsingResults: FileParsingResult[]): Promise<{ written: number; errors: string[] }> {
    logger.info(`💾 Writing modified files to disk`);
    
    let written = 0;
    const errors: string[] = [];

    for (const result of parsingResults) {
      if (!result.applied || !result.modification) {
        continue;
      }

      try {
        let modifiedContent: string;

        switch (result.fileType) {
          case 'gradle':
            modifiedContent = this.gradleParser.getModifiedContent(result.modification as GradleFileModification);
            break;
          case 'maven':
            modifiedContent = this.mavenParser.getModifiedContent(result.modification as MavenFileModification);
            break;
          case 'npm':
            modifiedContent = this.npmParser.getModifiedContent(result.modification as NpmFileModification);
            break;
          default:
            throw new Error(`Unsupported file type: ${result.fileType}`);
        }

        await fs.writeFile(result.filePath, modifiedContent, 'utf-8');
        logger.info(`✅ Written ${result.filePath}`);
        written++;
      } catch (error) {
        const errorMsg = `Failed to write ${result.filePath}: ${error}`;
        logger.error(errorMsg);
        errors.push(errorMsg);
      }
    }

    logger.info(`💾 Written ${written} files successfully`);
    return { written, errors };
  }

  /**
   * Validate modified files before writing to disk
   */
  async validateModifiedFiles(parsingResults: FileParsingResult[]): Promise<{ valid: boolean; errors: string[] }> {
    logger.info(`🔍 Validating ${parsingResults.length} modified files...`);
    
    const errors: string[] = [];
    
    for (const result of parsingResults) {
      if (!result.applied || !result.modification) {
        continue;
      }

      try {
        logger.info(`✅ Validating ${result.filePath} (${result.fileType})`);
        
        switch (result.fileType) {
          case 'gradle':
            // Gradle files are Groovy/Kotlin - basic syntax checking
            const gradleContent = this.gradleParser.getModifiedContent(result.modification as GradleFileModification);
            if (!this.validateGradleFile(gradleContent)) {
              errors.push(`Invalid Gradle syntax in ${result.filePath}`);
            }
            break;

          case 'maven':
            // Maven files are XML - validate XML structure
            const mavenContent = this.mavenParser.getModifiedContent(result.modification as MavenFileModification);
            if (!this.validateMavenFile(mavenContent)) {
              errors.push(`Invalid Maven POM XML in ${result.filePath}`);
            }
            break;

          case 'npm':
            // npm files are JSON - validate JSON structure
            const npmValidation = this.npmParser.validate(result.modification as NpmFileModification);
            if (!npmValidation.valid) {
              errors.push(`Invalid package.json in ${result.filePath}: ${npmValidation.errors.join(', ')}`);
            }
            break;

          default:
            logger.warn(`❓ Unknown file type for validation: ${result.fileType}`);
        }
      } catch (error) {
        const errorMsg = `Validation failed for ${result.filePath}: ${error}`;
        logger.error(errorMsg);
        errors.push(errorMsg);
      }
    }

    const isValid = errors.length === 0;
    
    if (isValid) {
      logger.info(`✅ All ${parsingResults.filter(r => r.applied).length} modified files passed validation`);
    } else {
      logger.error(`❌ ${errors.length} files failed validation:`, errors);
    }

    return {
      valid: isValid,
      errors
    };
  }

  /**
   * Basic Gradle file validation
   */
  private validateGradleFile(content: string): boolean {
    try {
      // Basic syntax checks for Gradle files
      const lines = content.split('\n');
      let braceCount = 0;
      let parenCount = 0;
      let inString = false;
      let stringChar = '';

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        for (let j = 0; j < line.length; j++) {
          const char = line[j];
          const prevChar = j > 0 ? line[j - 1] : '';
          
          // Handle string literals
          if ((char === '"' || char === "'") && prevChar !== '\\') {
            if (!inString) {
              inString = true;
              stringChar = char;
            } else if (char === stringChar) {
              inString = false;
              stringChar = '';
            }
          }
          
          // Count braces and parentheses outside of strings
          if (!inString) {
            if (char === '{') braceCount++;
            else if (char === '}') braceCount--;
            else if (char === '(') parenCount++;
            else if (char === ')') parenCount--;
          }
        }
      }

      // Check for balanced braces and parentheses
      if (braceCount !== 0) {
        logger.warn(`❌ Gradle validation failed: Unbalanced braces (${braceCount})`);
        return false;
      }
      
      if (parenCount !== 0) {
        logger.warn(`❌ Gradle validation failed: Unbalanced parentheses (${parenCount})`);
        return false;
      }

      // Check for required sections
      if (!content.includes('dependencies')) {
        logger.warn(`❌ Gradle validation failed: No dependencies block found`);
        return false;
      }

      logger.info(`✅ Gradle file validation passed`);
      return true;
    } catch (error) {
      logger.error(`❌ Gradle validation error:`, error);
      return false;
    }
  }

  /**
   * Maven POM XML validation
   */
  private validateMavenFile(content: string): boolean {
    try {
      // Simplified Maven validation - just check for basic structure
      // The complex XML parsing was causing false positives with Maven's complex structure
      
      // Check for required Maven elements with regex pattern to handle attributes
      const projectTagPattern = /<project[^>]*>/;
      if (!projectTagPattern.test(content)) {
        logger.warn(`❌ Maven validation failed: No <project> root element`);
        return false;
      }

      if (!content.includes('</project>')) {
        logger.warn(`❌ Maven validation failed: No closing </project> tag`);
        return false;
      }

      // Basic XML well-formedness check - count opening and closing tags
      const openProjectTags = (content.match(/<project/g) || []).length;
      const closeProjectTags = (content.match(/<\/project>/g) || []).length;
      
      if (openProjectTags !== closeProjectTags) {
        logger.warn(`❌ Maven validation failed: Mismatched project tags - ${openProjectTags} opening, ${closeProjectTags} closing`);
        return false;
      }

      // Check for basic XML structure
      const openTags = (content.match(/<[^/!?][^>]*>/g) || []).length;
      const closeTags = (content.match(/<\/[^>]+>/g) || []).length;
      
      // Allow some tolerance for self-closing tags and other XML constructs
      if (Math.abs(openTags - closeTags) > 10) {
        logger.warn(`❌ Maven validation failed: Too many mismatched tags - ${openTags} opening, ${closeTags} closing`);
        return false;
      }

      logger.info(`✅ Maven POM validation passed`);
      return true;
    } catch (error) {
      logger.error(`❌ Maven validation error:`, error);
      return false;
    }
  }

  /**
   * Generate comprehensive summary of all changes
   */
  generateChangesSummary(parsingResults: FileParsingResult[]): string {
    const summaries: string[] = [];
    let totalFixes = 0;

    for (const result of parsingResults) {
      if (result.applied && result.modification) {
        let summary: string;

        switch (result.fileType) {
          case 'gradle':
            summary = this.gradleParser.getChangesSummary(result.modification as GradleFileModification);
            break;
          case 'maven':
            summary = this.mavenParser.getChangesSummary(result.modification as MavenFileModification);
            break;
          case 'npm':
            summary = this.npmParser.getChangesSummary(result.modification as NpmFileModification);
            break;
          default:
            summary = `Changes made to ${result.filePath}:\n• Unknown file type modifications`;
        }

        summaries.push(summary);
        totalFixes += result.fixes.length;
      }
    }

    const header = `🔧 Applied ${totalFixes} security vulnerability fixes across ${summaries.length} files:\n\n`;
    return header + summaries.join('\n\n');
  }

  /**
   * Generate build validation commands
   */
  generateBuildCommands(parsingResults: FileParsingResult[]): string[] {
    const commands: string[] = [];
    const fileTypes = new Set(parsingResults.filter(r => r.applied).map(r => r.fileType));

    for (const fileType of fileTypes) {
      switch (fileType) {
        case 'gradle':
          // Note: Avoid './gradlew build' as it generates .class files that pollute Git
          commands.push('./gradlew dependencies --refresh-dependencies');
          break;
        case 'maven':
          commands.push('mvn clean verify -U');
          break;
        case 'npm':
          // Get specific npm commands from files if available
          const npmResults = parsingResults.filter(r => r.fileType === 'npm' && r.applied);
          for (const npmResult of npmResults) {
            const npmMod = npmResult.modification as NpmFileModification;
            const installCmd = this.npmParser.getNpmInstallCommand(npmMod);
            if (installCmd) {
              commands.push(installCmd);
            }
          }
          if (npmResults.length > 0 && !commands.some(cmd => cmd.includes('npm'))) {
            commands.push('npm install && npm run build');
          }
          break;
      }
    }

    return commands;
  }

  /**
   * Detect Java version from project configuration
   */
  public async detectJavaVersion(parsingResults: FileParsingResult[]): Promise<number> {
    logger.info(`🔍 Detecting Java version from ${parsingResults.length} parsing results...`);
    
    // PRIORITY 1: Check for Dockerfiles first (most reliable for runtime environment)
    logger.info(`🐳 Priority 1: Checking Dockerfiles for Java version...`);
    const javaVersionFromDocker = await this.detectJavaVersionFromDocker(parsingResults);
    if (javaVersionFromDocker) {
      logger.info(`✅ Java version detected from Docker: ${javaVersionFromDocker}`);
      return javaVersionFromDocker;
    }

    // PRIORITY 2: Check version-specific files (.java-version, .sdkmanrc, etc.)
    logger.info(`📄 Priority 2: Checking version files...`);
    const javaVersionFromFiles = await this.detectJavaVersionFromVersionFiles(parsingResults);
    if (javaVersionFromFiles) {
      logger.info(`✅ Java version detected from version files: ${javaVersionFromFiles}`);
      return javaVersionFromFiles;
    }

    // PRIORITY 3: Check build files (Gradle/Maven)
    logger.info(`🔧 Priority 3: Checking build files...`);
    
    // Check Gradle files for Java version
    for (const result of parsingResults) {
      if (result.fileType === 'gradle' && result.modification) {
        const content = (result.modification as any).content || '';
        logger.info(`🔍 Checking Gradle file: ${result.filePath}`);
        
        // Check for sourceCompatibility or targetCompatibility
        const sourceCompatMatch = content.match(/sourceCompatibility\s*=\s*['"]?(\d+)['"]?/);
        if (sourceCompatMatch) {
          const version = parseInt(sourceCompatMatch[1]);
          logger.info(`✅ Detected Java version from sourceCompatibility: ${version}`);
          return version;
        }
        
        const targetCompatMatch = content.match(/targetCompatibility\s*=\s*['"]?(\d+)['"]?/);
        if (targetCompatMatch) {
          const version = parseInt(targetCompatMatch[1]);
          logger.info(`✅ Detected Java version from targetCompatibility: ${version}`);
          return version;
        }

        // Check for JavaVersion enum usage
        const javaVersionMatch = content.match(/JavaVersion\.VERSION_(\d+)/);
        if (javaVersionMatch) {
          const version = parseInt(javaVersionMatch[1]);
          logger.info(`✅ Detected Java version from JavaVersion enum: ${version}`);
          return version;
        }

        // Check for toolchain specification
        const toolchainMatch = content.match(/languageVersion\s*=\s*JavaLanguageVersion\.of\((\d+)\)/);
        if (toolchainMatch) {
          const version = parseInt(toolchainMatch[1]);
          logger.info(`✅ Detected Java version from toolchain: ${version}`);
          return version;
        }

        // Check for release flag in Gradle
        const releaseMatch = content.match(/--release[=\s](\d+)/);
        if (releaseMatch) {
          const version = parseInt(releaseMatch[1]);
          logger.info(`✅ Detected Java version from --release flag: ${version}`);
          return version;
        }

        // Check for Docker FROM statements in docker.gradle files (Gradle Docker plugin)
        if (result.filePath.includes('docker.gradle') || result.filePath.includes('Docker.gradle')) {
          logger.info(`🐳 Checking docker.gradle file for Java version: ${result.filePath}`);
          const fromMatches = content.match(/from\s+['"]([^'"]+)['"]/gi);
          if (fromMatches) {
            for (const fromMatch of fromMatches) {
              const imageMatch = fromMatch.match(/from\s+['"]([^'"]+)['"]/i);
              if (imageMatch) {
                const imageName = imageMatch[1];
                logger.info(`🔍 Found Docker image in gradle file: ${imageName}`);
                const version = this.extractJavaVersionFromDockerImage(`FROM ${imageName}`);
                if (version) {
                  logger.info(`✅ Detected Java version from docker.gradle file: ${version}`);
                  return version;
                }
              }
            }
          }
        }
      }
      
      // Check Maven files for Java version
      if (result.fileType === 'maven' && result.modification) {
        const content = (result.modification as any).content || '';
        logger.info(`🔍 Checking Maven file: ${result.filePath}`);
        
        // Check for maven.compiler.source/target
        const compilerSourceMatch = content.match(/<maven\.compiler\.source>(\d+)<\/maven\.compiler\.source>/);
        if (compilerSourceMatch) {
          const version = parseInt(compilerSourceMatch[1]);
          logger.info(`✅ Detected Java version from maven.compiler.source: ${version}`);
          return version;
        }
        
        const compilerTargetMatch = content.match(/<maven\.compiler\.target>(\d+)<\/maven\.compiler\.target>/);
        if (compilerTargetMatch) {
          const version = parseInt(compilerTargetMatch[1]);
          logger.info(`✅ Detected Java version from maven.compiler.target: ${version}`);
          return version;
        }

        // Check for java.version property
        const javaVersionMatch = content.match(/<java\.version>(\d+)<\/java\.version>/);
        if (javaVersionMatch) {
          const version = parseInt(javaVersionMatch[1]);
          logger.info(`✅ Detected Java version from java.version property: ${version}`);
          return version;
        }

        // Check for maven-compiler-plugin configuration
        const compilerPluginMatch = content.match(/<source>(\d+)<\/source>/);
        if (compilerPluginMatch) {
          const version = parseInt(compilerPluginMatch[1]);
          logger.info(`✅ Detected Java version from maven-compiler-plugin source: ${version}`);
          return version;
        }

        const compilerPluginTargetMatch = content.match(/<target>(\d+)<\/target>/);
        if (compilerPluginTargetMatch) {
          const version = parseInt(compilerPluginTargetMatch[1]);
          logger.info(`✅ Detected Java version from maven-compiler-plugin target: ${version}`);
          return version;
        }

        // Check for release configuration
        const releaseMatch = content.match(/<release>(\d+)<\/release>/);
        if (releaseMatch) {
          const version = parseInt(releaseMatch[1]);
          logger.info(`✅ Detected Java version from maven-compiler-plugin release: ${version}`);
          return version;
        }
      }
    }

    // Default to Java 17 if not detected (modern default)
    logger.warn(`⚠️ Could not detect Java version from project files, defaulting to Java 17`);
    return 17;
  }

  /**
   * Detect Java version from Dockerfile base images
   */
  private async detectJavaVersionFromDocker(parsingResults: FileParsingResult[]): Promise<number | null> {
    
    for (const result of parsingResults) {
      if (!result || !result.modification) {
        continue;
      }

      // Check if this is a Docker file
      if (result.fileType === 'docker' && 'content' in result.modification) {
        const content = (result.modification as DockerFileModification).content;
        logger.info(`🐳 Analyzing Dockerfile: ${result.filePath}`);
        
        // Parse FROM statements for Java base images
        const fromStatements = content.match(/FROM\s+([^\s\n]+)/gi);
        if (fromStatements) {
          for (const fromStatement of fromStatements) {
            const version = this.extractJavaVersionFromDockerImage(fromStatement);
            if (version) {
              logger.info(`🔍 Detected Java version from Dockerfile base image: ${version}`);
              return version;
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Extract Java version from Docker image names
   */
  public extractJavaVersionFromDockerImage(fromStatement: string): number | null {
    const imageName = fromStatement.replace(/FROM\s+/i, '').trim();
    logger.info(`🔍 Analyzing Docker image: ${imageName}`);

    // Common Java base image patterns
    const javaImagePatterns = [
      // OpenJDK official images
      /openjdk:(\d+)/i,
      /openjdk:(\d+)-/i,
      /openjdk:(\d+)\./i,
      
      // Eclipse Temurin (AdoptOpenJDK successor)
      /eclipse-temurin:(\d+)/i,
      /eclipse-temurin:(\d+)-/i,
      /eclipse-temurin:(\d+)\./i,
      
      // AdoptOpenJDK (legacy)
      /adoptopenjdk:(\d+)/i,
      /adoptopenjdk\/openjdk(\d+)/i,
      
      // Amazon Corretto
      /amazoncorretto:(\d+)/i,
      /amazon\/corretto:(\d+)/i,
      
      // Azul Zulu
      /azul\/zulu-openjdk:(\d+)/i,
      /zulu:(\d+)/i,
      
      // Red Hat OpenJDK
      /registry\.redhat\.io\/ubi8\/openjdk-(\d+)/i,
      /registry\.access\.redhat\.com\/ubi8\/openjdk-(\d+)/i,
      
      // Google Distroless
      /gcr\.io\/distroless\/java:(\d+)/i,
      /gcr\.io\/distroless\/java(\d+)/i,
      
      // Generic java patterns
      /java:(\d+)/i,
      /java(\d+)/i,
      /jdk(\d+)/i,
      /jre(\d+)/i,
      
      // Multi-stage patterns with Java
      /java.*:(\d+)/i,
      /jdk.*:(\d+)/i
    ];

    for (const pattern of javaImagePatterns) {
      const match = imageName.match(pattern);
      if (match && match[1]) {
        const version = parseInt(match[1]);
        if (version >= 8 && version <= 21) { // Reasonable Java version range
          return version;
        }
      }
    }

    return null;
  }

  /**
   * Detect Java version from version-specific files
   */
  private async detectJavaVersionFromVersionFiles(parsingResults: FileParsingResult[]): Promise<number | null> {
    
    for (const result of parsingResults) {
      if (!result || !result.modification) {
        continue;
      }

      // Check if this is a version file
      if (result.fileType === 'version' && 'content' in result.modification) {
        const content = (result.modification as VersionFileModification).content;
        const fileName = result.filePath.split('/').pop() || '';
        logger.info(`📄 Analyzing version file: ${result.filePath}`);
        
        // .java-version file (simple version number)
        if (fileName === '.java-version') {
          const versionMatch = content.match(/(\d+)/);
          if (versionMatch) {
            const version = parseInt(versionMatch[1]);
            logger.info(`🔍 Detected Java version from .java-version: ${version}`);
            return version;
          }
        }
        
        // .sdkmanrc file (SDKMAN format)
        if (fileName === '.sdkmanrc') {
          const sdkmanMatch = content.match(/java=(\d+)/);
          if (sdkmanMatch) {
            const version = parseInt(sdkmanMatch[1]);
            logger.info(`🔍 Detected Java version from .sdkmanrc: ${version}`);
            return version;
          }
        }
        
        // .tool-versions file (asdf format)
        if (fileName === '.tool-versions') {
          const asdfMatch = content.match(/java\s+(\d+)/);
          if (asdfMatch) {
            const version = parseInt(asdfMatch[1]);
            logger.info(`🔍 Detected Java version from .tool-versions: ${version}`);
            return version;
          }
        }
        
        // runtime.txt (Heroku format)
        if (fileName === 'runtime.txt') {
          const herokuMatch = content.match(/java-(\d+)/);
          if (herokuMatch) {
            const version = parseInt(herokuMatch[1]);
            logger.info(`🔍 Detected Java version from runtime.txt: ${version}`);
            return version;
          }
        }
      }
    }
    
    return null;
  }

  /**
   * Detect Spring Boot version from project configuration
   */
  public async detectSpringBootVersion(parsingResults: FileParsingResult[]): Promise<string | null> {
    logger.info(`🔍 Detecting Spring Boot version from project configuration...`);
    
    // Check Gradle files for Spring Boot version
    for (const result of parsingResults) {
      if (result.fileType === 'gradle' && result.modification) {
        const content = (result.modification as any).content || '';
        
        // Check for springBootVersion variable
        const springBootVersionMatch = content.match(/springBootVersion\s*=\s*['"]([^'"]+)['"]/);
        if (springBootVersionMatch) {
          const version = springBootVersionMatch[1];
          logger.info(`🔍 Detected Spring Boot version from springBootVersion variable: ${version}`);
          return version;
        }
        
        // Check for spring-boot plugin version
        const pluginVersionMatch = content.match(/id\s+['"]org\.springframework\.boot['"].*version\s+['"]([^'"]+)['"]/);
        if (pluginVersionMatch) {
          const version = pluginVersionMatch[1];
          logger.info(`🔍 Detected Spring Boot version from plugin: ${version}`);
          return version;
        }
        
        // Check for spring-boot-starter dependency version
        const starterVersionMatch = content.match(/['"]org\.springframework\.boot:spring-boot-starter[^:]*:([^'"]+)['"]/);
        if (starterVersionMatch) {
          const version = starterVersionMatch[1];
          logger.info(`🔍 Detected Spring Boot version from starter dependency: ${version}`);
          return version;
        }
      }
      
      // Check Maven files for Spring Boot version
      if (result.fileType === 'maven' && result.modification) {
        const content = (result.modification as any).content || '';
        
        // Check for spring-boot-starter-parent version
        const parentVersionMatch = content.match(/<artifactId>spring-boot-starter-parent<\/artifactId>\s*<version>([^<]+)<\/version>/);
        if (parentVersionMatch) {
          const version = parentVersionMatch[1];
          logger.info(`🔍 Detected Spring Boot version from parent: ${version}`);
          return version;
        }
        
        // Check for spring.boot.version property
        const propertyVersionMatch = content.match(/<spring\.boot\.version>([^<]+)<\/spring\.boot\.version>/);
        if (propertyVersionMatch) {
          const version = propertyVersionMatch[1];
          logger.info(`🔍 Detected Spring Boot version from property: ${version}`);
          return version;
        }
        
        // Check for spring-boot-starter dependency version
        const dependencyVersionMatch = content.match(/<groupId>org\.springframework\.boot<\/groupId>\s*<artifactId>spring-boot-starter[^<]*<\/artifactId>\s*<version>([^<]+)<\/version>/);
        if (dependencyVersionMatch) {
          const version = dependencyVersionMatch[1];
          logger.info(`🔍 Detected Spring Boot version from dependency: ${version}`);
          return version;
        }
      }
    }

    logger.warn(`⚠️ Could not detect Spring Boot version from project files`);
    return null;
  }

  /**
   * Get version ranges compatible with detected Java version
   */
  private getCompatibleVersionRanges(javaVersion: number): { [key: string]: string } {
    logger.info(`🎯 Getting compatible version ranges for Java ${javaVersion}`);
    
    if (javaVersion >= 17) {
      // Java 17+ can use latest versions
      return {
        'org.springframework.boot': '3.x',
        'org.springframework.security': '6.x',
        'org.springframework': '6.x',
        'ch.qos.logback': '1.4.x'  // Logback 1.4.x for Java 17+
      };
    } else if (javaVersion >= 11) {
      // Java 11 compatible versions - now supports Spring Boot 3.x + Spring Security 6.x
      return {
        'org.springframework.boot': '3.x',        // Java 11 supports Spring Boot 3.x
        'org.springframework.security': '6.x',   // Allow Spring Security 6.x for CVE fixes  
        'org.springframework': '6.x',             // Allow Spring 6.x
        'ch.qos.logback': '1.4.x'                // Logback 1.4.x for Spring Boot 3.x
      };
    } else {
      // Java 8 compatible versions
      return {
        'org.springframework.boot': '2.6.x',      // Java 8 compatible
        'org.springframework.security': '5.6.x', // Java 8 compatible
        'org.springframework': '5.3.x',           // Java 8 compatible
        'ch.qos.logback': '1.2.x'                // Logback 1.2.x for Java 8
      };
    }
  }

  /**
   * Get available versions for specific dependencies from internal Artifactory
   */
  private getAvailableVersions(dependencyName: string): string[] {
    // Based on internal Artifactory availability - update these lists as needed
    const availableVersions: { [key: string]: string[] } = {
      'org.springframework.security:spring-security-web': ['5.6.10', '5.6.1', '6.1.1', '6.5.2'],
      'org.springframework.security:spring-security-core': ['5.6.10', '5.6.1', '6.1.1', '6.5.2'],
      'org.springframework:spring-web': ['5.3.32', '6.0.10', '6.1.1'],
      'org.springframework:spring-webmvc': ['5.3.32', '6.0.10', '6.1.1'],
      'org.springframework:spring-core': ['5.3.18', '5.3.32', '6.0.10', '6.1.1'],
      'org.springframework:spring-beans': ['5.3.18', '5.3.32', '6.0.10', '6.1.1'],
      'org.springframework:spring-expression': ['5.3.18', '5.3.32', '6.0.10', '6.1.1'],
      'org.yaml:snakeyaml': ['1.33', '2.0', '2.2'],
      'ch.qos.logback:logback-core': ['1.2.12', '1.4.14', '1.5.6'],
      'ch.qos.logback:logback-classic': ['1.2.12', '1.4.14', '1.5.6'],
      'com.fasterxml.jackson.core:jackson-databind': ['2.12.7.1', '2.15.2', '2.17.1'],
      'org.apache.tomcat.embed:tomcat-embed-core': ['8.5.96', '9.0.106', '10.1.30'],
      'commons-io:commons-io': ['2.11.0', '2.14.0', '2.16.1']
    };
    
    return availableVersions[dependencyName] || [];
  }

  /**
   * Resolve the most compatible version within the allowed range
   */
  private resolveCompatibleVersion(dependencyName: string, currentVersion: string, recommendedVersion: string, versionRanges: { [key: string]: string }): string {
    // Extract the base dependency name (remove specific artifacts)
    const baseName = this.getBaseDependencyName(dependencyName);
    const javaCompatibilityRange = versionRanges[baseName];
    
    if (!javaCompatibilityRange) {
      // No compatibility constraint, but still check if recommended version is available
      const availableVersions = this.getAvailableVersions(dependencyName);
      if (availableVersions.length > 0 && availableVersions.includes(recommendedVersion)) {
        logger.info(`🔍 No Java compatibility constraint for ${dependencyName}, using recommended: ${recommendedVersion}`);
        return recommendedVersion;
      } else if (availableVersions.length > 0) {
        // Use highest available version
        const sortedVersions = this.sortVersions(availableVersions);
        const highestVersion = sortedVersions[sortedVersions.length - 1];
        logger.info(`🔍 No Java compatibility constraint for ${dependencyName}, but recommended ${recommendedVersion} not available. Using highest available: ${highestVersion}`);
        return highestVersion;
      } else {
        // No available versions defined, use recommended
        logger.info(`🔍 No Java compatibility constraint for ${dependencyName}, using recommended: ${recommendedVersion}`);
        return recommendedVersion;
      }
    }
    
    logger.info(`🔍 Resolving compatible version for ${baseName}`);
    logger.info(`📝 Current: ${currentVersion}, Recommended: ${recommendedVersion}, Range: ${javaCompatibilityRange}`);
    
    // Special handling for Logback to ensure Spring Boot compatibility
    if (baseName === 'ch.qos.logback') {
      // Force Logback to use 1.2.x series for all Spring Boot 2.x projects
      const logbackVersion = javaCompatibilityRange === '1.2.x' ? '1.2.12' : 
                             javaCompatibilityRange === '1.4.x' ? '1.4.12' : '1.2.12';
      logger.info(`🔧 Using Spring Boot compatible Logback version: ${logbackVersion}`);
      return logbackVersion;
    }
    
    // Parse the range - support both "6.x" (major only) and "6.1.x" (major.minor) formats
    const majorOnlyMatch = javaCompatibilityRange.match(/^(\d+)\.x$/);
    const majorMinorMatch = javaCompatibilityRange.match(/^(\d+)\.(\d+)\.x$/);
    
    if (!majorOnlyMatch && !majorMinorMatch) {
      logger.warn(`⚠️ Invalid range format: ${javaCompatibilityRange}, using recommended: ${recommendedVersion}`);
      return recommendedVersion;
    }
    
    // Parse recommended version
    const recMatch = recommendedVersion.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!recMatch) {
      logger.warn(`⚠️ Invalid recommended version format: ${recommendedVersion}`);
      return recommendedVersion;
    }
    
    const [, recMajorStr, recMinorStr, recPatchStr] = recMatch;
    const recMajor = parseInt(recMajorStr);
    const recMinor = parseInt(recMinorStr);
    const recPatch = parseInt(recPatchStr);
    
    if (majorOnlyMatch) {
      // Major-only range (e.g., "6.x") - any 6.y.z version is acceptable
      const [, rangeMajorStr] = majorOnlyMatch;
      const rangeMajor = parseInt(rangeMajorStr);
      
      if (recMajor === rangeMajor) {
        // Check if recommended version is available in Artifactory
        const availableVersions = this.getAvailableVersions(dependencyName);
        if (availableVersions.includes(recommendedVersion)) {
          logger.info(`✅ Recommended version ${recommendedVersion} is within major range ${javaCompatibilityRange} and available in Artifactory`);
          return recommendedVersion;
        }
      }
      
      // Find highest available version in the major range
      const availableVersions = this.getAvailableVersions(dependencyName);
      const compatibleVersions = availableVersions.filter(version => {
        const vMajor = parseInt(version.split('.')[0]);
        return vMajor === rangeMajor;
      });
      
      if (compatibleVersions.length > 0) {
        const sortedVersions = this.sortVersions(compatibleVersions);
        const compatibleVersion = sortedVersions[sortedVersions.length - 1];
        logger.info(`🔧 Using highest available major-range-compatible version: ${compatibleVersion}`);
        logger.info(`📋 Available versions in major range ${rangeMajor}.x: ${compatibleVersions.join(', ')}`);
        return compatibleVersion;
      } else {
        // Use a default compatible version in the major range
        const compatibleVersion = `${rangeMajor}.1.8`;
        logger.info(`🔧 Using fallback major-range-compatible version: ${compatibleVersion}`);
        return compatibleVersion;
      }
    } else if (majorMinorMatch) {
      // Major.minor range (e.g., "6.1.x") - only 6.1.z versions are acceptable
      const [, rangeMajorStr, rangeMinorStr] = majorMinorMatch;
      const rangeMajor = parseInt(rangeMajorStr);
      const rangeMinor = parseInt(rangeMinorStr);
      
      if (recMajor === rangeMajor && recMinor === rangeMinor) {
        // Check if recommended version is available in Artifactory
        const availableVersions = this.getAvailableVersions(dependencyName);
        if (availableVersions.includes(recommendedVersion)) {
          logger.info(`✅ Recommended version ${recommendedVersion} is within range ${javaCompatibilityRange} and available in Artifactory`);
          return recommendedVersion;
        }
      }
      
      // Find highest available version in the major.minor range
      const availableVersions = this.getAvailableVersions(dependencyName);
      const compatibleVersions = availableVersions.filter(version => {
        const versionParts = version.split('.');
        const vMajor = parseInt(versionParts[0]);
        const vMinor = parseInt(versionParts[1]);
        return vMajor === rangeMajor && vMinor === rangeMinor;
      });
      
      if (compatibleVersions.length > 0) {
        const sortedVersions = this.sortVersions(compatibleVersions);
        const compatibleVersion = sortedVersions[sortedVersions.length - 1];
        logger.info(`🔧 Using highest available range-compatible version: ${compatibleVersion}`);
        logger.info(`📋 Available versions in range ${rangeMajor}.${rangeMinor}.x: ${compatibleVersions.join(', ')}`);
        return compatibleVersion;
      } else {
        // Use the latest patch version in the allowed range as fallback
        const compatibleVersion = `${rangeMajor}.${rangeMinor}.10`;
        logger.info(`🔧 Using fallback range-compatible version: ${compatibleVersion}`);
        return compatibleVersion;
      }
    }
    
    // Fallback - should not reach here
    logger.warn(`⚠️ Unexpected path in version resolution, using recommended: ${recommendedVersion}`);
    return recommendedVersion;
  }

  /**
   * Sort versions in ascending order (lowest to highest)
   */
  private sortVersions(versions: string[]): string[] {
    return versions.sort((a, b) => {
      const aParts = a.split('.').map(Number);
      const bParts = b.split('.').map(Number);
      
      for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const aDiff = (aParts[i] || 0) - (bParts[i] || 0);
        if (aDiff !== 0) return aDiff;
      }
      return 0;
    });
  }

  /**
   * Extract base dependency name for compatibility mapping
   */
  private getBaseDependencyName(dependencyName: string): string {
    if (dependencyName.startsWith('org.springframework.boot:')) return 'org.springframework.boot';
    if (dependencyName.startsWith('org.springframework.security:')) return 'org.springframework.security';
    if (dependencyName.startsWith('org.springframework:')) return 'org.springframework';
    return dependencyName;
  }

  /**
   * Check if version is within specified range
   */
  private isVersionInRange(version: string, range: string): boolean {
    const versionMajor = parseInt(version.split('.')[0]);
    
    if (range === '2.7.x') return versionMajor === 2;
    if (range === '2.6.x') return versionMajor === 2;
    if (range === '3.x') return versionMajor === 3;
    if (range === '5.8.x') return versionMajor === 5;
    if (range === '5.6.x') return versionMajor === 5;
    if (range === '5.3.x') return versionMajor === 5;
    if (range === '6.x') return versionMajor === 6;
    
    return false;
  }

  /**
   * Get latest known version in specified range
   */
  private getLatestVersionInRange(baseName: string, range: string): string | null {
    const versionDatabase: { [key: string]: { [key: string]: string } } = {
      'org.springframework.boot': {
        '2.7.x': '2.7.18',
        '2.6.x': '2.6.15',
        '3.x': '3.3.11'
      },
      'org.springframework.security': {
        '5.8.x': '5.8.13',
        '5.6.x': '5.6.12', 
        '6.x': '6.1.8'
      },
      'org.springframework': {
        '5.3.x': '5.3.39',
        '6.x': '6.1.14'
      }
    };

    return versionDatabase[baseName]?.[range] || null;
  }

  /**
   * Get compatible version for a dependency based on project constraints
   */
  private async getCompatibleVersion(
    dependencyName: string, 
    currentVersion: string, 
    recommendedVersion: string, 
    parsingResults: FileParsingResult[]
  ): Promise<string> {
    
    // Special handling for Logback - it's often tightly coupled with Spring Boot version
    if (dependencyName.includes('logback')) {
      logger.info(`🔍 Special handling for Logback dependency: ${dependencyName}`);
      
      // For Java 11 projects, use a conservative Logback version that's known to work
      const javaVersion = await this.detectJavaVersion(parsingResults);
      if (javaVersion && javaVersion <= 11) {
        logger.info(`📦 Using Java 11 compatible Logback version for ${dependencyName}`);
        
        // Use a conservative version that's compatible with older Spring Boot
        if (dependencyName.includes('logback-classic')) {
          return '1.2.12'; // Known good version for Java 11 + Spring Boot 2.x
        } else if (dependencyName.includes('logback-core')) {
          return '1.2.12';
        }
      }
    }
    
    // Get Java version for compatibility checking
    const detectedJavaVersion = await this.detectJavaVersion(parsingResults);
    logger.info(`🔍 Detected Java version: ${detectedJavaVersion}`);
    
    if (!detectedJavaVersion) {
      logger.warn('⚠️ Could not detect Java version, using recommended version');
      return recommendedVersion;
    }
    
    // Get compatible version ranges based on Java version
    const compatibleRanges = this.getCompatibleVersionRanges(detectedJavaVersion);
    
    // Check if this dependency has specific compatibility requirements
    logger.info(`🔍 Checking compatibility for ${dependencyName} (base: ${dependencyName.split(':')[0]})`);
    
    const baseName = dependencyName.split(':')[0];
    if (compatibleRanges[baseName]) {
      const compatibleRange = compatibleRanges[baseName];
      const versionRangesForBaseName = { [baseName]: compatibleRange };
      const resolvedVersion = this.resolveCompatibleVersion(dependencyName, currentVersion, recommendedVersion, versionRangesForBaseName);
      
      logger.info(`📝 Current: ${currentVersion}, Recommended: ${recommendedVersion}, Range: ${compatibleRange}`);
      logger.info(`🔧 Using Java-compatible version for ${dependencyName}: ${recommendedVersion} → ${resolvedVersion}`);
      
      return resolvedVersion;
    }
    
    // Special handling for Spring Framework components - use consistent version from compatibility matrix
    if (dependencyName.startsWith('org.springframework:') || dependencyName.startsWith('org.springframework.security:')) {
      logger.info(`🔧 Special handling for Spring Framework component: ${dependencyName}`);
      
      // Detect current Spring Boot version to determine compatible Spring Framework version
      const springBootVersion = await this.detectSpringBootVersion(parsingResults);
      if (springBootVersion) {
        const compatibleSpringVersion = this.getCompatibleSpringFrameworkVersion(springBootVersion, [recommendedVersion]);
        logger.info(`🎯 Using Spring Framework compatible version: ${compatibleSpringVersion} (Spring Boot: ${springBootVersion})`);
        return compatibleSpringVersion;
      } else {
        logger.warn(`⚠️ Could not detect Spring Boot version, using recommended version for ${dependencyName}`);
      }
    }
    
    logger.info(`✅ Using recommended version for ${dependencyName}: ${recommendedVersion}`);
    return recommendedVersion;
  }

  /**
   * Ensure Spring Boot version consistency across all files
   */
  private async ensureSpringBootVersionConsistency(
    results: FileParsingResult[], 
    fix: VulnerabilityFix, 
    targetVersion: string,
    globallyProcessed?: Set<string>
  ): Promise<void> {
    logger.info(`🔧 Ensuring Spring Boot version consistency across all files to version ${targetVersion}`);
    
    for (const result of results) {
      if (result.modification && result.fileType === 'gradle') {
        const gradleMod = result.modification as any;
        
        // Update Spring Boot version variables first
        if (gradleMod.variables) {
          for (const variable of gradleMod.variables) {
            if (variable.name.toLowerCase().includes('springboot') || 
                variable.name.toLowerCase().includes('spring_boot') ||
                variable.name === 'springBootVersion') {
              
              if (variable.value !== targetVersion) {
                logger.info(`🔄 Updating Spring Boot version variable ${variable.name} from ${variable.value} to ${targetVersion}`);
                
                // Update the variable value
                const lines = gradleMod.content.split('\n');
                const newVariableLine = variable.originalLine.replace(
                  new RegExp(`(['"])${escapeRegExp(variable.value)}(['"])`),
                  `$1${targetVersion}$2`
                );
                
                lines[variable.lineNumber] = newVariableLine;
                gradleMod.content = lines.join('\n');
                
                // Update the variable object
                variable.value = targetVersion;
                variable.originalLine = newVariableLine;
                
                // Track the modification
                gradleMod.modifications = gradleMod.modifications || [];
                gradleMod.modifications.push({
                  type: 'variable',
                  lineNumber: variable.lineNumber,
                  oldLine: variable.originalLine,
                  newLine: newVariableLine,
                  comment: '',
                  cveId: fix.cveId
                });
                
                // Mark this file as applied if not already
                if (!result.applied) {
                  result.applied = true;
                  result.fixes = result.fixes || [];
                }
                
                // Add this fix to the file's fixes
                result.fixes.push(fix);
              }
            }
          }
        }
        
        // Update Spring Boot dependencies to use variables instead of hardcoded versions
        if (gradleMod.dependencies) {
          for (const dep of gradleMod.dependencies) {
            // Check if this is a Spring Boot dependency with a hardcoded version that needs updating
            if (dep.group === 'org.springframework.boot' && 
                dep.version && 
                !dep.version.includes('${') && 
                dep.version !== targetVersion) {
              
              logger.info(`🔄 Updating hardcoded Spring Boot dependency ${dep.group}:${dep.name} from ${dep.version} to use variable`);
              
              // Update the dependency to use the springBootVersion variable instead of hardcoded version
              const success = this.gradleParser.updateDependencyVersion(
                gradleMod,
                `${dep.group}:${dep.name}`,
                dep.version,
                '${springBootVersion}', // Use variable instead of hardcoded version
                fix.cveId,
                `Updated to use centralized Spring Boot version variable for consistency`
              );
              
              if (success) {
                // Mark this file as applied if not already
                if (!result.applied) {
                  result.applied = true;
                  result.fixes = result.fixes || [];
                }
                
                // Add this fix to the file's fixes
                result.fixes.push(fix);
              }
            }
          }
        }
      }
    }
    
    // After updating Spring Boot, ensure Spring Framework components are compatible
    logger.info(`🔧 Ensuring Spring Framework compatibility with Spring Boot ${targetVersion}`);
    await this.updateSpringFrameworkCompatibility(results, targetVersion, fix.cveId, 'Updated for Spring Boot compatibility', globallyProcessed);
        
    // Update Spring Boot plugin versions in the file content
    for (const result of results) {
      if (result.fileType === 'gradle' && result.modification) {
        const gradleMod = result.modification as any;
        const lines = gradleMod.content.split('\n');
        let fileModified = false;
        
        logger.info(`🔍 Scanning file ${path.basename(result.filePath)} for Spring Boot plugin versions...`);
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          
          // Look for Spring Boot plugin version declarations with more flexible matching
          if ((line.includes('org.springframework.boot') || line.includes('spring-boot')) && 
              line.includes('version') && 
              !line.includes('${') &&
              !line.includes('springBootVersion')) {
            
            logger.info(`🔍 Found potential Spring Boot plugin line: "${line.trim()}"`);
            
            // Try multiple version patterns
            const versionPatterns = [
              /version\s*["']([^"']+)["']/,  // version "2.2.13.RELEASE"
              /version\s*[""]([^""]+)[""]/,  // version "2.2.13.RELEASE" (smart quotes)
              /version\s*'([^']+)'/,         // version '2.2.13.RELEASE'
              /version\s*"([^"]+)"/          // version "2.2.13.RELEASE"
            ];
            
            let versionMatch = null;
            for (const pattern of versionPatterns) {
              versionMatch = line.match(pattern);
              if (versionMatch) {
                logger.info(`✅ Matched version pattern: ${versionMatch[1]}`);
                break;
              }
            }
            
            if (versionMatch && versionMatch[1] !== targetVersion) {
              logger.info(`🔄 Updating Spring Boot plugin version from ${versionMatch[1]} to ${targetVersion} on line ${i + 1}`);
              
              // Try to replace with the same quote style as the original
              let newLine = line;
              if (line.includes('"')) {
                newLine = line.replace(
                  new RegExp(`version\\s*[""]${escapeRegExp(versionMatch[1])}[""]`),
                  `version "${targetVersion}"`
                );
              } else if (line.includes("'")) {
                newLine = line.replace(
                  new RegExp(`version\\s*'${escapeRegExp(versionMatch[1])}'`),
                  `version '${targetVersion}'`
                );
              }
              
              if (newLine !== line) {
                lines[i] = newLine;
                fileModified = true;
                
                // Track the modification
                gradleMod.modifications = gradleMod.modifications || [];
                gradleMod.modifications.push({
                  type: 'dependency',
                  lineNumber: i,
                  oldLine: line,
                  newLine: newLine,
                  comment: `Updated Spring Boot plugin version to ${targetVersion}`,
                  cveId: fix.cveId
                });
                
                logger.info(`✅ Updated line ${i + 1}: "${line.trim()}" → "${newLine.trim()}"`);
              }
            }
          }
        }
        
        if (fileModified) {
          gradleMod.content = lines.join('\n');
          
          // Mark this file as applied if not already
          if (!result.applied) {
            result.applied = true;
            result.fixes = result.fixes || [];
          }
          
          // Add this fix to the file's fixes
          result.fixes.push(fix);
        }
      }
    }
  }

  /**
   * Update Spring Boot version variable if needed (for non-Spring Boot Spring dependencies)
   */
  private async updateSpringBootVersionVariableIfNeeded(
    results: FileParsingResult[], 
    fix: VulnerabilityFix
  ): Promise<void> {
    logger.info(`🔍 Checking if Spring Boot version variable needs updating for ${fix.dependencyName}`);
    
    // Find the current Spring Boot version from variables in the project
    let currentSpringBootVersion: string | null = null;
    
    for (const result of results) {
      if (result.modification && result.fileType === 'gradle') {
        const gradleMod = result.modification as any;
        
        if (gradleMod.variables) {
          for (const variable of gradleMod.variables) {
            if (variable.name.toLowerCase().includes('springboot') || 
                variable.name.toLowerCase().includes('spring_boot') ||
                variable.name === 'springBootVersion') {
              currentSpringBootVersion = variable.value;
              logger.info(`📦 Found Spring Boot version variable: ${variable.name} = ${variable.value}`);
              break;
            }
          }
        }
        
        if (currentSpringBootVersion) break;
      }
    }
    
    if (!currentSpringBootVersion) {
      logger.info(`ℹ️ No Spring Boot version variable found, skipping Spring Boot consistency check`);
      return;
    }
    
    // Determine if the Spring Boot version needs to be updated based on the Spring dependency being updated
    const shouldUpdateSpringBoot = this.shouldUpdateSpringBootVersion(fix.dependencyName, fix.recommendedVersion, currentSpringBootVersion);
    
    if (shouldUpdateSpringBoot) {
      const targetSpringBootVersion = this.getCompatibleSpringBootVersion(fix.dependencyName, fix.recommendedVersion);
      logger.info(`🔧 Spring Boot version needs updating from ${currentSpringBootVersion} to ${targetSpringBootVersion} due to ${fix.dependencyName} update`);
      
      // Create a Spring Boot fix to trigger the consistency update
      const springBootFix: VulnerabilityFix = {
        ...fix,
        dependencyName: 'org.springframework.boot:spring-boot',
        currentVersion: currentSpringBootVersion,
        recommendedVersion: targetSpringBootVersion
      };
      
      await this.ensureSpringBootVersionConsistency(results, springBootFix, targetSpringBootVersion);
    } else {
      logger.info(`✅ Spring Boot version ${currentSpringBootVersion} is compatible with ${fix.dependencyName} ${fix.recommendedVersion}`);
    }
  }

  /**
   * Check if a vulnerability fix would require major version upgrades that are incompatible
   */
  async checkCompatibilityIssues(fix: VulnerabilityFix, parsingResults: FileParsingResult[]): Promise<MajorUpgradeRequirement | null> {
    // Detect current Java version
    const javaVersion = await this.detectJavaVersion(parsingResults);
    logger.info(`🔍 Checking compatibility for ${fix.dependencyName} ${fix.recommendedVersion} with Java ${javaVersion}`);
    
    const requiredUpgrades: RequiredUpgrade[] = [];
    
    // Get current Spring Boot version once for all checks
    const springBootVersion = await this.detectSpringBootVersion(parsingResults);
    logger.info(`🔍 Detected Spring Boot version: ${springBootVersion || 'not found'}`);
    
    // Debug: Log the recommended version parsing
    const recommendedMajor = parseInt(fix.recommendedVersion.split('.')[0]);
    logger.info(`🔍 Recommended version major: ${recommendedMajor} for ${fix.dependencyName}`);
    
    // Debug: Log dependency matching logic
    const isSpringSecurityCore = fix.dependencyName.includes('org.springframework.security:spring-security-core') || 
                                 fix.dependencyName.includes('spring-security-core');
    logger.info(`🔍 Is Spring Security Core dependency: ${isSpringSecurityCore} for ${fix.dependencyName}`);
    
    // Check Spring Security 6.x compatibility
    if (fix.dependencyName.includes('org.springframework.security:spring-security-core') || 
        fix.dependencyName.includes('spring-security-core')) {
      const recommendedMajor = parseInt(fix.recommendedVersion.split('.')[0]);
      logger.info(`🔍 Spring Security compatibility check: major version ${recommendedMajor} >= 6? ${recommendedMajor >= 6}`);
      
      if (recommendedMajor >= 6) {
        // Spring Security 6.x requires Spring Boot 3.x and Java 17+
        logger.info(`🔍 Java version check: ${javaVersion} < 17? ${javaVersion < 17}`);
        if (javaVersion < 17) {
          logger.info(`❌ Adding Java upgrade requirement: Java ${javaVersion} -> Java 17+`);
          requiredUpgrades.push({
            type: 'java',
            current: `Java ${javaVersion}`,
            required: 'Java 17+',
            description: 'Spring Security 6.x requires Java 17 or higher'
          });
        } else {
          logger.info(`✅ Java version ${javaVersion} meets Spring Security 6.x requirement (>= 17)`);
        }
        
        logger.info(`🔍 Spring Boot version check: ${springBootVersion} starts with '2.'? ${springBootVersion && springBootVersion.startsWith('2.')}`);
        if (springBootVersion && springBootVersion.startsWith('2.')) {
          logger.info(`❌ Adding Spring Boot upgrade requirement: ${springBootVersion} -> Spring Boot 3.x`);
          requiredUpgrades.push({
            type: 'spring-boot',
            current: `Spring Boot ${springBootVersion}`,
            required: 'Spring Boot 3.x',
            description: 'Spring Security 6.x requires Spring Boot 3.x'
          });
        } else {
          logger.info(`✅ Spring Boot version ${springBootVersion || 'not detected'} meets Spring Security 6.x requirement (!= 2.x)`);
        }
      }
    }
    
    // Check Spring Framework 6.x compatibility (spring-web, spring-webmvc, etc.)
    if ((fix.dependencyName.includes('org.springframework:spring-web') || 
         fix.dependencyName.includes('org.springframework:spring-webmvc') ||
         fix.dependencyName.includes('org.springframework:spring-core') ||
         fix.dependencyName.includes('org.springframework:spring-context')) &&
        !fix.dependencyName.includes('spring-boot') &&
        !fix.dependencyName.includes('spring-security')) {
      const recommendedMajor = parseInt(fix.recommendedVersion.split('.')[0]);
      if (recommendedMajor >= 6) {
        // Spring Framework 6.x requires Spring Boot 3.x and Java 17+
        if (javaVersion < 17) {
          requiredUpgrades.push({
            type: 'java',
            current: `Java ${javaVersion}`,
            required: 'Java 17+',
            description: 'Spring Framework 6.x requires Java 17 or higher'
          });
        }
        
        if (springBootVersion && springBootVersion.startsWith('2.')) {
          requiredUpgrades.push({
            type: 'spring-boot',
            current: `Spring Boot ${springBootVersion}`,
            required: 'Spring Boot 3.x',
            description: 'Spring Framework 6.x requires Spring Boot 3.x'
          });
        }
      }
    }
    
    // Check Spring Boot 3.x compatibility
    if (fix.dependencyName.includes('org.springframework.boot:spring-boot') ||
        fix.dependencyName.includes('spring-boot')) {
      const recommendedMajor = parseInt(fix.recommendedVersion.split('.')[0]);
      if (recommendedMajor >= 3 && javaVersion < 17) {
        requiredUpgrades.push({
          type: 'java',
          current: `Java ${javaVersion}`,
          required: 'Java 17+',
          description: 'Spring Boot 3.x requires Java 17 or higher'
        });
      }
    }
    
    // Check Logback 1.4+ compatibility (requires Java 11+, but we're more lenient)
    if (fix.dependencyName.includes('ch.qos.logback:logback-classic')) {
      const recommendedVersion = fix.recommendedVersion;
      const majorMinor = recommendedVersion.split('.').slice(0, 2).join('.');
      
      // Only flag if moving from 1.2.x to 1.4.x+ and Java < 11
      if (parseFloat(majorMinor) >= 1.4 && javaVersion < 11) {
        requiredUpgrades.push({
          type: 'java',
          current: `Java ${javaVersion}`,
          required: 'Java 11+',
          description: 'Logback 1.4+ requires Java 11 or higher'
        });
      }
    }
    
    // If no compatibility issues, return null
    if (requiredUpgrades.length === 0) {
      logger.info(`✅ No compatibility issues found for ${fix.dependencyName} ${fix.recommendedVersion}`);
      return null;
    }
    
    logger.info(`⚠️ Compatibility issues found for ${fix.dependencyName}:`, requiredUpgrades.map(u => u.description));
    
    // Create MajorUpgradeRequirement
    const requirement: MajorUpgradeRequirement = {
      id: `major-upgrade-${fix.dependencyName}-${Date.now()}`,
      dependencyName: fix.dependencyName,
      currentVersion: fix.currentVersion,
      recommendedVersion: fix.recommendedVersion,
      cveIds: [fix.cveId],
      jiraTickets: [], // JIRA tickets would need to be passed separately
      reason: `Requires major version upgrades: ${requiredUpgrades.map(u => u.description).join(', ')}`,
      requiredUpgrades,
      packageManager: this.detectPackageManagerFromDependency(fix.dependencyName),
      filePath: this.findFilePathForDependency(fix.dependencyName, parsingResults),
      severity: 'medium' as VulnerabilitySeverity
    };
    
    return requirement;
  }
  
  /**
   * Detect the current Spring Boot version from parsing results
   */
  private async detectCurrentSpringBootVersion(parsingResults: FileParsingResult[]): Promise<string | null> {
    logger.info(`🔍 detectCurrentSpringBootVersion: Processing ${parsingResults.length} parsing results`);
    
    for (const result of parsingResults) {
      if (!result || !result.modification) {
        logger.info(`⏭️ Skipping result with no modification: ${result?.filePath || 'unknown'}`);
        continue; // Skip null/undefined results
      }
      
      logger.info(`🔍 Checking file: ${result.filePath} (type: ${result.fileType})`);
      
      if (result.fileType === 'gradle' && 'content' in result.modification) {
        // Look for springBootVersion variable in Gradle files
        const content = (result.modification as GradleFileModification).content;
        if (content) {
          logger.info(`🔍 Searching Gradle content for springBootVersion in ${result.filePath}`);
          const springBootVersionMatch = content.match(/springBootVersion\s*=\s*['"]([^'"]+)['"]/);
          if (springBootVersionMatch) {
            logger.info(`✅ Found Spring Boot version in Gradle: ${springBootVersionMatch[1]} from ${result.filePath}`);
            return springBootVersionMatch[1];
          } else {
            logger.info(`❌ No springBootVersion variable found in ${result.filePath}`);
          }
        }
      } else if (result.fileType === 'maven' && 'content' in result.modification) {
        // Look for Spring Boot parent version in Maven files
        const content = (result.modification as MavenFileModification).content;
        if (content) {
          logger.info(`🔍 Searching Maven content for Spring Boot parent in ${result.filePath}`);
          const parentVersionMatch = content.match(/<parent>[\s\S]*?<groupId>org\.springframework\.boot<\/groupId>[\s\S]*?<version>([^<]+)<\/version>/);
          if (parentVersionMatch) {
            logger.info(`✅ Found Spring Boot version in Maven parent: ${parentVersionMatch[1]} from ${result.filePath}`);
            return parentVersionMatch[1];
          } else {
            logger.info(`❌ No Spring Boot parent found in ${result.filePath}`);
          }
        }
      }
    }
    
    logger.warn(`❌ No Spring Boot version detected from any parsing results`);
    return null;
  }
  
  /**
   * Detect package manager from dependency name format
   */
  private detectPackageManagerFromDependency(dependencyName: string): PackageManager {
    if (dependencyName.includes(':')) {
      return 'gradle'; // Java dependencies typically use group:artifact format
    } else if (dependencyName.startsWith('@') || dependencyName.includes('/')) {
      return 'npm'; // npm packages
    }
    return 'gradle'; // Default to gradle for Java projects
  }
  
  /**
   * Find the file path where a dependency is likely declared
   */
  private findFilePathForDependency(dependencyName: string, parsingResults: FileParsingResult[]): string {
    // Look for the dependency in parsing results
    for (const result of parsingResults) {
      if ('content' in result.modification) {
        const content = (result.modification as GradleFileModification | MavenFileModification).content;
        if (content.includes(dependencyName)) {
          return result.filePath;
        }
      }
    }
    // If not found, return the first relevant file
    const packageManager = this.detectPackageManagerFromDependency(dependencyName);
    const relevantFiles = parsingResults.filter(r => {
      if (packageManager === 'gradle') return r.fileType === 'gradle';
      if (packageManager === 'npm') return r.fileType === 'npm';
      return r.fileType === 'maven';
    });
    return relevantFiles.length > 0 ? relevantFiles[0].filePath : parsingResults[0]?.filePath || 'unknown';
  }

  /**
   * Determine if Spring Boot version should be updated based on a Spring dependency update
   */
  private shouldUpdateSpringBootVersion(dependencyName: string, dependencyVersion: string, currentSpringBootVersion: string): boolean {
    // For now, we'll be conservative and only update Spring Boot if there's a clear compatibility issue
    // This prevents unnecessary Spring Boot updates that could cause more problems
    
    // Parse versions to compare major.minor versions
    const parseVersion = (version: string) => {
      const match = version.match(/^(\d+)\.(\d+)/);
      return match ? { major: parseInt(match[1]), minor: parseInt(match[2]) } : null;
    };
    
    const springBootVer = parseVersion(currentSpringBootVersion);
    const dependencyVer = parseVersion(dependencyVersion);
    
    if (!springBootVer || !dependencyVer) {
      logger.warn(`⚠️ Could not parse versions: SpringBoot=${currentSpringBootVersion}, Dependency=${dependencyVersion}`);
      return false;
    }
    
    // Only update Spring Boot if there's a significant version gap that could cause compatibility issues
    if (dependencyName.includes('spring-security')) {
      // Spring Security 6.x requires Spring Boot 3.x
      if (dependencyVer.major >= 6) {
        logger.info(`🔧 Spring Security ${dependencyVersion} requires Spring Boot 3.x+, current is ${currentSpringBootVersion}`);
        return true;
      }
      // Spring Security 5.8.x requires Spring Boot 2.7.x+
      if (dependencyVer.major === 5 && dependencyVer.minor >= 8 && 
          springBootVer.major === 2 && springBootVer.minor < 7) {
        logger.info(`🔧 Spring Security ${dependencyVersion} requires Spring Boot 2.7+, current is ${currentSpringBootVersion}`);
        return true;
      }
    }
    
    // For other Spring dependencies, be conservative and don't update Spring Boot
    return false;
  }

  /**
   * Get compatible Spring Boot version for a given Spring dependency
   */
  private getCompatibleSpringBootVersion(dependencyName: string, dependencyVersion: string): string {
    // Parse the dependency version
    const parseVersion = (version: string) => {
      const match = version.match(/^(\d+)\.(\d+)/);
      return match ? { major: parseInt(match[1]), minor: parseInt(match[2]) } : null;
    };
    
    const dependencyVer = parseVersion(dependencyVersion);
    
    if (!dependencyVer) {
      logger.warn(`⚠️ Could not parse dependency version: ${dependencyVersion}`);
      return '2.7.18'; // Default to a safe version
    }
    
    if (dependencyName.includes('spring-security')) {
      // Spring Security compatibility matrix
      if (dependencyVer.major >= 6) {
        return '3.3.11'; // Spring Security 6.x requires Spring Boot 3.x
      } else if (dependencyVer.major === 5 && dependencyVer.minor >= 8) {
        return '2.7.18'; // Spring Security 5.8.x is compatible with Spring Boot 2.7.x
      } else if (dependencyVer.major === 5 && dependencyVer.minor >= 6) {
        return '2.6.15'; // Spring Security 5.6.x is compatible with Spring Boot 2.6.x
      }
    }
    
    // Default to a safe Spring Boot version
    return '2.7.18';
  }

  /**
   * Get compatible Spring Framework version for a given Spring Boot version
   */
  private getCompatibleSpringFrameworkVersion(springBootVersion: string, cveRecommendedVersions?: string[]): string {
    logger.info(`🔍 Getting compatible Spring Framework version for Spring Boot ${springBootVersion}`);
    
    const parseVersion = (version: string) => {
      const match = version.match(/^(\d+)\.(\d+)\.?(\d+)?/);
      return match ? { 
        major: parseInt(match[1]), 
        minor: parseInt(match[2]),
        patch: match[3] ? parseInt(match[3]) : 0 
      } : null;
    };
    
    const springBootVer = parseVersion(springBootVersion);
    
    if (!springBootVer) {
      logger.warn(`⚠️ Could not parse Spring Boot version: ${springBootVersion}`);
      return '6.1.8'; // Default to a recent compatible version
    }
    
    // Spring Boot to Spring Framework compatibility matrix
    if (springBootVer.major >= 3) {
      if (springBootVer.minor >= 3) {
        // Spring Boot 3.3.x uses Spring Framework 6.1.x
        logger.info(`✅ Spring Boot ${springBootVersion} is compatible with Spring Framework 6.1.x`);
        return '6.1.8';
      } else if (springBootVer.minor >= 1) {
        // Spring Boot 3.1.x-3.2.x uses Spring Framework 6.0.x
        logger.info(`✅ Spring Boot ${springBootVersion} is compatible with Spring Framework 6.0.x`);
        return '6.0.19';
      } else {
        // Spring Boot 3.0.x uses Spring Framework 6.0.x
        logger.info(`✅ Spring Boot ${springBootVersion} is compatible with Spring Framework 6.0.x`);
        return '6.0.19';
      }
    } else if (springBootVer.major === 2) {
      if (springBootVer.minor >= 7) {
        // Spring Boot 2.7.x uses Spring Framework 5.3.x
        logger.info(`✅ Spring Boot ${springBootVersion} is compatible with Spring Framework 5.3.x`);
        return '5.3.32';
      } else {
        // Spring Boot 2.6.x and below uses Spring Framework 5.3.x
        logger.info(`✅ Spring Boot ${springBootVersion} is compatible with Spring Framework 5.3.x`);
        return '5.3.32';
      }
    }
    
    // Get the base compatible version from the matrix
    let baseCompatibleVersion = '6.1.8'; // Default to latest compatible version
    
    // If we have CVE recommended versions for Spring Framework components, use the highest one
    if (cveRecommendedVersions && cveRecommendedVersions.length > 0) {
      logger.info(`🔍 Considering CVE recommended versions: ${cveRecommendedVersions.join(', ')}`);
      
      // Parse and compare versions to get the highest
      const parseVersionForComparison = (version: string) => {
        const match = version.match(/^(\d+)\.(\d+)\.?(\d+)?/);
        if (!match) return { major: 0, minor: 0, patch: 0 };
        return {
          major: parseInt(match[1], 10),
          minor: parseInt(match[2], 10),
          patch: parseInt(match[3] || '0', 10)
        };
      };
      
      let highestVersion = baseCompatibleVersion;
      let highestParsed = parseVersionForComparison(baseCompatibleVersion);
      
      for (const version of cveRecommendedVersions) {
        const parsed = parseVersionForComparison(version);
        if (parsed.major > highestParsed.major || 
            (parsed.major === highestParsed.major && parsed.minor > highestParsed.minor) ||
            (parsed.major === highestParsed.major && parsed.minor === highestParsed.minor && parsed.patch > highestParsed.patch)) {
          highestVersion = version;
          highestParsed = parsed;
        }
      }
      
      logger.info(`🎯 Using highest CVE recommended version: ${highestVersion} (from ${cveRecommendedVersions.join(', ')})`);
      return highestVersion;
    }
    
    return baseCompatibleVersion;
  }

  /**
   * Update Spring Framework components to be compatible with current Spring Boot version
   */
  private async updateSpringFrameworkCompatibility(
    results: FileParsingResult[], 
    springBootVersion: string,
    cveId: string = '',
    reason: string = 'Updated for Spring Boot compatibility',
    globallyProcessed?: Set<string>
  ): Promise<void> {
    logger.info(`🔧 Updating Spring Framework components for Spring Boot ${springBootVersion} compatibility`);
    
    const compatibleSpringVersion = this.getCompatibleSpringFrameworkVersion(springBootVersion);
    logger.info(`🎯 Target Spring Framework version: ${compatibleSpringVersion}`);
    
    // Track already updated dependencies to prevent duplicates
    const alreadyUpdated = new Set<string>();
    
    // List of Spring Framework components that need version alignment
    const springFrameworkComponents = [
      'org.springframework:spring-core',
      'org.springframework:spring-context',
      'org.springframework:spring-web',
      'org.springframework:spring-webmvc',
      'org.springframework:spring-beans',
      'org.springframework:spring-aop',
      'org.springframework:spring-jdbc',
      'org.springframework:spring-tx',
      'org.springframework:spring-orm',
      'org.springframework.security:spring-security-core',
      'org.springframework.security:spring-security-web',
      'org.springframework.security:spring-security-config',
      'org.springframework.security:spring-security-crypto'
    ];
    
    for (const result of results) {
      if (result.fileType === 'gradle' && result.modification) {
        const gradleMod = result.modification as any;
        
        if (gradleMod.dependencies) {
          for (const component of springFrameworkComponents) {
            // Find dependencies that match this component
            const matchingDeps = gradleMod.dependencies.filter((dep: any) => 
              `${dep.group}:${dep.name}` === component ||
              (component.includes('spring-security') && dep.group === 'org.springframework.security' && dep.name.includes('spring-security')) ||
              (component.includes('org.springframework:') && dep.group === 'org.springframework')
            );
            
            for (const dep of matchingDeps) {
              if ((dep as any).version && 
                  !(dep as any).version.includes('${') && 
                  (dep as any).version !== compatibleSpringVersion) {
                
                const dependencyKey = `${(dep as any).group}:${(dep as any).name}:${result.filePath}`;
                const fullDependencyName = `${(dep as any).group}:${(dep as any).name}`;
                
                // Skip if already updated locally or globally
                if (alreadyUpdated.has(dependencyKey)) {
                  logger.info(`⏭️ Skipping ${fullDependencyName} in ${path.basename(result.filePath)} - already updated for Spring Framework compatibility`);
                  continue;
                }
                
                if (globallyProcessed && globallyProcessed.has(fullDependencyName)) {
                  logger.info(`⏭️ Skipping ${fullDependencyName} in ${path.basename(result.filePath)} - already globally processed`);
                  continue;
                }
                
                const currentVersion = (dep as any).version;
                const needsUpdate = this.shouldUpdateSpringFrameworkVersion(currentVersion, compatibleSpringVersion, springBootVersion);
                
                if (needsUpdate) {
                  logger.info(`🔄 Updating Spring Framework component ${(dep as any).group}:${(dep as any).name} from ${currentVersion} to ${compatibleSpringVersion}`);
                  
                  const success = this.gradleParser.updateDependencyVersion(
                    gradleMod,
                    `${(dep as any).group}:${(dep as any).name}`,
                    currentVersion,
                    compatibleSpringVersion,
                    cveId,
                    `${reason} (Spring Boot ${springBootVersion} compatibility)`
                  );
                  
                  if (success) {
                    // Mark as updated to prevent duplicates
                    alreadyUpdated.add(dependencyKey);
                    
                    if (!result.applied) {
                      result.applied = true;
                      result.fixes = result.fixes || [];
                    }
                    
                    // Create a synthetic fix for tracking
                    const syntheticFix: VulnerabilityFix = {
                      cveId: cveId || 'COMPATIBILITY',
                      dependencyName: `${(dep as any).group}:${(dep as any).name}`,
                      currentVersion,
                      recommendedVersion: compatibleSpringVersion,
                      severity: 'medium',
                      description: `Updated for Spring Boot ${springBootVersion} compatibility`
                    };
                    result.fixes.push(syntheticFix);
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  /**
   * Determine if Spring Framework component needs to be updated for compatibility
   */
  private shouldUpdateSpringFrameworkVersion(currentVersion: string, targetVersion: string, springBootVersion: string): boolean {
    const parseVersion = (version: string) => {
      const match = version.match(/^(\d+)\.(\d+)\.?(\d+)?/);
      return match ? { 
        major: parseInt(match[1]), 
        minor: parseInt(match[2]),
        patch: match[3] ? parseInt(match[3]) : 0 
      } : null;
    };
    
    const current = parseVersion(currentVersion);
    const target = parseVersion(targetVersion);
    const springBoot = parseVersion(springBootVersion);
    
    if (!current || !target || !springBoot) {
      return false;
    }
    
    // Spring Boot 3.3.x should use Spring Framework 6.1.x (not 6.0.x)
    if (springBoot.major >= 3 && springBoot.minor >= 3) {
      if (current.major === 6 && current.minor === 0 && target.major === 6 && target.minor === 1) {
        logger.info(`✅ Spring Boot ${springBootVersion} requires Spring Framework 6.1.x, updating from ${currentVersion} to ${targetVersion}`);
        return true;
      }
    }
    
    // Major version mismatch (e.g., 5.x vs 6.x)
    if (current.major !== target.major) {
      logger.info(`✅ Major version update needed: ${currentVersion} -> ${targetVersion} for Spring Boot ${springBootVersion}`);
      return true;
    }
    
    // Minor version compatibility issues
    if (current.major === target.major && current.minor !== target.minor) {
      // Be more selective about minor version updates
      if (Math.abs(current.minor - target.minor) >= 1) {
        logger.info(`✅ Minor version update needed: ${currentVersion} -> ${targetVersion} for Spring Boot ${springBootVersion}`);
        return true;
      }
    }
    
    return false;
  }

  /**
   * Try to substitute hardcoded versions with variable references
   */
  private tryVariableSubstitution(
    gradleMod: any,
    dependencyName: string,
    currentVersion: string,
    newVersion: string,
    cveId: string,
    reason: string,
    allParsingResults: FileParsingResult[]
  ): boolean {
    logger.info(`🔄 Trying variable substitution for ${dependencyName}:${currentVersion} -> ${newVersion}`);
    
    // Find the appropriate variable name for this dependency
    const variableName = this.extractVariableName(dependencyName);
    if (!variableName) {
      logger.info(`❌ No variable mapping found for ${dependencyName}`);
      return false;
    }
    
    // Check if the variable exists in any of the parsed files
    const variableExists = allParsingResults.some(result => {
      if (result.fileType === 'gradle' && result.modification) {
        const gradleMod = result.modification as any;
        return gradleMod.variables && gradleMod.variables.some((v: any) => v.name === variableName);
      }
      return false;
    });
    
    if (!variableExists) {
      logger.info(`❌ Variable ${variableName} not found in any parsed files`);
      return false;
    }
    
    // Find the dependency to update
    const dependency = gradleMod.dependencies.find((dep: any) => 
      `${dep.group}:${dep.name}` === dependencyName && dep.version === currentVersion
    );
    
    if (!dependency) {
      logger.info(`❌ Dependency ${dependencyName}:${currentVersion} not found for variable substitution`);
      return false;
    }
    
    // Update the dependency to use the variable instead of hardcoded version
    const lines = gradleMod.content.split('\n');
    const originalLine = dependency.originalLine;
    
    // Replace the hardcoded version with variable reference
    const newLine = originalLine.replace(
      new RegExp(`(['"])${escapeRegExp(currentVersion)}(['"])`, 'g'),
      `$1\${${variableName}}$2`
    );
    
    if (newLine === originalLine) {
      logger.info(`❌ Could not substitute version in line: ${originalLine}`);
      return false;
    }
    
    // Update the line
    lines[dependency.lineNumber] = newLine;
    
    // Store the modification
    gradleMod.modifications.push({
      type: 'dependency',
      lineNumber: dependency.lineNumber,
      oldLine: originalLine,
      newLine: newLine,
      comment: reason,
      cveId: cveId
    });
    
    gradleMod.content = lines.join('\n');
    logger.info(`✅ Successfully substituted ${dependencyName}:${currentVersion} -> \${${variableName}}`);
    return true;
  }

  /**
   * Extract variable name from dependency name for Spring Boot related dependencies
   */
  private extractVariableName(dependencyName: string): string | null {
    // Map common Spring Boot dependencies to their variable names
    const variableMap: { [key: string]: string } = {
      'org.springframework.boot': 'springBootVersion',
      'org.springframework': 'springVersion',
      'org.springframework.security': 'springSecurityVersion'
    };

    // Check for exact matches first
    if (variableMap[dependencyName]) {
      return variableMap[dependencyName];
    }

    // Check for partial matches (e.g., "org.springframework.boot:spring-boot" -> "springBootVersion")
    for (const [key, value] of Object.entries(variableMap)) {
      if (dependencyName.startsWith(key)) {
        return value;
      }
    }

    return null;
  }
}