import semver from 'semver';
import { logger } from '../../utils/logger';
import { 
  PackageFile, 
  Dependency, 
  DependencyTree, 
  PackageManager, 
  Vulnerability,
  FixSuggestion,
  UpdateType,
  BreakingChange
} from '../../types';

export class DependencyAnalyzer {
  /**
   * Build dependency tree for a repository
   */
  async buildDependencyTree(repositoryId: string, packageFiles: PackageFile[], repoPath: string): Promise<DependencyTree> {
    try {
      logger.info('Building dependency tree for repository', repositoryId);
      logger.info('Repository path:', repoPath);

      // Extract dependencies from all package files
      const allDependencies: Dependency[] = [];
      for (const packageFile of packageFiles) {
        const dependencies = await this.extractDependencies(packageFile);
        allDependencies.push(...dependencies);
        
        logger.info(`Extracted ${dependencies.length} ${dependencies[0]?.type || 'unknown'} dependencies from ${packageFile.filePath} (isLockFile: ${this.isLockFile(packageFile.filePath)})`);
      }

      logger.info('Total dependencies extracted before deduplication:', allDependencies.length);

      // Remove duplicates and normalize
      const uniqueDependencies = this.deduplicateDependencies(allDependencies);
      logger.info('Unique dependencies after deduplication:', uniqueDependencies.length);

      // Build dependency relationships with Gradle resolution
      const dependencyTree = await this.buildDependencyRelationships(uniqueDependencies, repoPath);

      // ✅ VALIDATION: Check if Gradle placeholders were properly resolved
      const remainingPlaceholders = dependencyTree.filter(d => 
        d.name === 'gradle-project-placeholder' || d.version === 'placeholder'
      );
      
      if (remainingPlaceholders.length > 0) {
        logger.warn('⚠️ Gradle resolution incomplete - some placeholder dependencies still present');
        logger.warn('🔍 Gradle placeholders found:', remainingPlaceholders.map(d => `${d.name}:${d.version}`));
        logger.warn('📋 This may indicate complex Gradle build issues - continuing with available dependency information');
        
        // Filter out placeholder dependencies but continue with analysis
        const filteredDependencyTree = dependencyTree.filter(d => 
          d.name !== 'gradle-project-placeholder' && d.version !== 'placeholder'
        );
        
        logger.info(`📊 Filtered out ${remainingPlaceholders.length} placeholders, continuing with ${filteredDependencyTree.length} valid dependencies`);
        
        // Update the dependency tree reference for the rest of the method
        dependencyTree.length = 0; // Clear original array
        dependencyTree.push(...filteredDependencyTree); // Replace with filtered dependencies
      }

      const directCount = dependencyTree.filter(d => d.type === 'direct').length;
      const transitiveCount = dependencyTree.filter(d => d.type === 'transitive').length;

      logger.info('Dependency tree summary', {
        total: dependencyTree.length,
        direct: directCount,
        transitive: transitiveCount,
        packageFiles: packageFiles.length
      });

      return {
        repositoryId,
        dependencies: dependencyTree,
        packageFiles,
        generatedAt: new Date(),
      };
    } catch (error: any) {
      logger.error('Error building dependency tree:', error);
      throw new Error(`Failed to build dependency tree: ${error.message}`);
    }
  }

  /**
   * Extract dependencies from a package file
   */
  private async extractDependencies(packageFile: PackageFile): Promise<Dependency[]> {
    const dependencies: Dependency[] = [];

    try {
      logger.info(`🔍 Extracting dependencies from ${packageFile.filePath} (${packageFile.packageManager})`);
      logger.info(`📦 Package file has ${Object.keys(packageFile.dependencies).length} dependencies and ${Object.keys(packageFile.devDependencies || {}).length} devDependencies`);
      
      // Determine if this is a lock file (contains transitive dependencies)
      const isLockFile = this.isLockFile(packageFile.filePath);
      const dependencyType = isLockFile ? 'transitive' : 'direct';

      logger.info(`🔄 Processing ${Object.keys(packageFile.dependencies).length} production dependencies...`);
      
      // Process production dependencies
      let processedCount = 0;
      for (const [name, version] of Object.entries(packageFile.dependencies)) {
        dependencies.push({
          name,
          version: this.normalizeVersion(version),
          type: dependencyType,
          packageManager: packageFile.packageManager,
          filePath: packageFile.filePath,
          isDev: false,
        });
        processedCount++;
        
        // Log progress for large dependency sets
        if (processedCount % 10 === 0 || processedCount <= 5) {
          logger.info(`   Processed ${processedCount}/${Object.keys(packageFile.dependencies).length}: ${name}:${version}`);
        }
      }

      // Process development dependencies (only for non-lock files)
      if (packageFile.devDependencies && !isLockFile) {
        logger.info(`🔄 Processing ${Object.keys(packageFile.devDependencies).length} development dependencies...`);
        for (const [name, version] of Object.entries(packageFile.devDependencies)) {
          dependencies.push({
            name,
            version: this.normalizeVersion(version),
            type: 'direct',
            packageManager: packageFile.packageManager,
            filePath: packageFile.filePath,
            isDev: true,
          });
        }
      }

      logger.info(`✅ Extracted ${dependencies.length} ${dependencyType} dependencies from ${packageFile.filePath} (isLockFile: ${isLockFile})`);
      
      // Log sample dependencies
      if (dependencies.length > 0) {
        logger.info('🔍 Sample extracted dependencies:');
        dependencies.slice(0, 5).forEach((dep, index) => {
          logger.info(`   ${index + 1}. ${dep.name}:${dep.version} (${dep.packageManager})`);
        });
      }
      
      return dependencies;
    } catch (error) {
      logger.warn(`❌ Error extracting dependencies from ${packageFile.filePath}:`, error);
      return [];
    }
  }

  /**
   * Check if a file is a lock file containing transitive dependencies
   */
  private isLockFile(filePath: string): boolean {
    const lockFilePatterns = [
      'package-lock.json',
      'yarn.lock',
      'Pipfile.lock',
      'poetry.lock',
      'Gemfile.lock',
      'go.sum'
    ];
    
    return lockFilePatterns.some(pattern => filePath.endsWith(pattern));
  }

  /**
   * Normalize version strings to semver format
   */
  private normalizeVersion(version: string): string {
    // Remove common prefixes and suffixes
    let normalized = version
      .replace(/^[\^~>=<]/, '') // Remove version range operators
      .replace(/\s.*$/, '') // Remove everything after first space
      .trim();

    // Handle special cases
    if (normalized === '*' || normalized === 'latest') {
      return '*';
    }

    // Try to parse as semver
    try {
      const parsed = semver.coerce(normalized);
      return parsed ? parsed.version : normalized;
    } catch {
      return normalized;
    }
  }

  /**
   * Remove duplicate dependencies and merge information
   */
  private deduplicateDependencies(dependencies: Dependency[]): Dependency[] {
    const dependencyMap = new Map<string, Dependency>();

    for (const dep of dependencies) {
      const key = `${dep.name}@${dep.packageManager}`;
      const existing = dependencyMap.get(key);

      if (!existing) {
        dependencyMap.set(key, dep);
      } else {
        // Merge information from duplicate dependencies
        if (existing.version !== dep.version) {
          // Keep the more specific version
          if (this.isMoreSpecificVersion(dep.version, existing.version)) {
            existing.version = dep.version;
          }
        }
        
        // If one is dev and other is prod, mark as prod
        if (!dep.isDev) {
          existing.isDev = false;
        }
      }
    }

    return Array.from(dependencyMap.values());
  }

  /**
   * Check if one version is more specific than another
   */
  private isMoreSpecificVersion(version1: string, version2: string): boolean {
    // Specific version is better than wildcard
    if (version2 === '*' && version1 !== '*') return true;
    if (version1 === '*' && version2 !== '*') return false;

    // Try semver comparison
    try {
      const v1 = semver.coerce(version1);
      const v2 = semver.coerce(version2);
      
      if (v1 && v2) {
        return semver.gt(v1, v2);
      }
    } catch {
      // Fall back to string comparison
    }

    return version1.length > version2.length;
  }

  /**
   * Build dependency relationships (parent-child)
   * Uses actual gradle dependencies command to get resolved versions
   */
  private async buildDependencyRelationships(dependencies: Dependency[], repoPath: string): Promise<Dependency[]> {
    logger.info('🔍 Building dependency relationships using gradle dependencies command...');
    
    // Group dependencies by package manager for proper resolution
    const depsByManager = dependencies.reduce((acc, dep) => {
      if (!acc[dep.packageManager]) {
        acc[dep.packageManager] = [];
      }
      acc[dep.packageManager].push(dep);
      return acc;
    }, {} as Record<string, Dependency[]>);

    logger.info('📊 Dependencies grouped by package manager:', {
      gradle: depsByManager.gradle?.length || 0,
      npm: depsByManager.npm?.length || 0,
      maven: depsByManager.maven?.length || 0,
      other: Object.keys(depsByManager).filter(k => !['gradle', 'npm', 'maven'].includes(k)).length
    });

    // Log some sample Gradle dependencies
    if (depsByManager.gradle && depsByManager.gradle.length > 0) {
      logger.info('🎯 Sample Gradle dependencies found:', 
        depsByManager.gradle.slice(0, 5).map(d => `${d.name}:${d.version} (from ${d.filePath})`)
      );
    }

    let enhancedDependencies: Dependency[] = [...dependencies];

    // For Gradle projects, run actual gradle dependencies command
    if (depsByManager.gradle && depsByManager.gradle.length > 0) {
      logger.info(`🚀 Starting Gradle resolution for ${depsByManager.gradle.length} dependencies...`);
      try {
        const resolvedGradleDeps = await this.runGradleDependenciesCommand(depsByManager.gradle, repoPath);
        logger.info(`📦 Gradle resolution completed. Got ${resolvedGradleDeps.length} resolved dependencies`);
        
        if (resolvedGradleDeps.length > 0) {
          // Replace Gradle dependencies with resolved ones
          const originalGradleCount = enhancedDependencies.filter(d => d.packageManager === 'gradle').length;
          enhancedDependencies = enhancedDependencies.filter(d => d.packageManager !== 'gradle');
          enhancedDependencies.push(...resolvedGradleDeps);
          logger.info(`✅ Enhanced with ${resolvedGradleDeps.length} resolved Gradle dependencies (replaced ${originalGradleCount} original ones)`);
          
          // Log sample resolved dependencies
          logger.info('📋 Sample resolved Gradle dependencies:',
            resolvedGradleDeps.slice(0, 10).map(d => `${d.name}:${d.version}`)
          );
        } else {
          logger.warn('⚠️ Gradle dependency resolution returned 0 dependencies - this may indicate build issues');
          logger.warn('📋 Continuing with analysis using basic dependency information from build files');
          // Don't throw an error - use the basic dependencies from file parsing instead
        }
      } catch (error) {
        logger.error('❌ Failed to resolve Gradle dependencies:', error);
        logger.warn('📋 Continuing with analysis using basic dependency information from build files');
        // Don't throw an error - graceful degradation to basic file-based analysis
      }
    } else {
      logger.info('🔍 No Gradle dependencies found - skipping Gradle resolution');
    }

    // For Maven projects, run mvn dependency:tree command
    if (depsByManager.maven && depsByManager.maven.length > 0) {
      logger.info(`🚀 Starting Maven resolution for ${depsByManager.maven.length} dependencies...`);
      try {
        const resolvedMavenDeps = await this.runMavenDependenciesCommand(depsByManager.maven, repoPath);
        logger.info(`📦 Maven resolution completed. Got ${resolvedMavenDeps.length} resolved dependencies`);
        
        if (resolvedMavenDeps.length > 0) {
          // Replace Maven dependencies with resolved ones
          const originalMavenCount = enhancedDependencies.filter(d => d.packageManager === 'maven').length;
          enhancedDependencies = enhancedDependencies.filter(d => d.packageManager !== 'maven');
          enhancedDependencies.push(...resolvedMavenDeps);
          logger.info(`✅ Enhanced with ${resolvedMavenDeps.length} resolved Maven dependencies (replaced ${originalMavenCount} original ones)`);
          
          // Log sample resolved dependencies
          logger.info('📋 Sample resolved Maven dependencies:',
            resolvedMavenDeps.slice(0, 10).map(d => `${d.name}:${d.version}`)
          );
        } else {
          // Check if this is because there's no pom.xml (legitimate case) or a real failure
          const path = await import('path');
          const fs = await import('fs');
          const pomXmlPath = path.join(repoPath, 'pom.xml');
          
          if (!fs.existsSync(pomXmlPath)) {
            logger.info('ℹ️ Maven dependency resolution returned 0 dependencies - no pom.xml found (expected for non-Maven projects)');
            // This is fine - it's not a Maven project, so 0 Maven dependencies is expected
          } else {
            logger.error('❌ Maven dependency resolution returned 0 dependencies despite pom.xml being present');
            throw new Error('Maven dependency resolution failed: mvn dependency:tree command returned no dependencies');
          }
        }
      } catch (error) {
        logger.error('❌ Failed to resolve Maven dependencies:', error);
        throw new Error(`Maven dependency resolution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    } else {
      logger.info('🔍 No Maven dependencies found - skipping Maven resolution');
    }
    
    logger.info(`Final dependency tree: ${enhancedDependencies.length} total dependencies`, {
      byType: enhancedDependencies.reduce((acc, dep) => {
        acc[dep.type] = (acc[dep.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      byManager: enhancedDependencies.reduce((acc, dep) => {
        acc[dep.packageManager] = (acc[dep.packageManager] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      sampleDeps: enhancedDependencies.slice(0, 10).map(d => `${d.name}:${d.version}`)
    });
    
    return enhancedDependencies;
  }

  /**
   * Run mvn dependency:tree command to get actual resolved dependency tree
   */
  private async runMavenDependenciesCommand(mavenDeps: Dependency[], repoPath: string): Promise<Dependency[]> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const fs = await import('fs');
    const path = await import('path');
    const execAsync = promisify(exec);

    logger.info(`🎯 MAVEN ANALYSIS STARTING in: ${repoPath}`);
    logger.info(`🔍 Input dependencies to resolve: ${mavenDeps.length}`);
    mavenDeps.forEach(dep => logger.info(`   📄 ${dep.filePath}: ${dep.name}:${dep.version}`));

    // Verify the repository path exists and has Maven files
    const pomXmlPath = path.join(repoPath, 'pom.xml');
    const mvnwPath = path.join(repoPath, 'mvnw');
    
    logger.info(`🔍 Checking Maven files in: ${repoPath}`);
    logger.info(`  - pom.xml: ${pomXmlPath} (exists: ${fs.existsSync(pomXmlPath)})`);
    logger.info(`  - mvnw: ${mvnwPath} (exists: ${fs.existsSync(mvnwPath)})`);

    if (!fs.existsSync(pomXmlPath)) {
      logger.warn('❌ No pom.xml found in repository - skipping Maven resolution');
      return [];
    }

    // Make mvnw executable if it exists
    if (fs.existsSync(mvnwPath)) {
      try {
        fs.chmodSync(mvnwPath, '755');
        logger.info('✅ Made mvnw executable');
      } catch (error) {
        logger.warn('⚠️ Could not make mvnw executable:', error);
      }
    }

    try {
      // Run mvn dependency:tree to get the full dependency tree
      const mvnCmd = fs.existsSync(mvnwPath) ? './mvnw dependency:tree' : 'mvn dependency:tree';
      
      logger.info(`🚀 EXECUTING: ${mvnCmd}`);
      logger.info(`⏰ Starting Maven dependency tree extraction...`);

      const { stdout, stderr } = await execAsync(mvnCmd, {
        cwd: repoPath,
        timeout: 120000, // 2 minutes
        maxBuffer: 5 * 1024 * 1024, // 5MB buffer
        killSignal: 'SIGTERM'
      });

      logger.info(`✅ Maven dependency:tree command completed successfully`);
      logger.info(`📊 Output size: ${stdout.length} characters, stderr: ${stderr.length} characters`);

      if (stderr) {
        logger.warn(`⚠️ STDERR (first 500 chars): ${stderr.substring(0, 500)}`);
      }

      // Parse the dependency tree output
      const dependencies = this.parseMavenDependencyTreeOutput(stdout);
      logger.info(`🎯 Successfully parsed ${dependencies.length} dependencies from Maven tree`);
      
      // Log sample dependencies
      if (dependencies.length > 0) {
        logger.info('📋 Sample Maven dependencies (first 5):');
        dependencies.slice(0, 5).forEach(dep => 
          logger.info(`   ✅ ${dep.name}:${dep.version} (${dep.type})`)
        );
      }
      
      return dependencies;

    } catch (error: any) {
      logger.error(`❌ Maven dependency:tree command failed:`, error.message);
      
      // Handle specific error types
      if (error.code === 'TIMEOUT' || error.signal === 'SIGTERM') {
        logger.error(`⏰ Command timed out after 2 minutes`);
      } else if (error.code === 'EMFILE' || error.code === 'ENOMEM') {
        logger.error(`💾 System resource exhaustion (memory/file handles)`);
      } else if (error.message?.includes('maxBuffer')) {
        logger.error(`📊 Output too large (>5MB) - may need streaming approach`);
      }
      
      return []; // Return empty array to continue with other projects
    }
  }

  /**
   * Parse Maven dependency:tree output to extract dependencies
   */
  private parseMavenDependencyTreeOutput(output: string): Dependency[] {
    const dependencies: Dependency[] = [];
    
    // Strip ANSI color codes that can interfere with parsing
    const cleanOutput = output.replace(/\u001b\[[0-9;]*m/g, '');
    const lines = cleanOutput.split('\n');
    
    logger.info(`🔍 Parsing Maven dependency:tree output...`);
    logger.info(`📏 Output length: ${output.length} chars, cleaned: ${cleanOutput.length} chars`);
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip empty lines and non-dependency lines
      if (!trimmedLine || trimmedLine.startsWith('[WARNING]') || trimmedLine.startsWith('[ERROR]')) {
        continue;
      }
      
      // Parse dependency lines like:
      // [INFO] +- org.springframework.boot:spring-boot-starter-web:jar:2.7.0:compile
      // [INFO] |  +- org.springframework.boot:spring-boot-starter:jar:2.7.0:compile
      // [INFO] |     +- org.springframework.boot:spring-boot:jar:2.7.0:compile
      // [INFO] +- com.google.code.gson:gson:jar:1.10.2:compile
      
      // First, try to match lines with tree structure (contains +- or \-)
      let dependencyMatch = trimmedLine.match(/\[INFO\]\s*\+-\s*([^:]+):([^:]+):([^:]+):([^:]+):([^:]+)/);
      
      if (!dependencyMatch) {
        // Try pattern for lines with \- structure
        dependencyMatch = trimmedLine.match(/\[INFO\]\s*\\-\s*([^:]+):([^:]+):([^:]+):([^:]+):([^:]+)/);
      }
      
      if (!dependencyMatch) {
        // Try pattern for lines with pipe and tree structure (like "|  +- " or "|     \- ")
        dependencyMatch = trimmedLine.match(/\[INFO\]\s*\|\s*\+-\s*([^:]+):([^:]+):([^:]+):([^:]+):([^:]+)/);
      }
      
      if (!dependencyMatch) {
        // Try pattern for lines with pipe and backslash structure (like "|     \- ")
        dependencyMatch = trimmedLine.match(/\[INFO\]\s*\|\s*\\-\s*([^:]+):([^:]+):([^:]+):([^:]+):([^:]+)/);
      }
      
      if (!dependencyMatch) {
        // Try pattern for lines with multiple pipes and tree structure (like "|  |  +- " or "|  |     \- ")
        dependencyMatch = trimmedLine.match(/\[INFO\]\s*\|\s*\|\s*\+-\s*([^:]+):([^:]+):([^:]+):([^:]+):([^:]+)/);
      }
      
      if (!dependencyMatch) {
        // Try pattern for lines with multiple pipes and backslash structure (like "|  |     \- ")
        dependencyMatch = trimmedLine.match(/\[INFO\]\s*\|\s*\|\s*\\-\s*([^:]+):([^:]+):([^:]+):([^:]+):([^:]+)/);
      }
      
      if (!dependencyMatch) {
        // Try pattern for lines with any number of pipes and tree structure
        dependencyMatch = trimmedLine.match(/\[INFO\]\s*(?:\|\s*)+\+-\s*([^:]+):([^:]+):([^:]+):([^:]+):([^:]+)/);
      }
      
      if (!dependencyMatch) {
        // Try pattern for lines with any number of pipes and backslash structure
        dependencyMatch = trimmedLine.match(/\[INFO\]\s*(?:\|\s*)+\\-\s*([^:]+):([^:]+):([^:]+):([^:]+):([^:]+)/);
      }
      
      if (!dependencyMatch) {
        // Try alternative pattern for lines without the tree structure but still have dependency info
        dependencyMatch = trimmedLine.match(/\[INFO\]\s*([^:]+):([^:]+):([^:]+):([^:]+):([^:]+)/);
      }
      
      if (dependencyMatch) {
        const [, groupId, artifactId, packaging, version, scope] = dependencyMatch;
        
        // Skip test scope dependencies for now (focus on runtime dependencies)
        if (scope === 'test') {
          continue;
        }
        
        // Clean up groupId and artifactId by removing any tree structure symbols and whitespace
        const cleanGroupId = this.cleanDependencyName(groupId);
        const cleanArtifactId = this.cleanDependencyName(artifactId);
        
        const fullName = `${cleanGroupId}:${cleanArtifactId}`;
        
        // Determine if this is a transitive dependency based on the tree structure
        // If the line contains pipes (|) or is indented, it's a transitive dependency
        const isTransitive = trimmedLine.includes('|') || trimmedLine.includes('\\-') || 
                            (trimmedLine.match(/^\s*\[INFO\]\s*[+|\\]\-\-/) && !trimmedLine.match(/^\s*\[INFO\]\s*\+-\s*[^|]/));
        
        const depType = isTransitive ? 'transitive' : 'direct';
        
        // Check if this dependency is already in our list
        const existingDep = dependencies.find(d => d.name === fullName);
        if (!existingDep) {
          dependencies.push({
            name: fullName,
            version: version,
            type: depType as 'direct' | 'transitive',
            packageManager: 'maven' as PackageManager,
            filePath: 'pom.xml',
            isDev: scope === 'test',
            // Add comment for transitive dependencies
            comment: depType === 'transitive' ? 'Transitive dependency - handled separately' : undefined,
          });
        }
      }
    }
    
    logger.info(`✅ Created ${dependencies.length} clean Maven dependency objects`);
    return dependencies;
  }

  /**
   * Clean dependency name by removing tree structure symbols and whitespace
   */
  private cleanDependencyName(name: string): string {
    return name
      .replace(/^\+-\s*/, '') // Remove leading "+- "
      .replace(/^\\-\s*/, '') // Remove leading "\- "
      .replace(/^\|\s*/, '') // Remove leading pipe and spaces
      .replace(/^\s+/, '') // Remove leading whitespace
      .replace(/\s+$/, '') // Remove trailing whitespace
      .trim();
  }

  /**
   * Run gradle dependencies command to get actual resolved dependency tree
   */
  private async runGradleDependenciesCommand(gradleDeps: Dependency[], repoPath: string): Promise<Dependency[]> {
    const { spawn } = await import('child_process');
    const path = await import('path');
    const fs = await import('fs');

    logger.info(`🎯 GRADLE ANALYSIS STARTING in: ${repoPath}`);
    logger.info(`🔍 Input dependencies to resolve: ${gradleDeps.length}`);
    gradleDeps.forEach(dep => logger.info(`   📄 ${dep.filePath}: ${dep.name}:${dep.version}`));

    // Verify the repository path exists and has Gradle files
    const gradlewPath = path.join(repoPath, 'gradlew');
    const buildGradlePath = path.join(repoPath, 'build.gradle');
    
    logger.info(`🔍 Checking Gradle files in: ${repoPath}`);
    logger.info(`  - gradlew: ${gradlewPath} (exists: ${fs.existsSync(gradlewPath)})`);
    logger.info(`  - build.gradle: ${buildGradlePath} (exists: ${fs.existsSync(buildGradlePath)})`);

    if (!fs.existsSync(gradlewPath) && !fs.existsSync(buildGradlePath)) {
      logger.warn('❌ No Gradle files found in repository - skipping Gradle resolution');
      return [];
    }

    // Make gradlew executable if it exists (crucial for exec to work)
    if (fs.existsSync(gradlewPath)) {
      try {
        fs.chmodSync(gradlewPath, '755');
        logger.info('✅ Made gradlew executable');
      } catch (error) {
        logger.warn('⚠️ Could not make gradlew executable:', error);
      }
    }

    try {
      // Step 1: Discover all projects using ./gradlew projects
      logger.info('📋 STEP 1: Discovering Gradle projects...');
      const projects = await this.discoverGradleProjects(repoPath);
      logger.info(`✅ Discovered ${projects.length} Gradle projects:`, projects);
      
      if (projects.length === 0) {
        logger.warn('⚠️ No Gradle projects discovered! Checking build system...');
        
        // Check what build system this repository uses
        const fs = await import('fs');
        const path = await import('path');
        const buildSystemInfo = this.detectBuildSystem(repoPath);
        logger.info(`🔍 Detected build systems: ${JSON.stringify(buildSystemInfo)}`);
        
        if (buildSystemInfo.gradle) {
          logger.warn('📋 Repository has Gradle files but no projects found. Trying root project...');
          const rootDeps = await this.getProjectDependencies(repoPath, '');
          logger.info(`📦 Root project dependencies: ${rootDeps.length}`);
          if (rootDeps.length > 0) {
            logger.info('📋 Sample root dependencies:');
            rootDeps.slice(0, 5).forEach(dep => 
              logger.info(`   ✅ ${dep.name}:${dep.version}`)
            );
          }
          return rootDeps;
        } else {
          logger.info(`📋 Repository uses non-Gradle build system. Build files found: ${Object.keys(buildSystemInfo).filter(k => buildSystemInfo[k]).join(', ')}`);
          return []; // Return empty for non-Gradle projects
        }
      }
      
      // Step 2: Run dependencies command for each project
      const allDependencies: Dependency[] = [];
      let successCount = 0;
      let failureCount = 0;
      
      for (const project of projects) {
        logger.info(`🔍 STEP 2.${projects.indexOf(project) + 1}: Getting dependencies for project: ${project}`);
        
        try {
          const projectDeps = await this.getProjectDependencies(repoPath, project);
          
          if (projectDeps.length > 0) {
            allDependencies.push(...projectDeps);
            successCount++;
            logger.info(`   ✅ Success: Got ${projectDeps.length} dependencies from ${project}`);
          } else {
            failureCount++;
            logger.warn(`   ⚠️ Warning: Got 0 dependencies from ${project}`);
          }
          
        } catch (projectError: any) {
          failureCount++;
          logger.error(`   ❌ Failed to get dependencies for ${project}:`, projectError.message);
          // Continue with other projects instead of failing entirely
        }
      }
      
      logger.info(`📊 Project Summary: ${successCount} successful, ${failureCount} failed`);
      
      if (allDependencies.length === 0 && projects.length > 0) {
        logger.error(`❌ No dependencies resolved from any project - this indicates a serious issue`);
        // Don't throw error, let the validation in buildDependencyTree handle it
      }
      
      logger.info(`🎯 GRADLE ANALYSIS COMPLETE: ${allDependencies.length} total resolved dependencies`);
      
      if (allDependencies.length > 0) {
        logger.info('🔍 Sample resolved dependencies:');
        allDependencies.slice(0, 5).forEach(dep => 
          logger.info(`   ✅ ${dep.name}:${dep.version} (${dep.type})`)
        );
      }
      
      return allDependencies;
      
    } catch (error) {
      logger.error('❌ GRADLE ANALYSIS FAILED:', error);
      return [];
    }
  }

  /**
   * Discover all Gradle projects using ./gradlew projects
   */
  private async discoverGradleProjects(repoPath: string): Promise<string[]> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    logger.info(`📋 STEP 1: Discovering Gradle projects...`);
    logger.info(`📁 Working directory: ${repoPath}`);

    try {
      // Check if gradlew exists and make it executable
      const fs = await import('fs');
      const path = await import('path');
      const gradlewPath = path.join(repoPath, 'gradlew');
      
      if (!fs.existsSync(gradlewPath)) {
        logger.warn(`⚠️ Gradle wrapper not found at ${gradlewPath}`);
        return [];
      }
      
      // Make gradlew executable
      fs.chmodSync(gradlewPath, '755');
      logger.info(`✅ Made gradlew executable`);
      
      // Upgrade Gradle wrapper if needed for Java 17 compatibility
      await this.upgradeGradleWrapperIfNeeded(repoPath);

      logger.info(`🚀 EXECUTING: ./gradlew projects (first-time repository setup may take several minutes)`);
      
                    const { stdout, stderr } = await execAsync('./gradlew projects', {
                cwd: repoPath,
                timeout: 480000, // 8 minutes for large projects (first-time downloads)
                maxBuffer: 4 * 1024 * 1024 // 4MB buffer (increased for larger outputs)
              });

      if (stderr) {
        logger.warn(`⚠️ STDERR from gradlew projects: ${stderr}`);
      }

      logger.info(`✅ gradlew projects completed successfully`);
      const projects = this.parseGradleProjects(stdout);
      logger.info(`📋 Found ${projects.length} Gradle projects: ${projects.join(', ')}`);
      return projects;

    } catch (error: any) {
      logger.error(`❌ gradlew projects failed:`, {
        message: error.message,
        code: error.code,
        signal: error.signal,
        stdout: error.stdout ? error.stdout.substring(0, 500) : 'No stdout',
        stderr: error.stderr ? error.stderr.substring(0, 500) : 'No stderr',
        cmd: error.cmd || './gradlew projects'
      });
      
      // Check if gradlew exists and is executable
      const fs = await import('fs');
      const path = await import('path');
      const gradlewPath = path.join(repoPath, 'gradlew');
      const buildGradlePath = path.join(repoPath, 'build.gradle');
      const buildGradleKtsPath = path.join(repoPath, 'build.gradle.kts');
      
      logger.info(`🔍 Gradle files status:`, {
        'gradlew exists': fs.existsSync(gradlewPath),
        'gradlew executable': fs.existsSync(gradlewPath) ? (fs.statSync(gradlewPath).mode & parseInt('111', 8)) !== 0 : false,
        'build.gradle exists': fs.existsSync(buildGradlePath),
        'build.gradle.kts exists': fs.existsSync(buildGradleKtsPath)
      });
      
      return []; // Return empty array for fallback
    }
  }

  /**
   * Upgrade Gradle wrapper to a compatible version for Java 17+
   */
  private async upgradeGradleWrapperIfNeeded(repoPath: string): Promise<void> {
    try {
      const fs = await import('fs');
      const path = await import('path');
      
      const gradleWrapperPropertiesPath = path.join(repoPath, 'gradle', 'wrapper', 'gradle-wrapper.properties');
      
      if (!fs.existsSync(gradleWrapperPropertiesPath)) {
        logger.info(`📋 No gradle-wrapper.properties found, skipping upgrade`);
        return;
      }
      
      // Read current Gradle version
      const propertiesContent = fs.readFileSync(gradleWrapperPropertiesPath, 'utf8');
      const versionMatch = propertiesContent.match(/distributionUrl=.*gradle-(\d+\.\d+\.\d+)-bin\.zip/);
      
      if (!versionMatch) {
        logger.info(`📋 Could not parse current Gradle version, skipping upgrade`);
        return;
      }
      
      const currentVersion = versionMatch[1];
      logger.info(`🔍 Current Gradle version: ${currentVersion}`);
      
      // Check if we need to upgrade (Gradle 7.0.2 and below don't support Java 17)
      const versionParts = currentVersion.split('.').map(Number);
      const needsUpgrade = versionParts[0] < 7 || (versionParts[0] === 7 && versionParts[1] === 0 && versionParts[2] <= 2);
      
      if (!needsUpgrade) {
        logger.info(`✅ Gradle version ${currentVersion} is compatible with Java 17`);
        return;
      }
      
      logger.info(`🔄 Manually upgrading Gradle from ${currentVersion} to 8.5 for Java 17 compatibility`);
      
      // Manually update the gradle-wrapper.properties file
      const newPropertiesContent = propertiesContent.replace(
        /distributionUrl=.*gradle-\d+\.\d+\.\d+-bin\.zip/,
        'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.5-bin.zip'
      );
      
      // Write the updated properties file
      fs.writeFileSync(gradleWrapperPropertiesPath, newPropertiesContent, 'utf8');
      
      // Clear the Gradle cache to force re-download
      const gradleCachePath = path.join(process.env.HOME || '', '.gradle', 'wrapper', 'dists');
      if (fs.existsSync(gradleCachePath)) {
        logger.info(`🧹 Clearing Gradle wrapper cache to force re-download`);
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        
        try {
          await execAsync(`rm -rf "${gradleCachePath}"`, { timeout: 10000 });
          logger.info(`✅ Gradle wrapper cache cleared`);
        } catch (cacheError) {
          logger.warn(`⚠️ Failed to clear Gradle cache: ${cacheError}`);
        }
      }
      
      logger.info(`✅ Gradle wrapper manually upgraded to 8.5`);
      
    } catch (error: any) {
      logger.warn(`⚠️ Failed to upgrade Gradle wrapper: ${error.message}`);
      // Don't throw - continue with original version
    }
  }

  /**
   * Detect what build system(s) a repository uses
   */
  private detectBuildSystem(repoPath: string): { [key: string]: boolean } {
    const fs = require('fs');
    const path = require('path');
    
    const buildSystems = {
      gradle: false,
      maven: false,
      npm: false,
      python: false,
      go: false,
      rust: false,
      docker: false,
      makefile: false
    };
    
    try {
      // Check for Gradle
      buildSystems.gradle = fs.existsSync(path.join(repoPath, 'build.gradle')) ||
                           fs.existsSync(path.join(repoPath, 'build.gradle.kts')) ||
                           fs.existsSync(path.join(repoPath, 'gradlew')) ||
                           fs.existsSync(path.join(repoPath, 'settings.gradle')) ||
                           fs.existsSync(path.join(repoPath, 'settings.gradle.kts'));
      
      // Check for Maven
      buildSystems.maven = fs.existsSync(path.join(repoPath, 'pom.xml')) ||
                          fs.existsSync(path.join(repoPath, 'mvnw'));
      
      // Check for npm/Node.js
      buildSystems.npm = fs.existsSync(path.join(repoPath, 'package.json')) ||
                        fs.existsSync(path.join(repoPath, 'yarn.lock')) ||
                        fs.existsSync(path.join(repoPath, 'package-lock.json'));
      
      // Check for Python
      buildSystems.python = fs.existsSync(path.join(repoPath, 'setup.py')) ||
                           fs.existsSync(path.join(repoPath, 'pyproject.toml')) ||
                           fs.existsSync(path.join(repoPath, 'requirements.txt')) ||
                           fs.existsSync(path.join(repoPath, 'Pipfile'));
      
      // Check for Go
      buildSystems.go = fs.existsSync(path.join(repoPath, 'go.mod')) ||
                       fs.existsSync(path.join(repoPath, 'go.sum'));
      
      // Check for Rust
      buildSystems.rust = fs.existsSync(path.join(repoPath, 'Cargo.toml')) ||
                         fs.existsSync(path.join(repoPath, 'Cargo.lock'));
      
      // Check for Docker
      buildSystems.docker = fs.existsSync(path.join(repoPath, 'Dockerfile')) ||
                           fs.existsSync(path.join(repoPath, 'docker-compose.yml')) ||
                           fs.existsSync(path.join(repoPath, 'docker-compose.yaml'));
      
      // Check for Makefile
      buildSystems.makefile = fs.existsSync(path.join(repoPath, 'Makefile')) ||
                             fs.existsSync(path.join(repoPath, 'makefile'));
                             
    } catch (error) {
      logger.warn(`⚠️ Error detecting build systems: ${error}`);
    }
    
    return buildSystems;
  }

  /**
   * Parse output of ./gradlew projects to extract project names
   */
  private parseGradleProjects(output: string): string[] {
    const projects: string[] = [];
    const lines = output.split('\n');
    
    logger.info('🔍 Parsing gradle projects output...');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Look for lines like: 
      // "+--- Project ':marketplace-zendesk-service'"
      // "\--- Project ':marketplace-zendesk-service-postsync'"
      // "Root project 'marketplace-zendesk-service'"
      
      // Pattern 1: Subproject lines
      const subprojectMatch = trimmedLine.match(/[+\\]\-\-\-\s+Project\s+'([^']+)'/);
      if (subprojectMatch) {
        const projectName = subprojectMatch[1];
        if (projectName !== ':') { // Skip root project reference
          projects.push(projectName);
          logger.info(`📁 Found subproject: ${projectName}`);
        }
        continue;
      }
      
      // Pattern 2: Root project line (backup)
      const rootProjectMatch = trimmedLine.match(/Root\s+project\s+'([^']+)'/);
      if (rootProjectMatch && projects.length === 0) {
        // Only use root project if no subprojects found
        const rootName = rootProjectMatch[1];
        logger.info(`📁 Found root project: ${rootName} (will be used as fallback)`);
      }
    }
    
    // Validate and clean project names
    const validProjects = projects.filter(project => {
      if (!project || project.trim() === '') {
        logger.warn(`⚠️ Skipping empty project name`);
        return false;
      }
      if (project === ':') {
        logger.warn(`⚠️ Skipping root project reference`);
        return false;
      }
      return true;
    });
    
    logger.info(`📋 Total valid projects found: ${validProjects.length}`);
    return validProjects;
  }

  /**
   * Normalize Gradle project name to ensure proper syntax
   */
  private normalizeGradleProject(project: string): string {
    if (!project) return '';
    
    // Remove any leading colons and invalid characters, then add exactly one colon prefix
    const cleanName = project.replace(/^:+/, '').replace(/[^a-zA-Z0-9-_]/g, '');
    return `:${cleanName}`;
  }

  /**
   * Get dependencies for a specific Gradle project using JSON output
   */
  private async getProjectDependencies(repoPath: string, projectName: string): Promise<Dependency[]> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const fs = await import('fs');
    const path = await import('path');
    const execAsync = promisify(exec);

    // Normalize project name to handle edge cases with colons and invalid characters
    const normalizedProjectName = projectName ? this.normalizeGradleProject(projectName) : '';
    
    logger.info(`🚀 Getting dependencies for project: ${projectName || 'root'}`);
    logger.info(`📁 Working directory: ${repoPath}`);
    logger.info(`🔧 Project name: '${projectName}' → normalized: '${normalizedProjectName}'`);

    try {
      // Create init script for JSON output
      const initScriptContent = `
allprojects {
    afterEvaluate { project ->
        project.tasks.register("jsonDeps") {
            doLast {
                try {
                    def deps = []
                    if (project.configurations.findByName('runtimeClasspath')) {
                        // Get both direct and transitive dependencies
                        project.configurations.runtimeClasspath.resolvedConfiguration.resolvedArtifacts.each { artifact ->
                            def moduleVersion = artifact.moduleVersion.id
                            deps << [
                                group: moduleVersion.group ?: '',
                                name: moduleVersion.name ?: '',
                                version: moduleVersion.version ?: 'unspecified',
                                type: 'transitive'  // Will mark direct ones separately
                            ]
                        }
                        
                        // Mark direct dependencies
                        project.configurations.runtimeClasspath.allDependencies.each { dep ->
                            def fullName = "\${dep.group}:\${dep.name}"
                            def existing = deps.find { it.group == dep.group && it.name == dep.name }
                            if (existing) {
                                existing.type = 'direct'
                            }
                        }
                    }
                    println "JSON_START"
                    println groovy.json.JsonOutput.toJson(deps)
                    println "JSON_END"
                } catch (Exception e) {
                    println "ERROR: " + e.message
                    e.printStackTrace()
                }
            }
        }
    }
}`;

      // Write init script to temporary file
      const initScriptPath = path.join(repoPath, 'temp-init.gradle');
      fs.writeFileSync(initScriptPath, initScriptContent);
      
      const gradleCmd = projectName 
        ? `./gradlew ${normalizedProjectName}:jsonDeps --init-script temp-init.gradle`
        : `./gradlew jsonDeps --init-script temp-init.gradle`;
    
      logger.info(`🚀 EXECUTING: ${gradleCmd}`);
      logger.info(`⏰ Starting JSON dependency extraction (this may take several minutes for first-time downloads)...`);

      const { stdout, stderr } = await execAsync(gradleCmd, {
        cwd: repoPath,
        timeout: 480000, // 8 minutes (increased for first-time dependency downloads)
        maxBuffer: 30 * 1024 * 1024, // 30MB buffer (increased for larger dependency trees)
        killSignal: 'SIGTERM'
      });

      // Clean up temp file
      try {
        fs.unlinkSync(initScriptPath);
      } catch (cleanupError) {
        logger.warn(`⚠️ Could not clean up temp init script: ${cleanupError}`);
      }

      logger.info(`✅ Gradle JSON command completed successfully`);
      logger.info(`📊 Output size: ${stdout.length} characters, stderr: ${stderr.length} characters`);

      if (stderr) {
        logger.warn(`⚠️ STDERR (first 500 chars): ${stderr.substring(0, 500)}`);
        
        // Check for common Gradle resolution issues
        if (stderr.includes('Could not resolve all dependencies')) {
          logger.warn(`🔍 Detected dependency resolution failure - likely missing or misconfigured repositories`);
        }
        if (stderr.includes('ResolveException')) {
          logger.warn(`🔍 Detected ResolveException - dependency resolution failed for this project`);
        }
        if (stderr.includes('BUILD FAILED')) {
          logger.warn(`🔍 Detected build failure - project may have compilation or configuration issues`);
        }
        if (stderr.includes('Deprecated Gradle features')) {
          logger.warn(`🔍 Detected deprecated Gradle features - this may cause compatibility issues`);
        }
      }

      // Extract JSON from output
      const dependencies = this.parseJsonDependenciesOutput(stdout, projectName || 'root');
      logger.info(`🎯 Successfully parsed ${dependencies.length} dependencies from JSON`);
      
      // Log sample dependencies (limit to prevent log spam)
      if (dependencies.length > 0) {
        logger.info('📋 Sample JSON dependencies (first 3):');
        dependencies.slice(0, 3).forEach(dep => 
          logger.info(`   ✅ ${dep.name}:${dep.version}`)
        );
      }
      
      return dependencies;

    } catch (error: any) {
      logger.error(`❌ Gradle JSON command failed for project: ${projectName}`);
      logger.error(`💥 Error type: ${error.code || error.name || 'Unknown'}`);
      logger.error(`💥 Error message: ${error.message}`);
      
      // Handle specific error types
      if (error.code === 'TIMEOUT' || error.signal === 'SIGTERM') {
        logger.error(`⏰ Command timed out after 2 minutes`);
      } else if (error.code === 'EMFILE' || error.code === 'ENOMEM') {
        logger.error(`💾 System resource exhaustion (memory/file handles)`);
      } else if (error.message?.includes('maxBuffer')) {
        logger.error(`📊 Output too large (>5MB) - may need streaming approach`);
      }
      
      return []; // Return empty array to continue with other projects
    } finally {
      // Clean up temporary init script to avoid polluting repository
      try {
        const initScriptPath = path.join(repoPath, 'temp-init.gradle');
        if (fs.existsSync(initScriptPath)) {
          fs.unlinkSync(initScriptPath);
          logger.info(`🧹 Cleaned up temporary init script: temp-init.gradle`);
        }
      } catch (cleanupError) {
        logger.warn(`⚠️ Failed to cleanup temp-init.gradle: ${cleanupError}`);
      }
    }
  }

  /**
   * Parse JSON dependencies output from init script
   */
  private parseJsonDependenciesOutput(output: string, projectName: string): Dependency[] {
    const dependencies: Dependency[] = [];
    
    try {
      logger.info(`🔍 Parsing JSON dependencies output for ${projectName}...`);
      
      // Extract JSON between markers
      const jsonStartIndex = output.indexOf('JSON_START');
      const jsonEndIndex = output.indexOf('JSON_END');
      
      if (jsonStartIndex === -1 || jsonEndIndex === -1) {
        logger.warn(`⚠️ JSON markers not found in output for ${projectName}`);
        logger.info(`📝 Output sample: ${output.substring(0, 300)}`);
        return [];
      }
      
      const jsonString = output.substring(jsonStartIndex + 'JSON_START'.length, jsonEndIndex).trim();
      logger.info(`📦 Extracted JSON string length: ${jsonString.length} characters`);
      
      if (!jsonString) {
        logger.warn(`⚠️ Empty JSON string for ${projectName}`);
        return [];
      }
      
      const depsArray = JSON.parse(jsonString);
      logger.info(`🎯 Parsed ${depsArray.length} dependencies from JSON`);
      
      for (const dep of depsArray) {
        if (!dep.group || !dep.name) {
          continue; // Skip invalid entries
        }
        
        const fullName = `${dep.group}:${dep.name}`;
        const cleanVersion = dep.version === 'unspecified' ? 'latest' : dep.version;
        const depType = dep.type || 'direct'; // Use the type from JSON, default to direct
        
        dependencies.push({
          name: fullName,
          version: cleanVersion,
          type: depType as 'direct' | 'transitive',
          packageManager: 'gradle' as PackageManager,
          filePath: `${projectName}/build.gradle`,
          isDev: false,
          // Add comment for transitive dependencies
          comment: depType === 'transitive' ? 'Transitive dependency - handled separately' : undefined,
        });
      }
      
      logger.info(`✅ Created ${dependencies.length} clean dependency objects from JSON`);
      return dependencies;
      
    } catch (parseError: any) {
      logger.error(`❌ Failed to parse JSON dependencies for ${projectName}:`, parseError.message);
      logger.info(`📝 Raw output sample: ${output.substring(0, 500)}`);
      return [];
    }
  }

  /**
   * Analyze vulnerabilities against dependencies
   */
  async analyzeVulnerabilities(
    dependencies: Dependency[], 
    vulnerabilities: Vulnerability[]
  ): Promise<{ affectedDependencies: Dependency[]; suggestions: FixSuggestion[] }> {
    try {
      logger.info(`Analyzing ${vulnerabilities.length} vulnerabilities against ${dependencies.length} dependencies`);

      // Log sample dependencies for debugging
      const gradleDeps = dependencies.filter(d => d.packageManager === 'gradle').slice(0, 5);
      logger.info(`Sample Gradle dependencies:`, {
        count: dependencies.filter(d => d.packageManager === 'gradle').length,
        samples: gradleDeps.map(d => ({ name: d.name, version: d.version, ecosystem: d.packageManager }))
      });

      const affectedDependencies: Dependency[] = [];
      const suggestions: FixSuggestion[] = [];

      for (const vulnerability of vulnerabilities) {
        logger.info(`Checking vulnerability ${vulnerability.id} with ${vulnerability.affectedPackages.length} affected packages`);
        
        for (const affectedPackage of vulnerability.affectedPackages) {
          logger.info(`Looking for package: "${affectedPackage.name}" (${affectedPackage.ecosystem}) among ${dependencies.length} dependencies`);
          
          // Find matching dependencies
          const matchingDeps = dependencies.filter(dep => 
            this.isPackageMatch(dep, affectedPackage.name, affectedPackage.ecosystem) &&
            this.isVersionAffected(dep.version, affectedPackage.affectedVersions)
          );

          for (const dep of matchingDeps) {
            if (!affectedDependencies.some(existing => 
              existing.name === dep.name && existing.packageManager === dep.packageManager
            )) {
              affectedDependencies.push(dep);
            }

            // Generate fix suggestion
            const suggestion = this.generateFixSuggestion(dep, vulnerability, affectedPackage);
            if (suggestion) {
              suggestions.push(suggestion);
            }
          }
        }
      }

      logger.info(`Found ${affectedDependencies.length} affected dependencies with ${suggestions.length} fix suggestions`);
      
      return { affectedDependencies, suggestions };
    } catch (error: any) {
      logger.error('Error analyzing vulnerabilities:', error);
      throw new Error(`Failed to analyze vulnerabilities: ${error.message}`);
    }
  }

  /**
   * Check if a dependency matches a package name and ecosystem
   */
  private isPackageMatch(dependency: Dependency, packageName: string, ecosystem: PackageManager): boolean {
    // Normalize ecosystems for compatibility
    const normalizeEcosystem = (eco: PackageManager | string): string => {
      if (eco === 'gradle' || eco === 'maven') return 'maven';
      return eco as string;
    };

    const depEcosystem = normalizeEcosystem(dependency.packageManager);
    const vulnEcosystem = normalizeEcosystem(ecosystem);

    // Check if package manager matches (with normalization)
    if (depEcosystem !== vulnEcosystem) {
      logger.debug(`Package manager mismatch: ${dependency.packageManager} (${depEcosystem}) !== ${ecosystem} (${vulnEcosystem}) for ${dependency.name}`);
      return false;
    }

    // Check if package name matches (case-insensitive)
    const nameMatch = dependency.name.toLowerCase() === packageName.toLowerCase();
    
    if (!nameMatch) {
      logger.debug(`Package name mismatch: "${dependency.name}" !== "${packageName}"`);
    } else {
      logger.info(`🎯 FOUND MATCH: ${dependency.name} matches ${packageName} (${dependency.packageManager} -> ${ecosystem})`);
    }
    
    return nameMatch;
  }

  /**
   * Check if a version is affected by vulnerability
   */
  private isVersionAffected(version: string, affectedVersions: string[]): boolean {
    if (version === '*') {
      return true; // Wildcard versions are considered affected
    }

    try {
      const depVersion = semver.coerce(version);
      if (!depVersion) {
        return true; // If we can't parse version, assume affected
      }

      for (const affectedRange of affectedVersions) {
        if (this.isVersionInRange(depVersion.version, affectedRange)) {
          return true;
        }
      }

      return false;
    } catch {
      // If semver parsing fails, do string comparison
      return affectedVersions.some(range => 
        version.includes(range) || range.includes(version)
      );
    }
  }

  /**
   * Check if a version is in a given range
   */
  private isVersionInRange(version: string, range: string): boolean {
    try {
      return semver.satisfies(version, range);
    } catch {
      // Fall back to simple comparison
      return version === range;
    }
  }

  /**
   * Generate fix suggestion for a vulnerable dependency
   */
  private generateFixSuggestion(
    dependency: Dependency, 
    vulnerability: Vulnerability,
    affectedPackage: any
  ): FixSuggestion | null {
    try {
      // Determine the best fixed version
      let suggestedVersion: string | null = null;
      let updateType: UpdateType = 'patch';

      if (affectedPackage.fixedVersions && affectedPackage.fixedVersions.length > 0) {
        // Find the lowest fixed version that's higher than current
        const currentVersion = semver.coerce(dependency.version);
        
        if (currentVersion) {
          const validFixedVersions = affectedPackage.fixedVersions
            .map((v: string) => semver.coerce(v))
            .filter((v: any) => v && semver.gt(v, currentVersion))
            .sort(semver.compare);

          if (validFixedVersions.length > 0) {
            suggestedVersion = validFixedVersions[0].version;
            
            // Determine update type
            if (semver.major(validFixedVersions[0]) > semver.major(currentVersion)) {
              updateType = 'major';
            } else if (semver.minor(validFixedVersions[0]) > semver.minor(currentVersion)) {
              updateType = 'minor';
            } else {
              updateType = 'patch';
            }
          }
        }
      }

      if (!suggestedVersion) {
        // Try to extract recommended version from JIRA ticket data
        suggestedVersion = this.extractRecommendedVersionFromJira(vulnerability);
        
        if (suggestedVersion && suggestedVersion !== 'latest') {
          // Calculate update type based on JIRA recommended version
          updateType = this.calculateUpdateType(dependency.version, suggestedVersion);
        } else {
          // Last resort: suggest latest but try to be smart about update type
          suggestedVersion = 'latest';
          updateType = this.inferUpdateTypeFromVulnerability(dependency, vulnerability);
        }
      }

      // Identify potential breaking changes
      const breakingChanges = this.identifyBreakingChanges(dependency, suggestedVersion, updateType);

      // Calculate confidence score
      const confidence = this.calculateConfidence(dependency, updateType, breakingChanges);

      const suggestion: FixSuggestion = {
        id: `fix-${dependency.name}-${vulnerability.id}`,
        dependencyName: dependency.name,
        currentVersion: dependency.version,
        suggestedVersion,
        updateType,
        fixesVulnerabilities: [vulnerability.cveId || vulnerability.id],
        breakingChanges,
        migrationNotes: this.generateMigrationNotes(dependency, updateType, breakingChanges),
        confidence,
        testingRequired: updateType === 'major' || breakingChanges.length > 0,
      };

      return suggestion;
    } catch (error) {
      logger.warn(`Error generating fix suggestion for ${dependency.name}:`, error);
      return null;
    }
  }

  /**
   * Extract recommended version from JIRA ticket data
   */
  private extractRecommendedVersionFromJira(vulnerability: Vulnerability): string | null {
    try {
      // Check if vulnerability has JIRA ticket with recommendedActions
      const jiraTicket = (vulnerability as any).jiraTicket;
      if (jiraTicket?.wizFindings?.length > 0) {
        for (const finding of jiraTicket.wizFindings) {
          if (finding.recommendedActions) {
            for (const action of finding.recommendedActions) {
              // Parse "Update commons-io:commons-io to version 2.15.1"
              const versionMatch = action.match(/(?:update|upgrade).*?(?:to\s+)?version\s+([0-9]+\.[0-9]+\.[0-9]+[a-zA-Z0-9.-]*)/i);
              if (versionMatch) {
                logger.info(`📝 Extracted version ${versionMatch[1]} from JIRA action: ${action}`);
                return versionMatch[1];
              }
            }
          }
        }
      }

      // Fallback: extract from vulnerability description  
      if (vulnerability.description) {
        const versionMatch = vulnerability.description.match(/Recommended Version:\s*([^\n\r*]+)/i);
        if (versionMatch) {
          const version = versionMatch[1].replace(/\*/g, '').trim();
          logger.info(`📝 Extracted version ${version} from vulnerability description`);
          return version;
        }
      }

      return null;
    } catch (error) {
      logger.warn('Error extracting recommended version from JIRA:', error);
      return null;
    }
  }

  /**
   * Calculate update type between two versions
   */
  private calculateUpdateType(currentVersion: string, suggestedVersion: string): UpdateType {
    try {
      const current = semver.coerce(currentVersion);
      const suggested = semver.coerce(suggestedVersion);
      
      if (!current || !suggested) {
        logger.warn(`Unable to parse versions: ${currentVersion} -> ${suggestedVersion}`);
        return 'minor'; // Conservative default
      }

      if (semver.major(suggested) > semver.major(current)) {
        return 'major';
      } else if (semver.minor(suggested) > semver.minor(current)) {
        return 'minor'; 
      } else {
        return 'patch';
      }
    } catch (error) {
      logger.warn('Error calculating update type:', error);
      return 'minor';
    }
  }

  /**
   * Infer update type from vulnerability characteristics when version is unknown
   */
  private inferUpdateTypeFromVulnerability(dependency: Dependency, vulnerability: Vulnerability): UpdateType {
    try {
      const dependencyName = dependency.name.toLowerCase();
      
      // Conservative rules for inferring update type
      if (dependencyName.includes('spring-boot') || 
          dependencyName.includes('spring-security') ||
          dependencyName.includes('spring-framework')) {
        // Spring components often have major version implications
        return 'major';
      }
      
      if (vulnerability.severity === 'critical' || vulnerability.severity === 'high') {
        // High severity vulnerabilities might require significant updates
        return 'minor';
      }
      
      // Default for most libraries - assume minor update
      return 'minor';
    } catch (error) {
      logger.warn('Error inferring update type:', error);
      return 'minor';
    }
  }

  /**
   * Identify potential breaking changes
   */
  private identifyBreakingChanges(
    dependency: Dependency, 
    suggestedVersion: string, 
    updateType: UpdateType
  ): BreakingChange[] {
    const breakingChanges: BreakingChange[] = [];

    if (updateType === 'major') {
      breakingChanges.push({
        type: 'api',
        description: 'Major version update may include breaking API changes',
        mitigation: 'Review changelog and update code accordingly',
      });
    }

    // Package-specific breaking change patterns
    if (dependency.name.includes('react') && updateType === 'major') {
      breakingChanges.push({
        type: 'behavior',
        description: 'React major updates often change component behavior',
        mitigation: 'Review React migration guide and test thoroughly',
      });
    }

    if (dependency.name.includes('webpack') && updateType === 'major') {
      breakingChanges.push({
        type: 'api',
        description: 'Webpack configuration may need updates',
        mitigation: 'Review webpack migration guide and update configuration',
      });
    }

    return breakingChanges;
  }

  /**
   * Calculate confidence score for fix suggestion
   */
  private calculateConfidence(
    dependency: Dependency, 
    updateType: UpdateType, 
    breakingChanges: BreakingChange[]
  ): number {
    let confidence = 1.0;

    // Reduce confidence for major updates
    if (updateType === 'major') {
      confidence -= 0.3;
    } else if (updateType === 'minor') {
      confidence -= 0.1;
    }

    // Reduce confidence for breaking changes
    confidence -= breakingChanges.length * 0.1;

    // Reduce confidence for dev dependencies (less critical)
    if (dependency.isDev) {
      confidence -= 0.05;
    }

    return Math.max(0.1, Math.min(1.0, confidence));
  }

  /**
   * Generate migration notes
   */
  private generateMigrationNotes(
    dependency: Dependency, 
    updateType: UpdateType, 
    breakingChanges: BreakingChange[]
  ): string | undefined {
    if (updateType === 'patch') {
      return undefined; // Patch updates typically don't need migration notes
    }

    let notes = `Updating ${dependency.name} from ${dependency.version} to suggested version.\n\n`;

    if (updateType === 'major') {
      notes += 'This is a major version update. Please:\n';
      notes += '1. Review the package changelog for breaking changes\n';
      notes += '2. Update your code to use the new API\n';
      notes += '3. Run comprehensive tests\n\n';
    } else if (updateType === 'minor') {
      notes += 'This is a minor version update. Please:\n';
      notes += '1. Review the package changelog for new features\n';
      notes += '2. Test your application thoroughly\n\n';
    }

    if (breakingChanges.length > 0) {
      notes += 'Potential breaking changes:\n';
      for (const change of breakingChanges) {
        notes += `- ${change.description}\n`;
        if (change.mitigation) {
          notes += `  Mitigation: ${change.mitigation}\n`;
        }
      }
    }

    return notes;
  }

  /**
   * Get dependency statistics
   */
  getDependencyStatistics(dependencies: Dependency[]): {
    total: number;
    byManager: Record<PackageManager, number>;
    byType: { direct: number; transitive: number };
    byEnvironment: { production: number; development: number };
  } {
    const stats = {
      total: dependencies.length,
      byManager: {} as Record<PackageManager, number>,
      byType: { direct: 0, transitive: 0 },
      byEnvironment: { production: 0, development: 0 },
    };

    for (const dep of dependencies) {
      // Count by package manager
      stats.byManager[dep.packageManager] = (stats.byManager[dep.packageManager] || 0) + 1;

      // Count by type
      if (dep.type === 'direct') {
        stats.byType.direct++;
      } else {
        stats.byType.transitive++;
      }

      // Count by environment
      if (dep.isDev) {
        stats.byEnvironment.development++;
      } else {
        stats.byEnvironment.production++;
      }
    }

    return stats;
  }
} 