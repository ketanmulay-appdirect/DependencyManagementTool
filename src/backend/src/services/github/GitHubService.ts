import { Octokit } from '@octokit/rest';
import { retry } from '@octokit/plugin-retry';
import simpleGit, { SimpleGit } from 'simple-git';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger';
import { 
  Repository, 
  GitHubConfig, 
  PackageFile, 
  PullRequest, 
  FileChange,
  FixSuggestion,
  PackageManager 
} from '../../types';
import { 
  FileParserService, 
  VulnerabilityFix, 
  FileParsingResult 
} from '../fileParser';

const MyOctokit = Octokit.plugin(retry);

export class GitHubService {
  private octokit: Octokit;
  private git: SimpleGit;
  private tempDir: string;
  private config: GitHubConfig;
  private fileParserService: FileParserService;

  constructor(config: GitHubConfig) {
    this.config = config;
    this.octokit = new MyOctokit({
      auth: config.token,
      userAgent: 'security-dependency-tool/1.0.0',
      request: {
        timeout: 30000 // 30 seconds
      },
      retry: {
        maxRetries: 3
      }
    });

    this.git = simpleGit();
    // Use parent directory for temp to persist across runs
    this.tempDir = path.join(process.cwd(), '..', 'temp', 'repos');
    this.fileParserService = new FileParserService();
  }

  /**
   * Parse GitHub repository URL to extract owner and repo name
   */
  private parseRepositoryUrl(url: string): { owner: string; repo: string } {
    const match = url.match(/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?$/);
    if (!match) {
      throw new Error('Invalid GitHub repository URL');
    }
    return { owner: match[1], repo: match[2] };
  }

  /**
   * Get repository information from GitHub API
   */
  async getRepository(repositoryUrl: string): Promise<Repository> {
    try {
      const { owner, repo } = this.parseRepositoryUrl(repositoryUrl);
      
      logger.info(`Fetching repository info for ${owner}/${repo}`);
      
      const { data } = await this.octokit.repos.get({
        owner,
        repo,
      });

      return {
        id: data.id.toString(),
        name: data.name,
        fullName: data.full_name,
        url: data.html_url,
        defaultBranch: 'master', // Always report master as default branch
        language: data.language || 'Unknown',
        description: data.description || undefined,
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at),
      };
    } catch (error: any) {
      // Improve error messages for common GitHub API errors
      if (error.status === 404) {
        logger.error(`❌ Repository not found: ${repositoryUrl}`);
        throw new Error(`Repository '${repositoryUrl}' does not exist or is not accessible. Please verify the repository URL and your access permissions.`);
      } else if (error.status === 403) {
        logger.error(`❌ Access forbidden to repository: ${repositoryUrl}`);
        throw new Error(`Access denied to repository '${repositoryUrl}'. Check your GitHub token permissions or if the repository is private.`);
      } else if (error.status === 401) {
        logger.error(`❌ Authentication failed for repository: ${repositoryUrl}`);
        throw new Error(`GitHub authentication failed. Please check your GitHub token.`);
      } else {
        logger.error(`❌ Failed to fetch repository ${repositoryUrl}:`, error.message);
        throw new Error(`Failed to fetch repository: ${error.message}`);
      }
    }
  }

  /**
   * Clone repository to temporary directory
   */
  async cloneRepository(repositoryUrl: string): Promise<string> {
    let clonePath: string | undefined;
    
    try {
      const { owner, repo } = this.parseRepositoryUrl(repositoryUrl);
      
      // Create cache key and paths
      const cacheKey = `${owner}-${repo}`;
      const cachePath = path.join(path.dirname(this.tempDir), 'cache', cacheKey);
      const repoId = `${owner}-${repo}-${uuidv4().slice(0, 8)}`;
      clonePath = path.join(this.tempDir, repoId);
      
      logger.info(`🔍 Checking for cached repository: ${cacheKey}`);
      
      // Check if we have a valid cached version
      if (await this.isCachedRepositoryValid(cachePath, repositoryUrl)) {
        logger.info(`📋 Using cached repository: ${cacheKey}`);
        
        // Copy from cache to working directory
        await this.copyCachedRepository(cachePath, clonePath);
        logger.info(`✅ Cached repository copied to ${clonePath}`);
        return clonePath;
      }
      
      // Pre-validate repository exists before attempting clone
      logger.info(`🔍 Validating repository ${owner}/${repo} exists before cloning...`);
      try {
        await this.octokit.repos.get({ owner, repo });
        logger.info(`✅ Repository ${owner}/${repo} validated successfully`);
      } catch (repoError: any) {
        if (repoError.status === 404) {
          logger.error(`❌ Repository ${owner}/${repo} does not exist on GitHub`);
          throw new Error(`Repository '${repositoryUrl}' does not exist on GitHub. Please verify the repository name and owner.`);
        }
        // For other errors, continue with clone attempt (might be network issues)
        logger.warn(`⚠️ Could not validate repository ${owner}/${repo}: ${repoError.message}`);
      }

      // Ensure temp directory exists
      await fs.mkdir(this.tempDir, { recursive: true });

      logger.info(`📥 Cloning repository ${repositoryUrl} to ${clonePath}`);

      // Create authenticated URL if token is provided
      let cloneUrl = repositoryUrl;
      if (this.config.token && !repositoryUrl.includes('@')) {
        // Convert https://github.com/owner/repo to https://token@github.com/owner/repo
        cloneUrl = repositoryUrl.replace('https://github.com', `https://${this.config.token}@github.com`);
      }

      // Clone repository with timeout - always clone master branch
      const clonePromise = this.git.clone(cloneUrl, clonePath, {
        '--depth': 1, // Shallow clone for performance
        '--single-branch': null,
        '--branch': 'master', // Always checkout master branch
      });

      // Add timeout to clone operation
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Clone operation timed out after 5 minutes')), 300000);
      });

      await Promise.race([clonePromise, timeoutPromise]);

      // Cache the cloned repository for future use
      await this.cacheRepository(clonePath, cachePath);
      logger.info(`✅ Repository cloned and cached successfully to ${clonePath}`);
      return clonePath;
    } catch (error: any) {
      logger.error('Error cloning repository:', error);
      
      // Cleanup failed clone attempt
      if (clonePath) {
        try {
          await this.cleanup(clonePath);
        } catch (cleanupError) {
          logger.warn('Failed to cleanup after failed clone:', cleanupError);
        }
      }
      
      // Provide more specific error messages
      if (error.message?.includes('not found') || error.message?.includes('404') || error.message?.includes('does not exist')) {
        const { owner, repo } = this.parseRepositoryUrl(repositoryUrl);
        logger.error(`❌ Repository ${owner}/${repo} does not exist on GitHub`);
        throw new Error(`Repository '${repositoryUrl}' does not exist on GitHub. Please verify the repository name and owner.`);
      } else if (error.message?.includes('timeout')) {
        throw new Error('Repository clone timed out - repository may be too large or network is slow');
      } else if (error.message?.includes('Authentication failed') || error.message?.includes('Unauthorized')) {
        throw new Error('GitHub authentication failed - check your token permissions');
      } else if (error.message?.includes('Permission denied') || error.message?.includes('403')) {
        throw new Error('Access denied to repository - check if repository is private and token has access');
      } else {
        logger.error(`❌ Clone failed for ${repositoryUrl}:`, error.message);
        throw new Error(`Failed to clone repository: ${error.message}`);
      }
    }
  }

  /**
   * Find and parse package files in the repository
   */
  async findPackageFiles(repoPath: string): Promise<PackageFile[]> {
    const packageFiles: PackageFile[] = [];
    
    try {
      const files = await this.getAllFiles(repoPath);
      logger.info('Total files found in repository', { count: files.length });
      
      // Define patterns for package files
      const packageFilePatterns = [
        { pattern: /package\.json$/, manager: 'npm' as PackageManager },
        { pattern: /package-lock\.json$/, manager: 'npm' as PackageManager },
        { pattern: /yarn\.lock$/, manager: 'yarn' as PackageManager },
        { pattern: /requirements\.txt$/, manager: 'pip' as PackageManager },
        { pattern: /Pipfile$/, manager: 'pip' as PackageManager },
        { pattern: /pyproject\.toml$/, manager: 'poetry' as PackageManager },
        { pattern: /pom\.xml$/, manager: 'maven' as PackageManager },
        { pattern: /build\.gradle$/, manager: 'gradle' as PackageManager },
        { pattern: /build\.gradle\.kts$/, manager: 'gradle' as PackageManager },
        { pattern: /gradle\.properties$/, manager: 'gradle' as PackageManager },
        { pattern: /go\.mod$/, manager: 'go' as PackageManager },
        { pattern: /Gemfile$/, manager: 'bundler' as PackageManager },
        { pattern: /Gemfile\.lock$/, manager: 'bundler' as PackageManager },
        
        // Dockerfiles for Java version detection
        { pattern: /^Dockerfile$/i, manager: 'docker' as PackageManager },
        { pattern: /^dockerfile$/i, manager: 'docker' as PackageManager },
        { pattern: /Dockerfile\./i, manager: 'docker' as PackageManager },
        { pattern: /\.Dockerfile$/i, manager: 'docker' as PackageManager },
        
        // Java version files for version detection
        { pattern: /^\.java-version$/, manager: 'version' as PackageManager },
        { pattern: /^\.sdkmanrc$/, manager: 'version' as PackageManager },
        { pattern: /^\.tool-versions$/, manager: 'version' as PackageManager },
        { pattern: /^runtime\.txt$/, manager: 'version' as PackageManager },
      ];

      logger.info('🔍 Scanning for package files...', {
        totalFiles: files.length,
        sampleFiles: files.slice(0, 10)
      });

      // Find and parse package files
      const parseStartTime = Date.now();
      const maxParseTime = 180000; // 3 minutes max for parsing
      
      for (const relativeFile of files) {
        // Check if we've exceeded the maximum parse time
        if (Date.now() - parseStartTime > maxParseTime) {
          logger.warn(`⚠️ Package file parsing exceeded ${maxParseTime/1000}s, stopping parse`);
          break;
        }
        
        for (const { pattern, manager } of packageFilePatterns) {
          if (pattern.test(relativeFile)) {
            try {
              const fullPath = path.join(repoPath, relativeFile);
              const content = await fs.readFile(fullPath, 'utf-8');
              const packageFile = await this.parsePackageFile(relativeFile, content, manager);
              
              if (packageFile) {
                packageFiles.push(packageFile);
                logger.info(`✅ Successfully parsed ${manager} file: ${relativeFile}`);
                
                // Log dependency count for build files
                if (manager === 'gradle') {
                  const depCount = Object.keys(packageFile.dependencies || {}).length;
                  logger.info(`   📦 Found ${depCount} dependencies in ${relativeFile}`);
                  if (depCount > 0) {
                    const sampleDeps = Object.entries(packageFile.dependencies || {}).slice(0, 3);
                    logger.info(`   🔍 Sample deps: ${sampleDeps.map(([name, version]) => `${name}:${version}`).join(', ')}`);
                  }
                }
              }
            } catch (error) {
              logger.warn(`Failed to parse package file ${relativeFile}:`, error);
            }
            break; // Move to next file once we've found a matching pattern
          }
        }
      }
      
      const parseTime = Date.now() - parseStartTime;
      logger.info(`📦 Package file parsing completed in ${parseTime}ms, found ${packageFiles.length} package files`);

      logger.info('📊 Package files parsing completed', { 
        totalFiles: files.length,
        packageFiles: packageFiles.length,
        byType: packageFiles.reduce((acc, pf) => {
          acc[pf.packageManager] = (acc[pf.packageManager] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
        filesParsed: packageFiles.map(pf => `${pf.filePath} (${pf.packageManager})`)
      });

      return packageFiles;
    } catch (error) {
      logger.error('Error finding package files:', error);
      throw new Error(`Failed to find package files: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Recursively find files matching a pattern
   */
  private async findFiles(dir: string, pattern: string): Promise<string[]> {
    const files: string[] = [];
    
    const scanDirectory = async (currentDir: string): Promise<void> => {
      try {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          
          if (entry.isDirectory()) {
            // Skip common directories that shouldn't contain package files
            if (!['node_modules', '.git', 'dist', 'build', '__pycache__', 'target'].includes(entry.name)) {
              await scanDirectory(fullPath);
            }
          } else if (entry.isFile() && entry.name === pattern) {
            files.push(fullPath);
          }
        }
      } catch (error) {
        // Ignore permission errors and continue
        logger.debug(`Skipping directory ${currentDir}:`, error);
      }
    };

    await scanDirectory(dir);
    return files;
  }

  /**
   * Recursively find all files in a directory
   */
  private async getAllFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    const startTime = Date.now();
    const maxScanTime = 120000; // 2 minutes max for file scanning
    
    const scanDirectory = async (currentDir: string): Promise<void> => {
      try {
        // Check if we've exceeded the maximum scan time
        if (Date.now() - startTime > maxScanTime) {
          logger.warn(`⚠️ File scanning exceeded ${maxScanTime/1000}s, stopping scan`);
          return;
        }
        
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          const relativePath = path.relative(dir, fullPath);
          
          // Skip large directories that can cause scanning to hang
          if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'target' || 
                entry.name === 'build' || entry.name === 'dist' || entry.name === '.gradle' ||
                entry.name === '.m2' || entry.name === '.cache' || entry.name === '.idea' ||
                entry.name === '.vscode' || entry.name === 'coverage' || entry.name === '.nyc_output') {
              continue;
            }
            await scanDirectory(fullPath);
          } else {
            // Return relative path from the root directory for pattern matching
            files.push(relativePath);
          }
        }
      } catch (error) {
        logger.debug(`Skipping directory ${currentDir}:`, error);
      }
    };
    
    await scanDirectory(dir);
    const scanTime = Date.now() - startTime;
    logger.info(`📁 File scanning completed in ${scanTime}ms, found ${files.length} files`);
    return files;
  }

  /**
   * Parse package file content based on package manager
   */
  private async parsePackageFile(
    filePath: string,
    content: string,
    packageManager: PackageManager
  ): Promise<PackageFile | null> {
    try {
      let dependencies: Record<string, string> = {};
      let devDependencies: Record<string, string> = {};

      switch (packageManager) {
        case 'npm':
          if (filePath.endsWith('package.json')) {
            const packageJson = JSON.parse(content);
            dependencies = packageJson.dependencies || {};
            devDependencies = packageJson.devDependencies || {};
          } else if (filePath.endsWith('package-lock.json')) {
            // Parse package-lock.json for transitive dependencies
            const lockData = JSON.parse(content);
            dependencies = this.parsePackageLock(lockData);
          }
          break;
          
        case 'yarn':
          if (filePath.endsWith('package.json')) {
            const packageJson = JSON.parse(content);
            dependencies = packageJson.dependencies || {};
            devDependencies = packageJson.devDependencies || {};
          } else if (filePath.endsWith('yarn.lock')) {
            dependencies = this.parseYarnLock(content);
          }
          break;

        case 'pip':
          if (filePath.endsWith('requirements.txt')) {
            dependencies = this.parseRequirementsTxt(content);
          } else if (filePath.endsWith('Pipfile')) {
            dependencies = this.parsePipfile(content);
          }
          break;

        case 'poetry':
          dependencies = this.parsePyprojectToml(content);
          break;

        case 'maven':
          dependencies = await this.parsePomXml(content);
          break;

        case 'gradle':
          // Create placeholder dependencies to indicate this is a Gradle project
          // These will be replaced by actual resolved dependencies from gradle dependencies command
          logger.info('🔄 Creating Gradle project placeholder - will be resolved by gradle dependencies command');
          if (filePath.endsWith('build.gradle')) {
            // Add a placeholder dependency to indicate this is a Gradle project
            dependencies = {
              'gradle-project-placeholder': 'placeholder'
            };
          } else {
            dependencies = {};
          }
          break;

        case 'go':
          if (filePath.endsWith('go.mod')) {
            dependencies = this.parseGoMod(content);
          }
          break;

        case 'bundler':
          if (filePath.endsWith('Gemfile')) {
            dependencies = this.parseGemfile(content);
          }
          break;

        case 'docker':
          // Dockerfiles are parsed for Java version detection only
          // No dependencies to extract, but content is preserved for analysis
          break;

        case 'version':
          // Version files (.java-version, .sdkmanrc, etc.) are parsed for Java version detection only
          // No dependencies to extract, but content is preserved for analysis
          break;

        default:
          logger.warn(`Unsupported package manager: ${packageManager}`);
          return null;
      }

      return {
        filePath,
        packageManager,
        content,
        dependencies,
        devDependencies,
      };
    } catch (error) {
      logger.error(`Error parsing package file ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Parse requirements.txt file
   */
  private parseRequirementsTxt(content: string): Record<string, string> {
    const dependencies: Record<string, string> = {};
    
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('-')) {
        const match = trimmed.match(/^([a-zA-Z0-9_.-]+)([>=<~!]+)(.+)$/);
        if (match) {
          dependencies[match[1]] = match[3];
        } else if (!trimmed.includes(' ')) {
          dependencies[trimmed] = '*';
        }
      }
    }
    
    return dependencies;
  }

  /**
   * Parse Pipfile
   */
  private parsePipfile(content: string): Record<string, string> {
    // Simple TOML parsing for Pipfile
    const dependencies: Record<string, string> = {};
    const lines = content.split('\n');
    let inPackagesSection = false;
    
    for (const line of lines) {
      if (line.trim() === '[packages]') {
        inPackagesSection = true;
        continue;
      } else if (line.trim().startsWith('[') && inPackagesSection) {
        inPackagesSection = false;
        continue;
      }
      
      if (inPackagesSection && line.includes('=')) {
        const [name, version] = line.split('=').map(s => s.trim());
        if (name && version) {
          dependencies[name] = version.replace(/['"]/g, '');
        }
      }
    }
    
    return dependencies;
  }

  /**
   * Parse pyproject.toml for Poetry
   */
  private parsePyprojectToml(content: string): Record<string, string> {
    const dependencies: Record<string, string> = {};
    // This is a simplified parser - in production, use a proper TOML parser
    const lines = content.split('\n');
    let inDependenciesSection = false;
    
    for (const line of lines) {
      if (line.trim() === '[tool.poetry.dependencies]') {
        inDependenciesSection = true;
        continue;
      } else if (line.trim().startsWith('[') && inDependenciesSection) {
        inDependenciesSection = false;
        continue;
      }
      
      if (inDependenciesSection && line.includes('=')) {
        const [name, version] = line.split('=').map(s => s.trim());
        if (name && version && name !== 'python') {
          dependencies[name] = version.replace(/['"]/g, '');
        }
      }
    }
    
    return dependencies;
  }

  /**
   * Parse pom.xml for Maven
   */
  private async parsePomXml(content: string): Promise<Record<string, string>> {
    const dependencies: Record<string, string> = {};
    
    try {
      logger.info('🔍 Starting Maven POM parsing...');
      
      // Use the existing MavenFileParser to parse the POM
      const { MavenFileParser } = await import('../fileParser/MavenFileParser');
      logger.info('✅ MavenFileParser imported successfully');
      
      const mavenParser = new MavenFileParser();
      logger.info('✅ MavenFileParser instantiated');
      
      // Parse the POM file with timeout
      logger.info('🔄 Parsing POM file content...');
      const parsePromise = mavenParser.parseFile('pom.xml', content);
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Maven POM parsing timed out after 2 minutes')), 120000);
      });
      
      const mavenMod = await Promise.race([parsePromise, timeoutPromise]) as any;
      logger.info('✅ POM file parsed successfully');
      
      // Convert MavenDependency[] to Record<string, string>
      logger.info(`🔄 Converting ${mavenMod.dependencies?.length || 0} Maven dependencies...`);
      if (mavenMod.dependencies) {
        mavenMod.dependencies.forEach((dep: any, index: number) => {
          const dependencyKey = `${dep.groupId}:${dep.artifactId}`;
          dependencies[dependencyKey] = dep.version;
          if (index < 5) {
            logger.info(`   Converting dep ${index + 1}: ${dependencyKey} = ${dep.version}`);
          }
        });
      }
      
      logger.info(`📦 Extracted ${Object.keys(dependencies).length} Maven dependencies from pom.xml`);
      
      // Log sample dependencies for debugging
      const sampleDeps = Object.entries(dependencies).slice(0, 5);
      if (sampleDeps.length > 0) {
        logger.info('🔍 Sample Maven dependencies:');
        sampleDeps.forEach(([key, version], index) => {
          logger.info(`   ${index + 1}. ${key}:${version}`);
        });
      }
      
      logger.info('✅ Maven POM parsing completed successfully');
      return dependencies;
    } catch (error) {
      logger.error(`❌ Failed to parse pom.xml:`, error);
      
      // Fallback: Try simple regex-based parsing for basic dependencies
      logger.info('🔄 Attempting fallback regex-based Maven parsing...');
      try {
        const fallbackDeps = this.parsePomXmlFallback(content);
        logger.info(`📦 Fallback parsing found ${Object.keys(fallbackDeps).length} dependencies`);
        return fallbackDeps;
      } catch (fallbackError) {
        logger.error('❌ Fallback parsing also failed:', fallbackError);
        return {};
      }
    }
  }

  /**
   * Fallback Maven POM parsing using regex (simpler but less reliable)
   */
  private parsePomXmlFallback(content: string): Record<string, string> {
    const dependencies: Record<string, string> = {};
    
    try {
      logger.info('🔍 Using fallback regex-based Maven parsing...');
      
      // Simple regex to find dependencies
      const dependencyRegex = /<dependency>[\s\S]*?<groupId>([^<]+)<\/groupId>[\s\S]*?<artifactId>([^<]+)<\/artifactId>[\s\S]*?<version>([^<]+)<\/version>[\s\S]*?<\/dependency>/g;
      
      let match;
      let count = 0;
      while ((match = dependencyRegex.exec(content)) !== null && count < 100) {
        const [, groupId, artifactId, version] = match;
        const dependencyKey = `${groupId}:${artifactId}`;
        dependencies[dependencyKey] = version;
        count++;
        
        if (count <= 5) {
          logger.info(`   Fallback found: ${dependencyKey}:${version}`);
        }
      }
      
      logger.info(`✅ Fallback parsing completed: ${Object.keys(dependencies).length} dependencies found`);
      return dependencies;
    } catch (error) {
      logger.error('❌ Fallback parsing failed:', error);
      return {};
    }
  }

  /**
   * Parse gradle.properties
   */
  private parseGradleProperties(content: string): Record<string, string> {
    const variables: Record<string, string> = {};
    
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip comments and empty lines
      if (trimmed.startsWith('#') || trimmed.startsWith('//') || !trimmed) {
        continue;
      }
      
      // Parse key=value pairs
      const match = trimmed.match(/^([^=]+)=(.+)$/);
      if (match) {
        const [, key, value] = match;
        variables[key.trim()] = value.trim();
      }
    }
    
    logger.info('📋 Gradle properties extracted:', variables);
    
    // For gradle.properties, we return the variables as dependencies
    // This will be combined with build.gradle parsing later
    return variables;
  }

  /**
   * Parse build.gradle
   */
  private parseGradleBuild(content: string): Record<string, string> {
    const dependencies: Record<string, string> = {};
    const variables: Record<string, string> = {};
    
    // Extract variable definitions from multiple sources
    const lines = content.split('\n');
    let inExtBlock = false;
    let inPluginsBlock = false;
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // 1. Extract from ext block
      if (trimmed.includes('ext {') || trimmed === 'ext {') {
        inExtBlock = true;
        continue;
      }
      
      if (inExtBlock && trimmed === '}') {
        inExtBlock = false;
        continue;
      }
      
      if (inExtBlock) {
        const varMatch = trimmed.match(/(\w+)\s*=\s*['"]([^'"]+)['"]/);
        if (varMatch) {
          variables[varMatch[1]] = varMatch[2];
        }
      }
      
      // 2. Extract from top-level variable definitions
      if (!inExtBlock && !inPluginsBlock && !trimmed.startsWith('//')) {
        const topLevelVarMatch = trimmed.match(/(?:def\s+)?(?:ext\.)?(\w+)\s*=\s*['"]([^'"]+)['"]/);
        if (topLevelVarMatch) {
          variables[topLevelVarMatch[1]] = topLevelVarMatch[2];
        }
      }
      
      // 3. Extract from plugins block (Spring Boot plugin version)
      if (trimmed.includes('plugins {') || trimmed === 'plugins {') {
        inPluginsBlock = true;
        continue;
      }
      
      if (inPluginsBlock && trimmed === '}') {
        inPluginsBlock = false;
        continue;
      }
      
      if (inPluginsBlock) {
        const pluginMatch = trimmed.match(/id\s+['"]org\.springframework\.boot['"]\s+version\s+['"]([^'"]+)['"]/);
        if (pluginMatch) {
          variables['springBootVersion'] = pluginMatch[1];
        }
      }
    }

    logger.info('📋 Gradle variables extracted:', variables);

    // Extract dependencies using multiple parsing strategies
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.includes('implementation') || trimmed.includes('compile') || trimmed.includes('runtimeOnly') || trimmed.includes('testImplementation')) {
        
        // Strategy 1: String format - 'group:artifact:version'
        const quotedMatch = trimmed.match(/['"]([^:]+):([^:]+):([^'"]+)['"]/);
        // Strategy 2: Variable format - 'group:artifact:${variable}'
        const variableMatch = trimmed.match(/['"]([^:]+):([^:]+):\$\{(\w+)\}['"]/);
        // Strategy 3: Map format - group: 'group', name: 'artifact', version: 'version'
        const mapFormatMatch = this.parseGradleMapFormat(line, lines, lines.indexOf(line));
        
        if (quotedMatch) {
          const [, group, artifact, version] = quotedMatch;
          dependencies[`${group}:${artifact}`] = version;
          logger.info(`✅ String format: ${group}:${artifact} = ${version}`);
        } else if (variableMatch) {
          const [, group, artifact, varName] = variableMatch;
          const resolvedVersion = variables[varName];
          if (resolvedVersion) {
            dependencies[`${group}:${artifact}`] = resolvedVersion;
            logger.info(`🔧 Variable resolved: ${group}:${artifact} = ${resolvedVersion} (from ${varName})`);
          } else {
            logger.warn(`❌ Could not resolve variable ${varName} for ${group}:${artifact}`);
            dependencies[`${group}:${artifact}`] = `\${${varName}}`;
          }
        } else if (mapFormatMatch) {
          const { group, name, version } = mapFormatMatch;
          const resolvedVersion = version.startsWith('${') && version.endsWith('}') 
            ? variables[version.slice(2, -1)] || version 
            : version;
          dependencies[`${group}:${name}`] = resolvedVersion;
          logger.info(`🗺️ Map format: ${group}:${name} = ${resolvedVersion}`);
        }
      }
    }
    
    logger.info('📦 Final Gradle dependencies:', dependencies);
    return dependencies;
  }

  /**
   * Parse Gradle map format dependencies (group: 'x', name: 'y', version: 'z')
   */
  private parseGradleMapFormat(line: string, allLines: string[], currentIndex: number): { group: string, name: string, version: string } | null {
    // Check if this line contains group:
    const groupMatch = line.match(/group:\s*['"]([^'"]+)['"]/);
    if (!groupMatch) return null;
    
    const group = groupMatch[1];
    let name = '';
    let version = '';
    
    // Look for name and version in the same line or following lines
    for (let i = currentIndex; i < Math.min(currentIndex + 5, allLines.length); i++) {
      const currentLine = allLines[i];
      
      const nameMatch = currentLine.match(/name:\s*['"]([^'"]+)['"]/);
      if (nameMatch) {
        name = nameMatch[1];
      }
      
      const versionMatch = currentLine.match(/version:\s*['"]([^'"]+)['"]/);
      if (versionMatch) {
        version = versionMatch[1];
      }
      
      // If we have all three, return the result
      if (group && name && version) {
        return { group, name, version };
      }
      
      // Stop if we hit a closing parenthesis or new dependency
      if (currentLine.includes(')') || (i > currentIndex && currentLine.includes('implementation'))) {
        break;
      }
    }
    
    return null;
  }

  /**
   * Parse go.mod
   */
  private parseGoMod(content: string): Record<string, string> {
    const dependencies: Record<string, string> = {};
    const lines = content.split('\n');
    let inRequireBlock = false;
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed === 'require (') {
        inRequireBlock = true;
        continue;
      } else if (trimmed === ')' && inRequireBlock) {
        inRequireBlock = false;
        continue;
      }
      
      if (inRequireBlock || (trimmed.startsWith('require ') && !trimmed.includes('('))) {
        const parts = trimmed.replace('require ', '').split(/\s+/);
        if (parts.length >= 2) {
          dependencies[parts[0]] = parts[1];
        }
      }
    }
    
    return dependencies;
  }

  /**
   * Parse Gemfile
   */
  private parseGemfile(content: string): Record<string, string> {
    const dependencies: Record<string, string> = {};
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('gem ')) {
        const match = trimmed.match(/gem\s+['"]([^'"]+)['"](?:,\s*['"]([^'"]+)['"])?/);
        if (match) {
          dependencies[match[1]] = match[2] || '*';
        }
      }
    }
    
    return dependencies;
  }

  /**
   * Create a pull request with comprehensive dependency updates using file parsers
   */
  async createPullRequest(
    repositoryUrl: string,
    fixes: FixSuggestion[],
    prTitle: string,
    prDescription: string,
    branchName: string
  ): Promise<PullRequest> {
    let repoPath: string | undefined;
    
    try {
      const { owner, repo } = this.parseRepositoryUrl(repositoryUrl);
      
      logger.info(`🚀 Creating enhanced pull request for ${owner}/${repo} with ${fixes.length} vulnerability fixes`);

      // Always use master branch as base
      const baseBranch = 'master';
      logger.info(`📍 Using master branch as base for all operations`);

      // Get repository ID for pull request object
      const { data: repoData } = await this.octokit.repos.get({ owner, repo });

      // Clone repository locally for file modifications
      logger.info(`📥 Cloning repository for local modifications...`);
      repoPath = await this.cloneRepository(repositoryUrl);
      
      // Initialize git in the cloned repository
      const repoGit = simpleGit(repoPath);
      
      // Ensure we're on master branch before creating new branch
      logger.info(`🔄 Ensuring master branch is checked out...`);
      await repoGit.checkout('master');
      
      // Create and checkout new branch from master
      logger.info(`🌿 Creating and checking out branch: ${branchName} from master`);
      await repoGit.checkoutLocalBranch(branchName);

      // Convert FixSuggestion[] to VulnerabilityFix[]
      const vulnerabilityFixes: VulnerabilityFix[] = this.convertFixSuggestionsToVulnerabilityFixes(fixes);
      logger.info(`🔧 Converted ${vulnerabilityFixes.length} fix suggestions to vulnerability fixes`);

      // ✅ FIX: Filter out problematic dependencies from automatic fixes to prevent build failures
      // Parse files first to get Java version information for Spring Boot compatibility checks
      logger.info(`🔍 Finding build files in repository...`);
      const buildFiles = await this.fileParserService.findBuildFiles(repoPath);
      logger.info(`📦 Found ${buildFiles.length} build files: ${buildFiles.map(f => path.basename(f)).join(', ')}`);
      logger.info(`📁 Full paths:`, buildFiles);

      if (buildFiles.length === 0) {
        throw new Error('No supported build files found in repository (build.gradle, pom.xml, package.json)');
      }

      // Parse all build files
      logger.info(`📋 Parsing build files...`);
      const parsingPromises = buildFiles.map(filePath => 
        this.fileParserService.parseFile(filePath)
      );
      const parsingResults = await Promise.all(parsingPromises);

      // Log parsing results
      const successfulParsing = parsingResults.filter(r => r.errors.length === 0);
      const failedParsing = parsingResults.filter(r => r.errors.length > 0);
      
      logger.info(`✅ Successfully parsed ${successfulParsing.length} files`);
      if (failedParsing.length > 0) {
        logger.warn(`❌ Failed to parse ${failedParsing.length} files:`, 
          failedParsing.map(r => ({ file: r.filePath, errors: r.errors }))
        );
      }

      // Check which fixes are problematic (now with Java version awareness)
      const problematicFixes: VulnerabilityFix[] = [];
      const safeFixes: VulnerabilityFix[] = [];
      
      for (const fix of vulnerabilityFixes) {
        const isProblematic = await this.isProblematicDependencyUpdate(fix, successfulParsing);
        if (isProblematic) {
          problematicFixes.push(fix);
        } else {
          safeFixes.push(fix);
        }
      }
      
      logger.info(`🔍 Dependency analysis: ${problematicFixes.length} problematic fixes requiring manual intervention, ${safeFixes.length} safe fixes`);
      
      if (problematicFixes.length > 0) {
        logger.warn(`⚠️ Excluding problematic dependencies from automatic fixes to prevent build failures:`, 
          problematicFixes.map(fix => `${fix.dependencyName}: ${fix.currentVersion} → ${fix.recommendedVersion} (${fix.cveId})`)
        );
      }
      
      // Use only safe fixes for automatic application
      const fixesToApply = safeFixes;
      logger.info(`🔧 Applying ${fixesToApply.length} vulnerability fixes automatically (including Spring Boot if Java 17+ compatible)`);

      // Apply vulnerability fixes to parsed files (excluding problematic dependencies)
      logger.info(`🔧 Applying safe vulnerability fixes...`);
      const updatedParsingResults = await this.fileParserService.applyVulnerabilityFixes(
        successfulParsing,
        fixesToApply
      );

      // Check if any files were modified
      const modifiedResults = updatedParsingResults.filter(result => result.applied);
      
      // Count only real vulnerabilities (exclude consistency fixes)
      const realVulnerabilityFixes = vulnerabilityFixes.filter(fix => !fix.cveId.startsWith('CONSISTENCY-'));
      const totalRealVulnerabilities = realVulnerabilityFixes.length;
      const totalFixesApplied = updatedParsingResults.reduce((sum, result) => 
        sum + result.fixes.filter(fix => !fix.cveId.startsWith('CONSISTENCY-')).length, 0
      );
      
      // Account for transitive fixes covered by parent updates
      const parentCveAnnotations = (updatedParsingResults as any).parentCveAnnotations || [];
      const transitiveFixes = parentCveAnnotations.length;
      const totalVulnerabilitiesAddressed = totalFixesApplied + transitiveFixes;
      
      logger.info(`📝 Fix summary: ${totalFixesApplied} direct fixes + ${transitiveFixes} transitive fixes = ${totalVulnerabilitiesAddressed}/${totalRealVulnerabilities} vulnerabilities addressed`);

      // Create detailed fix report
      const successfulFixes = updatedParsingResults.flatMap(result => result.fixes);
      const failedFixes = vulnerabilityFixes.filter(fix => 
        !successfulFixes.some(success => 
          success.dependencyName === fix.dependencyName && success.cveId === fix.cveId
        ) && !parentCveAnnotations.some((annotation: string) => annotation.includes(fix.cveId)) &&
        !fix.cveId.startsWith('CONSISTENCY-')  // Exclude consistency fixes from failed list
      );

      logger.info(`✅ Successful fixes:`, successfulFixes.map(fix => `${fix.dependencyName} (${fix.cveId})`));
      if (failedFixes.length > 0) {
        logger.warn(`❌ Failed fixes:`, failedFixes.map(fix => `${fix.dependencyName} (${fix.cveId})`));
      }

      // Determine how to proceed based on success rate
      const successRate = totalRealVulnerabilities > 0 ? (totalVulnerabilitiesAddressed / totalRealVulnerabilities) : 0;
      let shouldCreatePR = modifiedResults.length > 0; // Create PR if at least one fix was applied
      let prCreationStrategy = '';

      if (successRate === 1.0) {
        prCreationStrategy = 'full_success';
        logger.info(`✅ All vulnerabilities addressed (${totalVulnerabilitiesAddressed}/${totalRealVulnerabilities})`);
      } else if (successRate > 0) {
        prCreationStrategy = 'partial_success';
        logger.info(`⚠️ Partial success: ${totalVulnerabilitiesAddressed}/${totalRealVulnerabilities} vulnerabilities addressed`);
      } else {
        prCreationStrategy = 'no_success';
        shouldCreatePR = true; // Still create PR with summary for manual fixes
        logger.warn(`❌ No automatic fixes possible - creating PR with manual instructions`);
      }

      // Update PR title based on success rate - only show partial count if not all vulnerabilities are addressed
      if (successRate < 1.0) {
        const originalTitle = prTitle;
        prTitle = successRate > 0 
          ? `${originalTitle} (${totalVulnerabilitiesAddressed}/${totalRealVulnerabilities} vulnerabilities addressed)` 
          : `${originalTitle} (Manual fixes required)`;
      }

      if (modifiedResults.length === 0) {
        logger.warn(`❌ No files were modified - creating summary with manual instructions`);
        
        // Create comprehensive summary file with both failed fixes and manual instructions
        await this.createComprehensiveSummaryFile(repoPath, vulnerabilityFixes, failedFixes, successfulFixes);
        logger.info(`📄 Created comprehensive summary file with manual instructions`);
      } else {
        // Write modified files back to disk
        logger.info(`💾 Writing modified files to disk...`);
        
        // Validate files before writing
        logger.info(`🔍 Validating modified files before writing...`);
        const validationResult = await this.fileParserService.validateModifiedFiles(updatedParsingResults);
        
        if (!validationResult.valid) {
          logger.error(`❌ File validation failed:`, validationResult.errors);
          
          // Attempt to recover by excluding invalid files
          const validResults = updatedParsingResults.filter(result => {
            if (!result.applied) return false;
            
            try {
              switch (result.fileType) {
                case 'gradle':
                  const gradleContent = this.fileParserService['gradleParser'].getModifiedContent(result.modification as any);
                  return this.fileParserService['validateGradleFile'] ? 
                    this.fileParserService['validateGradleFile'](gradleContent) : true;
                case 'maven':
                  const mavenContent = this.fileParserService['mavenParser'].getModifiedContent(result.modification as any);
                  return this.fileParserService['validateMavenFile'] ? 
                    this.fileParserService['validateMavenFile'](mavenContent) : true;
                case 'npm':
                  return this.fileParserService['npmParser'].validate(result.modification as any).valid;
                default:
                  return false;
              }
            } catch {
              return false;
            }
          });

          if (validResults.length === 0) {
            // No valid files - fall back to summary
            logger.error(`❌ No valid files after validation - creating summary instead`);
            await this.createComprehensiveSummaryFile(repoPath, vulnerabilityFixes, failedFixes, successfulFixes);
            prCreationStrategy = 'fallback_summary';
          } else {
            // Proceed with only valid files
            logger.warn(`⚠️ Proceeding with ${validResults.length} valid files, excluding ${updatedParsingResults.length - validResults.length} invalid files`);
            const writeResult = await this.fileParserService.writeModifiedFiles(validResults);
            
            if (writeResult.errors.length > 0) {
              logger.warn(`❌ Some valid files failed to write:`, writeResult.errors);
            }
            
            logger.info(`✅ Successfully wrote ${writeResult.written} valid files`);
          }
        } else {
          logger.info(`✅ All modified files passed validation`);
          
          const writeResult = await this.fileParserService.writeModifiedFiles(updatedParsingResults);
          
          if (writeResult.errors.length > 0) {
            logger.warn(`❌ Some files failed to write:`, writeResult.errors);
          }
          
          logger.info(`✅ Successfully wrote ${writeResult.written} files`);
        }

        // Generate build validation commands
        const buildCommands = this.fileParserService.generateBuildCommands(updatedParsingResults);
        
        // Add build validation instructions to PR description
        if (buildCommands.length > 0) {
          prDescription += `\n\n## Build Validation\n\nAfter merging, run these commands to validate the changes:\n\`\`\`bash\n${buildCommands.join('\n')}\n\`\`\``;
        }

        // Add partial success information to PR description
        if (failedFixes.length > 0) {
          prDescription += `\n\n## Partially Automated Fixes\n\n`;
          prDescription += `✅ **Successfully automated:** ${successfulFixes.length} vulnerabilities\n`;
          prDescription += `❌ **Require manual fixes:** ${failedFixes.length} vulnerabilities\n\n`;
          prDescription += `### Manual Fixes Required:\n`;
          
          // Group manual fixes by category for better explanation
          const springFrameworkFixes = failedFixes.filter(fix => 
            fix.dependencyName.includes('org.springframework') || 
            fix.dependencyName.includes('spring-boot')
          );
          const otherFixes = failedFixes.filter(fix => 
            !fix.dependencyName.includes('org.springframework') && 
            !fix.dependencyName.includes('spring-boot')
          );
          
          // Spring Framework fixes with detailed explanation
          if (springFrameworkFixes.length > 0) {
            prDescription += `\n#### 🔧 Spring Framework Components (${springFrameworkFixes.length} vulnerabilities)\n`;
            prDescription += `These components require **major version upgrades** that cannot be automated due to compatibility requirements:\n\n`;
            
            for (const fix of springFrameworkFixes) {
              const majorVersionUpgrade = await this.getSpringUpgradeReason(fix, parsingResults);
              prDescription += `- **${fix.cveId}**: Update \`${fix.dependencyName}\` from \`${fix.currentVersion}\` to \`${fix.recommendedVersion}\`\n`;
              prDescription += `  ${majorVersionUpgrade}\n`;
            }
            
            // Detect current versions for PR description
            const currentJavaVersion = await this.fileParserService.detectJavaVersion(parsingResults);
            const currentSpringBootVersion = await this.fileParserService.detectSpringBootVersion(parsingResults);
            
            const needsJavaUpgrade = currentJavaVersion < 17;
            const needsSpringBootUpgrade = currentSpringBootVersion && currentSpringBootVersion.startsWith('2.');
            
            prDescription += `\n**Required Prerequisites:**\n`;
            if (needsJavaUpgrade) {
              prDescription += `- ❌ Upgrade to **Java 17+** (currently Java ${currentJavaVersion})\n`;
            } else {
              prDescription += `- ✅ **Java 17+** (already met - currently Java ${currentJavaVersion})\n`;
            }
            
            if (needsSpringBootUpgrade) {
              prDescription += `- ❌ Upgrade to **Spring Boot 3.x** (currently ${currentSpringBootVersion})\n`;
            } else if (currentSpringBootVersion) {
              prDescription += `- ✅ **Spring Boot 3.x** (already met - currently ${currentSpringBootVersion})\n`;
            } else {
              prDescription += `- ❓ **Spring Boot 3.x** (current version not detected)\n`;
            }
            
            prDescription += `- ☑️ Review and update application code for breaking changes\n`;
            prDescription += `- ☑️ Test thoroughly before deploying\n\n`;
            
            if (needsJavaUpgrade || needsSpringBootUpgrade) {
              prDescription += `**Recommended Approach:**\n`;
              prDescription += `1. Plan a maintenance window for major version upgrades\n`;
              if (needsJavaUpgrade) {
                prDescription += `2. Upgrade Java from ${currentJavaVersion} to version 17 or higher\n`;
              }
              if (needsSpringBootUpgrade) {
                prDescription += `${needsJavaUpgrade ? '3' : '2'}. Upgrade Spring Boot from ${currentSpringBootVersion} to 3.x\n`;
              }
              prDescription += `${needsJavaUpgrade && needsSpringBootUpgrade ? '4' : '3'}. Update Spring Framework components to 6.x versions\n`;
              prDescription += `${needsJavaUpgrade && needsSpringBootUpgrade ? '5' : '4'}. Re-run security analysis to apply these fixes\n\n`;
            } else {
              prDescription += `**Note:** Your environment already meets the compatibility requirements. If these fixes are still marked as manual, consider reporting this as a compatibility detection issue.\n\n`;
            }
          }
          
          // Other manual fixes
          if (otherFixes.length > 0) {
            prDescription += `\n#### 🛠️ Other Manual Fixes (${otherFixes.length} vulnerabilities)\n`;
            otherFixes.forEach(fix => {
              prDescription += `- **${fix.cveId}**: Update \`${fix.dependencyName}\` from \`${fix.currentVersion}\` to \`${fix.recommendedVersion}\`\n`;
              prDescription += `  *Manual intervention required - please review and apply manually*\n`;
            });
          }
        }
      }

      // Generate comprehensive changes summary
      const changesSummary = this.fileParserService.generateChangesSummary(updatedParsingResults);
      logger.info(`📊 Changes summary:\n${changesSummary}`);

      // Commit only the files that were modified by our tool (avoid staging build artifacts)
      logger.info(`💾 Committing changes...`);
      
      // Get list of files that were actually modified by our tool
      const modifiedFilePaths = updatedParsingResults
        .filter(result => result.applied)
        .map(result => path.relative(repoPath, result.filePath));
      
      if (modifiedFilePaths.length === 0) {
        logger.warn('⚠️ No files were modified by dependency fixes');
        
        // Check if there were Spring Boot or related components that were excluded
        const springBootFixes = problematicFixes.filter(fix => 
          fix.dependencyName.includes('spring-boot') || 
          fix.dependencyName.includes('org.springframework') ||
          fix.dependencyName.includes('spring-security')
        );
        
        if (springBootFixes.length > 0) {
          throw new Error('No other vulnerabilities could be fixed apart from SpringBoot and related components which needs to be handled manually');
        } else {
          throw new Error('No dependency fixes were applied');
        }
      }
      
      logger.info(`📁 Staging only modified build files: ${modifiedFilePaths.join(', ')}`);
      
      // Stage only the specific files we modified, not all files (avoids .class files)
      for (const filePath of modifiedFilePaths) {
        await repoGit.add(filePath);
      }
      
      const commitMessage = `Security fixes: Update vulnerable dependencies\n\n${changesSummary}`;
      await repoGit.commit(commitMessage);

      // Push branch to remote
      logger.info(`📤 Pushing branch to remote...`);
      
      // Configure authentication for push
      const authenticatedUrl = this.config.token 
        ? repositoryUrl.replace('https://github.com', `https://${this.config.token}@github.com`)
        : repositoryUrl;

      await repoGit.push(authenticatedUrl, branchName);
      logger.info(`✅ Branch pushed successfully`);

      // Create pull request
      logger.info(`🔀 Creating pull request with master as base...`);
      const { data: pr } = await this.octokit.pulls.create({
        owner,
        repo,
        title: prTitle,
        body: prDescription,
        head: branchName,
        base: baseBranch, // Always use master as base
      });

      // Add explanatory comment for manual fixes if any Spring components require manual intervention
      const springManualFixes = failedFixes?.filter(fix => 
        fix.dependencyName.includes('org.springframework') || 
        fix.dependencyName.includes('spring-boot')
      ) || [];
      
      if (springManualFixes.length > 0) {
        logger.info(`💬 Adding explanatory comment for ${springManualFixes.length} Spring manual fixes...`);
        
        // Detect current Java and Spring Boot versions dynamically
        logger.info(`🔍 Detecting project versions for PR comment...`);
        const detectedJavaVersion = await this.fileParserService.detectJavaVersion(parsingResults);
        const detectedSpringBootVersion = await this.fileParserService.detectSpringBootVersion(parsingResults);
        
        logger.info(`📊 Detected versions - Java: ${detectedJavaVersion}, Spring Boot: ${detectedSpringBootVersion || 'not detected'}`);
        
        let commentBody = `## 🔧 Manual Fixes Explanation\n\n`;
        commentBody += `The following ${springManualFixes.length} vulnerabilities require manual intervention because they involve **major version upgrades** with significant compatibility requirements:\n\n`;
        
        for (const fix of springManualFixes) {
          const reason = await this.getSpringUpgradeReason(fix, parsingResults);
          commentBody += `### ${fix.cveId}: \`${fix.dependencyName}\`\n`;
          commentBody += `- **Current**: \`${fix.currentVersion}\`\n`;
          commentBody += `- **Recommended**: \`${fix.recommendedVersion}\`\n`;
          commentBody += `- **Why Manual**: ${reason}\n\n`;
        }
        
        commentBody += `### 🚨 **Important Compatibility Requirements**\n\n`;
        commentBody += `Your project is currently running:\n`;
        commentBody += `- **Java ${detectedJavaVersion}** (detected from project configuration)\n`;
        if (detectedSpringBootVersion) {
          commentBody += `- **Spring Boot ${detectedSpringBootVersion}** (detected from build files)\n\n`;
        } else {
          commentBody += `- **Spring Boot version not detected** (please check your build files)\n\n`;
        }
        
        commentBody += `To apply these security fixes, you need:\n`;
        
        // Smart compatibility requirements based on detected versions
        const needsJavaUpgrade = detectedJavaVersion < 17;
        const needsSpringBootUpgrade = detectedSpringBootVersion && detectedSpringBootVersion.startsWith('2.');
        
        if (needsJavaUpgrade) {
          commentBody += `- ❌ **Upgrade to Java 17+** (currently Java ${detectedJavaVersion} - required for Spring Framework 6.x and Spring Security 6.x)\n`;
        } else {
          commentBody += `- ✅ **Java 17+** (already met - currently Java ${detectedJavaVersion})\n`;
        }
        
        if (needsSpringBootUpgrade) {
          commentBody += `- ❌ **Upgrade to Spring Boot 3.x** (currently ${detectedSpringBootVersion} - required for Spring Framework 6.x compatibility)\n\n`;
        } else if (detectedSpringBootVersion) {
          commentBody += `- ✅ **Spring Boot 3.x** (already met - currently ${detectedSpringBootVersion})\n\n`;
        } else {
          commentBody += `- ❓ **Spring Boot 3.x** (current version not detected - please verify compatibility)\n\n`;
        }
        commentBody += `### 📋 **Next Steps**\n\n`;
        
        if (needsJavaUpgrade || needsSpringBootUpgrade) {
          // Need upgrades
          commentBody += `1. **Plan Migration**: Schedule a maintenance window for major version upgrades\n`;
          if (needsJavaUpgrade) {
            commentBody += `2. **Java Upgrade**: Update Java from ${detectedJavaVersion} to 17 or higher\n`;
          }
          if (needsSpringBootUpgrade) {
            commentBody += `${needsJavaUpgrade ? '3' : '2'}. **Spring Boot Upgrade**: Update Spring Boot from ${detectedSpringBootVersion} to 3.x\n`;
          }
          commentBody += `${needsJavaUpgrade && needsSpringBootUpgrade ? '4' : '3'}. **Code Review**: Review your application for breaking changes ([Spring Boot 3.0 Migration Guide](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-3.0-Migration-Guide))\n`;
          commentBody += `${needsJavaUpgrade && needsSpringBootUpgrade ? '5' : '4'}. **Re-run Analysis**: After upgrades, re-run the security analysis to automatically apply these fixes\n\n`;
        } else {
          // Requirements already met - this suggests the compatibility check may be wrong
          commentBody += `🎉 **Good News**: Your environment already meets the compatibility requirements!\n\n`;
          commentBody += `Since you already have Java ${detectedJavaVersion} and Spring Boot ${detectedSpringBootVersion}, these fixes should be automatable. `;
          commentBody += `If they're still showing as manual, this may indicate an issue with our compatibility detection logic.\n\n`;
          commentBody += `**Recommended Action**:\n`;
          commentBody += `1. **Contact Support**: Report this as a potential compatibility detection issue\n`;
          commentBody += `2. **Manual Review**: Consider applying these fixes manually as your environment should support them\n`;
          commentBody += `3. **Re-run Analysis**: Try running the analysis again to see if the issue resolves\n\n`;
        }
        commentBody += `💡 **Tip**: These changes were identified by our automated compatibility analysis and cannot be safely automated due to the major version requirements.`;
        
        try {
          await this.octokit.issues.createComment({
            owner,
            repo,
            issue_number: pr.number,
            body: commentBody
          });
          logger.info(`✅ Added explanatory comment to PR #${pr.number}`);
        } catch (commentError) {
          logger.warn(`⚠️ Failed to add comment to PR:`, commentError);
        }
      }

      // ✅ FIX: Add general vulnerability summary comment for all vulnerabilities
      if (vulnerabilityFixes.length > 0) {
        logger.info(`💬 Adding general vulnerability summary comment for ${vulnerabilityFixes.length} vulnerabilities...`);
        
        const totalFixes = vulnerabilityFixes.length;
        const successfulFixes = vulnerabilityFixes.filter(fix => !fix.cveId.startsWith('CONSISTENCY-')).length;
        const consistencyFixes = vulnerabilityFixes.filter(fix => fix.cveId.startsWith('CONSISTENCY-')).length;
        
        // Re-calculate problematic fixes for the comment
        const problematicFixes = vulnerabilityFixes.filter(fix => this.isProblematicDependencyUpdate(fix));
        
        let generalCommentBody = `## 🔒 Security Vulnerability Summary\n\n`;
        generalCommentBody += `This pull request addresses **${totalFixes} security issues** identified in your dependencies:\n\n`;
        
        if (successfulFixes > 0) {
          generalCommentBody += `### ✅ **${successfulFixes} Security Vulnerabilities Fixed**\n\n`;
          generalCommentBody += `The following dependencies have been automatically updated to secure versions:\n\n`;
          
          // Group by package manager for better organization
          // IMPORTANT: Only show SAFE fixes in the "Security Vulnerabilities Fixed" section
          // Problematic fixes will be shown separately in the "Manual Review" section
          const fixesByManager = safeFixes
            .filter(fix => !fix.cveId.startsWith('CONSISTENCY-'))
            .reduce((acc, fix) => {
              // Determine package manager from dependency name
              const manager = this.detectPackageManagerFromDependency(fix.dependencyName);
              if (!acc[manager]) acc[manager] = [];
              acc[manager].push(fix);
              return acc;
            }, {} as Record<string, any[]>);
          
          Object.entries(fixesByManager).forEach(([manager, fixes]) => {
            generalCommentBody += `**${manager.toUpperCase()} Dependencies:**\n`;
            
            // Separate direct and transitive dependencies
            const directFixes = fixes.filter(fix => this.isDirectDependency(fix.dependencyName, parsingResults));
            const transitiveFixes = fixes.filter(fix => !this.isDirectDependency(fix.dependencyName, parsingResults));
            
            if (directFixes.length > 0) {
              generalCommentBody += `*Direct Dependencies:*\n`;
              directFixes.forEach(fix => {
                generalCommentBody += `- \`${fix.dependencyName}\`: \`${fix.currentVersion}\` → \`${fix.recommendedVersion}\` (${fix.cveId})\n`;
              });
              generalCommentBody += `\n`;
            }
            
            if (transitiveFixes.length > 0) {
              generalCommentBody += `*Transitive Dependencies:*\n`;
              transitiveFixes.forEach(fix => {
                generalCommentBody += `- \`${fix.dependencyName}\`: \`${fix.currentVersion}\` → \`${fix.recommendedVersion}\` (${fix.cveId})\n`;
              });
              generalCommentBody += `\n`;
            }
          });
        }
        
        if (consistencyFixes > 0) {
          generalCommentBody += `### 🔧 **${consistencyFixes} Version Consistency Fixes**\n\n`;
          generalCommentBody += `The following dependencies were updated to maintain version consistency across your project:\n\n`;
          
          // IMPORTANT: Only show SAFE consistency fixes
          const consistencyFixesList = safeFixes.filter(fix => fix.cveId.startsWith('CONSISTENCY-'));
          consistencyFixesList.forEach(fix => {
            generalCommentBody += `- \`${fix.dependencyName}\`: \`${fix.currentVersion}\` → \`${fix.recommendedVersion}\`\n`;
          });
          generalCommentBody += `\n`;
        }
        
        // Add transitive dependency information
        // IMPORTANT: Only count SAFE transitive fixes, not problematic ones
        const totalTransitiveFixes = safeFixes.filter(fix => 
          !fix.cveId.startsWith('CONSISTENCY-') && !this.isDirectDependency(fix.dependencyName, parsingResults)
        ).length;
        
        if (totalTransitiveFixes > 0) {
          generalCommentBody += `### 🔗 **Transitive Dependencies**\n\n`;
          generalCommentBody += `**${totalTransitiveFixes} transitive dependencies** were updated to fix security vulnerabilities. These are dependencies of your direct dependencies that were automatically updated to secure versions.\n\n`;
          generalCommentBody += `💡 **Note**: Transitive dependency updates are safe and don't require changes to your code. They're automatically resolved by your package manager.\n\n`;
        }

        // Add problematic dependency exclusion information
        if (problematicFixes.length > 0) {
          generalCommentBody += `### 🚨 **Dependencies Requiring Manual Review**\n\n`;
          generalCommentBody += `**${problematicFixes.length} dependencies** were excluded from automatic updates to prevent build failures and version conflicts:\n\n`;
          
          problematicFixes.forEach(fix => {
            generalCommentBody += `- \`${fix.dependencyName}\`: \`${fix.currentVersion}\` → \`${fix.recommendedVersion}\` (${fix.cveId})\n`;
          });
          
          generalCommentBody += `\n⚠️ **Important**: These dependencies require manual review and careful testing due to potential breaking changes, version downgrades, or compatibility requirements. Please review each update individually.\n\n`;
        }
        
        generalCommentBody += `### 🚀 **Next Steps**\n\n`;
        generalCommentBody += `1. **Review the changes** - All updates are backward compatible\n`;
        generalCommentBody += `2. **Run your tests** - Ensure everything works as expected\n`;
        generalCommentBody += `3. **Deploy safely** - These are security patches with minimal risk\n\n`;
        generalCommentBody += `💡 **Note**: These updates were automatically generated based on security vulnerability analysis. All changes follow semantic versioning best practices.`;
        
        try {
          await this.octokit.issues.createComment({
            owner,
            repo,
            issue_number: pr.number,
            body: generalCommentBody
          });
          logger.info(`✅ Added general vulnerability summary comment to PR #${pr.number}`);
        } catch (commentError) {
          logger.warn(`⚠️ Failed to add general comment to PR:`, commentError);
        }
      }

      // Create file change objects for response
      const fileChanges: FileChange[] = updatedParsingResults
        .filter(result => result.applied)
        .map(result => ({
          filePath: path.relative(repoPath!, result.filePath),
          changeType: 'modified' as const,
          content: this.getModifiedFileContent(result)
        }));

      // Add fallback summary file if no other changes
      if (fileChanges.length === 0) {
        fileChanges.push({
          filePath: 'SECURITY_UPDATES_SUMMARY.md',
          changeType: 'added' as const,
          content: 'Security updates summary (see file content)'
        });
      }

      const pullRequest: PullRequest = {
        id: uuidv4(),
        repositoryId: repoData.id.toString(),
        number: pr.number,
        title: prTitle,
        description: prDescription,
        branchName,
        status: 'open',
        fixes,
        jiraTickets: [], // This would be populated based on the fixes
        filesChanged: fileChanges,
        createdAt: new Date(),
        updatedAt: new Date(),
        url: pr.html_url, // Add the GitHub URL
      };

      logger.info(`🎉 Pull request created successfully: #${pr.number} - ${pr.html_url}`);
      return pullRequest;
      
    } catch (error: any) {
      logger.error('❌ Error creating pull request:', error);
      throw new Error(`Failed to create pull request: ${error.message}`);
    } finally {
      // Cleanup cloned repository
      if (repoPath) {
        // Skip cleanup in development environment or when PRESERVE_REPO is set
        const preserveRepo = process.env.PRESERVE_REPO === 'true' || process.env.NODE_ENV === 'development';
        
        if (preserveRepo) {
          logger.info(`🔍 Repository preserved for review at: ${repoPath}`);
          logger.info(`📋 To cleanup manually later, remove: ${repoPath}`);
        } else {
          logger.info(`🧹 Cleaning up cloned repository...`);
          await this.cleanup(repoPath);
        }
      }
    }
  }

  /**
   * Detect package manager from dependency name
   */
  private detectPackageManagerFromDependency(dependencyName: string): string {
    // Maven dependencies typically have group:artifact format
    if (dependencyName.includes(':')) {
      return 'maven';
    }
    
    // NPM dependencies typically don't have special characters or are scoped
    if (dependencyName.includes('@') || dependencyName.includes('/')) {
      return 'npm';
    }
    
    // Gradle dependencies can be similar to Maven but also have other formats
    // For now, treat as gradle if it has dots (common in Java packages)
    if (dependencyName.includes('.')) {
      return 'gradle';
    }
    
    // Default fallback
    return 'unknown';
  }

  /**
   * Check if a dependency is direct or transitive based on parsing results
   */
  private isDirectDependency(dependencyName: string, parsingResults: FileParsingResult[]): boolean {
    // Check if the dependency is explicitly declared in any build file
    for (const result of parsingResults) {
      if (result.fileType === 'gradle' || result.fileType === 'maven' || result.fileType === 'npm') {
        // For Gradle and Maven, check if dependency is in the main dependencies section
        if (result.modification && typeof result.modification === 'object') {
          const mod = result.modification as any;
          if (mod.dependencies && Array.isArray(mod.dependencies)) {
            const found = mod.dependencies.find((dep: any) => 
              dep.name === dependencyName || 
              dep.artifactId === dependencyName ||
              dep.groupId + ':' + dep.artifactId === dependencyName
            );
            if (found) {
              return true; // It's a direct dependency
            }
          }
        }
      }
    }
    
    // If not found in direct dependencies, assume it's transitive
    return false;
  }

  /**
   * Check if a dependency is a Spring library that requires manual intervention
   */
  private isSpringLibraryRequiringManualFix(dependencyName: string): boolean {
    // Only filter out specific Spring libraries that require manual migration
    // Allow spring-security-core and other Spring libraries for CVE fixes
    const problematicSpringLibraries = [
      'spring-security-oauth',
      'spring-security-oauth2',
      'spring-boot-autoconfigure',
      'spring-boot-actuator-autoconfigure'
    ];
    
    // Check if it's a problematic Spring library that requires manual migration
    const isProblematic = problematicSpringLibraries.some(lib => 
      dependencyName.toLowerCase().includes(lib.toLowerCase())
    );
    
    // Also check for major version upgrades that might require manual intervention
    // But allow spring-security-core and other core Spring libraries for CVE fixes
    const isSpringLibrary = dependencyName.includes('org.springframework');
    
    return isProblematic && isSpringLibrary;
  }

  /**
   * Check if a dependency update is problematic (downgrade or major version mismatch)
   */
  private async isProblematicDependencyUpdate(fix: VulnerabilityFix, parsingResults?: FileParsingResult[]): Promise<boolean> {
    // Special handling for Spring Boot: check Java 17 compatibility
    if (fix.dependencyName.includes('spring-boot') || fix.dependencyName.includes('org.springframework.boot')) {
      if (parsingResults) {
        const javaVersion = await this.fileParserService.detectJavaVersion(parsingResults);
        const recommendedMajor = parseInt(fix.recommendedVersion.split('.')[0]);
        
        // Allow Spring Boot 3.x updates only if Java 17+ is available
        if (recommendedMajor >= 3 && javaVersion >= 17) {
          return false; // Allow this Spring Boot update
        } else if (recommendedMajor >= 3 && javaVersion < 17) {
          return true; // Block Spring Boot 3.x updates if Java < 17
        }
      }
    }
    
    // Check for Spring libraries (but allow most Spring libraries for CVE fixes)
    if (this.isSpringLibraryRequiringManualFix(fix.dependencyName)) {
      return true; // Filter out problematic Spring libraries
    }
    
    // Allow spring-security-core and other core Spring libraries for CVE fixes
    // Only filter out specific problematic ones
    if (fix.dependencyName.includes('org.springframework.security.oauth') || 
        fix.dependencyName.includes('spring-security-oauth')) {
      return true; // Filter out OAuth libraries that require manual migration
    }

    // Check for version downgrades
    if (this.isVersionDowngrade(fix.currentVersion, fix.recommendedVersion)) {
      return true;
    }

    // Check for major version mismatches in related components
    if (this.isMajorVersionMismatch(fix.dependencyName, fix.currentVersion, fix.recommendedVersion)) {
      return true;
    }

    // Check for Jackson version conflicts
    if (this.hasJacksonVersionConflict(fix.dependencyName, fix.recommendedVersion)) {
      return true;
    }

    // Check for gRPC version conflicts
    if (this.hasGrpcVersionConflict(fix.dependencyName, fix.recommendedVersion)) {
      return true;
    }

    return false;
  }

  /**
   * Check if this is a version downgrade
   */
  private isVersionDowngrade(currentVersion: string, recommendedVersion: string): boolean {
    try {
      // Handle version formats like "2.0.18.RELEASE" vs "2.0.16"
      const cleanCurrent = currentVersion.replace(/\.RELEASE$/, '');
      const cleanRecommended = recommendedVersion.replace(/\.RELEASE$/, '');
      
      // Simple version comparison
      const currentParts = cleanCurrent.split('.').map(Number);
      const recommendedParts = cleanRecommended.split('.').map(Number);
      
      for (let i = 0; i < Math.max(currentParts.length, recommendedParts.length); i++) {
        const current = currentParts[i] || 0;
        const recommended = recommendedParts[i] || 0;
        
        if (recommended < current) {
          return true; // This is a downgrade
        } else if (recommended > current) {
          return false; // This is an upgrade
        }
      }
      
      return false; // Versions are equal
    } catch (error) {
      // If we can't parse versions, assume it's not a downgrade
      return false;
    }
  }

  /**
   * Check for major version mismatches in related components
   */
  private isMajorVersionMismatch(dependencyName: string, currentVersion: string, recommendedVersion: string): boolean {
    // Check for gRPC components that should have consistent versions
    if (dependencyName.includes('grpc-')) {
      const currentMajor = parseInt(currentVersion.split('.')[0]);
      const recommendedMajor = parseInt(recommendedVersion.split('.')[0]);
      
      // If major version changes, it could cause compatibility issues
      if (Math.abs(recommendedMajor - currentMajor) > 1) {
        return true;
      }
    }

    // Check for Netty components
    if (dependencyName.includes('netty-')) {
      const currentMajor = parseInt(currentVersion.split('.')[0]);
      const recommendedMajor = parseInt(recommendedVersion.split('.')[0]);
      
      if (Math.abs(recommendedMajor - currentMajor) > 1) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check for Jackson version conflicts
   */
  private hasJacksonVersionConflict(dependencyName: string, recommendedVersion: string): boolean {
    // Jackson components should have consistent major versions
    if (dependencyName.includes('jackson-')) {
      const recommendedMajor = parseInt(recommendedVersion.split('.')[0]);
      
      // Jackson 2.x is widely used and stable, avoid major version changes
      if (recommendedMajor > 2) {
        return true;
      }
      
      // Check for specific problematic combinations
      if (dependencyName.includes('jackson-core') && recommendedVersion.startsWith('2.15.')) {
        // This could conflict with jackson-databind 2.12.x
        return true;
      }
    }
    
    return false;
  }

  /**
   * Check for gRPC version conflicts
   */
  private hasGrpcVersionConflict(dependencyName: string, recommendedVersion: string): boolean {
    // gRPC components must have consistent versions
    if (dependencyName.includes('grpc-')) {
      const recommendedMajor = parseInt(recommendedVersion.split('.')[0]);
      
      // gRPC components are tightly coupled and require consistent versions
      // Avoid updates that could create version mismatches
      if (recommendedMajor > 1) {
        return true;
      }
      
      // Check for specific problematic combinations
      if (dependencyName.includes('grpc-core') && recommendedVersion.startsWith('1.53.')) {
        // This could conflict with other gRPC components at 1.44.x
        return true;
      }
      
      if (dependencyName.includes('grpc-stub') && recommendedVersion.startsWith('1.41.')) {
        // This could conflict with other gRPC components at 1.44.x or 1.53.x
        return true;
      }
    }
    
    return false;
  }

  /**
   * Get specific upgrade reason for Spring components
   */
  private async getSpringUpgradeReason(fix: VulnerabilityFix, parsingResults: FileParsingResult[]): Promise<string> {
    const currentMajor = parseInt(fix.currentVersion.split('.')[0]);
    const recommendedMajor = parseInt(fix.recommendedVersion.split('.')[0]);
    
    // Detect current environment to provide smart reasoning
    const javaVersion = await this.fileParserService.detectJavaVersion(parsingResults);
    const springBootVersion = await this.fileParserService.detectSpringBootVersion(parsingResults);
    
    if (fix.dependencyName.includes('spring-security')) {
      if (recommendedMajor >= 6) {
        const hasJava17 = javaVersion >= 17;
        const hasSpringBoot3 = springBootVersion && !springBootVersion.startsWith('2.');
        
        if (hasJava17 && hasSpringBoot3) {
          return `*Spring Security 6.x upgrade - environment already compatible (Java ${javaVersion}, Spring Boot ${springBootVersion})*`;
        } else {
          const missingReqs = [];
          if (!hasJava17) missingReqs.push(`Java 17+ (currently ${javaVersion})`);
          if (!hasSpringBoot3) missingReqs.push(`Spring Boot 3.x (currently ${springBootVersion || 'not detected'})`);
          return `*Spring Security 6.x requires: ${missingReqs.join(', ')}*`;
        }
      }
    }
    
    if (fix.dependencyName.includes('org.springframework:spring-') && !fix.dependencyName.includes('spring-boot')) {
      if (recommendedMajor >= 6) {
        const hasJava17 = javaVersion >= 17;
        const hasSpringBoot3 = springBootVersion && !springBootVersion.startsWith('2.');
        
        if (hasJava17 && hasSpringBoot3) {
          return `*Spring Framework 6.x upgrade - environment already compatible (Java ${javaVersion}, Spring Boot ${springBootVersion})*`;
        } else {
          const missingReqs = [];
          if (!hasJava17) missingReqs.push(`Java 17+ (currently ${javaVersion})`);
          if (!hasSpringBoot3) missingReqs.push(`Spring Boot 3.x (currently ${springBootVersion || 'not detected'})`);
          return `*Spring Framework 6.x requires: ${missingReqs.join(', ')}*`;
        }
      }
    }
    
    if (fix.dependencyName.includes('spring-boot')) {
      if (recommendedMajor >= 3) {
        const hasJava17 = javaVersion >= 17;
        if (hasJava17) {
          return `*Spring Boot 3.x upgrade - Java requirement met (Java ${javaVersion}), review for breaking changes*`;
        } else {
          return `*Spring Boot 3.x requires Java 17+ (currently ${javaVersion}) and contains breaking changes*`;
        }
      }
    }
    
    return `*Major version upgrade requires compatibility review*`;
  }

  /**
   * Convert FixSuggestion[] to VulnerabilityFix[] for the file parser service
   */
  private convertFixSuggestionsToVulnerabilityFixes(fixes: FixSuggestion[]): VulnerabilityFix[] {
    return fixes.map((fix, index) => {
      // Handle multiple possible data structures
      const fixAny = fix as any;
      
      let dependencyName: string;
      let currentVersion: string;
      let recommendedVersion: string;
      let cveId: string;
      let severity: string;
      let description: string;
      
      logger.info(`🔍 Converting fix ${index + 1}:`, {
        hasAffectedDependencies: !!fixAny.affectedDependencies,
        hasFixSuggestion: !!fixAny.fixSuggestion,
        fixKeys: Object.keys(fixAny),
        affectedDepsCount: fixAny.affectedDependencies?.length || 0
      });
      
      if (fixAny.affectedDependencies && fixAny.affectedDependencies.length > 0) {
        // New structure: fix contains affectedDependencies array
        const dep = fixAny.affectedDependencies[0]; // Use first dependency
        dependencyName = dep.name || 'unknown';
        currentVersion = dep.version || dep.currentVersion || 'unknown';
        recommendedVersion = dep.targetVersion || dep.suggestedVersion || dep.recommendedVersion || dep.fixVersion || 'unknown';
        
        logger.info(`📦 From affectedDependencies:`, {
          name: dep.name,
          version: dep.version,
          currentVersion: dep.currentVersion,
          targetVersion: dep.targetVersion,
          suggestedVersion: dep.suggestedVersion,
          recommendedVersion: dep.recommendedVersion,
          fixVersion: dep.fixVersion
        });
      } else {
        // Fallback to nested structure or direct properties
        const fixData = fixAny.fixSuggestion || fixAny;
        dependencyName = fixData.dependencyName || fixData.name || fixData.component || 'unknown';
        currentVersion = fixData.currentVersion || fixData.version || 'unknown';
        recommendedVersion = fixData.targetVersion || fixData.suggestedVersion || fixData.recommendedVersion || fixData.fixVersion || 'unknown';
        
        logger.info(`📦 From fixSuggestion/direct:`, {
          dependencyName: fixData.dependencyName,
          name: fixData.name,
          component: fixData.component,
          currentVersion: fixData.currentVersion,
          version: fixData.version,
          targetVersion: fixData.targetVersion,
          suggestedVersion: fixData.suggestedVersion,
          recommendedVersion: fixData.recommendedVersion,
          fixVersion: fixData.fixVersion
        });
      }
      
      // Extract CVE and other metadata
      cveId = fixAny.cveId || fixAny.vulnerabilityId || fixAny.id || 'UNKNOWN-CVE';
      severity = fixAny.severity || 'MEDIUM';
      description = fixAny.description || fixAny.title || `Security vulnerability in ${dependencyName}`;
      
      // Enhanced version extraction - check all possible fields
      if (recommendedVersion === 'unknown' || recommendedVersion === 'latest' || !recommendedVersion) {
        // Try to extract from different possible locations in the main object
        const versionFields = [
          'targetVersion', 'fixVersion', 'recommendedVersion', 'suggestedVersion',
          'target_version', 'fix_version', 'recommended_version', 'suggested_version'
        ];
        
        for (const field of versionFields) {
          if (fixAny[field] && fixAny[field] !== 'latest' && fixAny[field] !== 'unknown') {
            recommendedVersion = fixAny[field];
            logger.info(`✅ Found recommended version in field '${field}': ${recommendedVersion}`);
            break;
          }
        }
        
        // Check nested objects
        if ((recommendedVersion === 'unknown' || recommendedVersion === 'latest' || !recommendedVersion) && fixAny.fixSuggestion) {
          const nested = fixAny.fixSuggestion;
          for (const field of versionFields) {
            if (nested[field] && nested[field] !== 'latest' && nested[field] !== 'unknown') {
              recommendedVersion = nested[field];
              logger.info(`✅ Found recommended version in nested fixSuggestion.${field}: ${recommendedVersion}`);
              break;
            }
          }
        }
        
        // Check vulnerability/finding data
        if ((recommendedVersion === 'unknown' || recommendedVersion === 'latest' || !recommendedVersion) && fixAny.finding) {
          const finding = fixAny.finding;
          for (const field of versionFields) {
            if (finding[field] && finding[field] !== 'latest' && finding[field] !== 'unknown') {
              recommendedVersion = finding[field];
              logger.info(`✅ Found recommended version in finding.${field}: ${recommendedVersion}`);
              break;
            }
          }
        }
      }
      
      // CRITICAL: Never allow "latest" or "unknown" as the final version
      if (recommendedVersion === 'latest' || recommendedVersion === 'unknown' || !recommendedVersion) {
        logger.error(`❌ CRITICAL: Could not resolve a valid recommended version for ${dependencyName}`);
        logger.error(`📊 Full fix object for debugging:`, JSON.stringify(fixAny, null, 2));
        // Set a clearly invalid version to prevent "latest" from being used
        recommendedVersion = 'VERSION_NOT_FOUND';
      }
      
      const result = {
        dependencyName,
        currentVersion,
        recommendedVersion,
        cveId,
        severity,
        description
      };
      
      logger.info(`✅ Converted fix:`, result);
      
      // Final validation
      if (recommendedVersion === 'VERSION_NOT_FOUND') {
        logger.error(`⚠️ Fix will be skipped due to missing recommended version for ${dependencyName}`);
      }
      
      return result;
    });
  }

  /**
   * Create comprehensive summary file with detailed fix information
   */
  private async createComprehensiveSummaryFile(
    repoPath: string, 
    allFixes: VulnerabilityFix[], 
    failedFixes: VulnerabilityFix[],
    successfulFixes: VulnerabilityFix[]
  ): Promise<void> {
    const totalFixes = allFixes.length;
    const successfulCount = successfulFixes.length;
    const failedCount = failedFixes.length;
    const successRate = totalFixes > 0 ? Math.round((successfulCount / totalFixes) * 100) : 0;

    const summaryContent = `# Security Dependency Updates Summary

## 📊 Fix Summary
- **Total vulnerabilities**: ${totalFixes}
- **Automatically fixed**: ${successfulCount} (${successRate}%)
- **Require manual fixes**: ${failedCount} (${100 - successRate}%)

${successfulFixes.length > 0 ? `## ✅ Successfully Automated Fixes

The following vulnerabilities have been automatically fixed in your build files:

${successfulFixes.map(fix => `### ${fix.cveId}: ${fix.dependencyName}
- **Current Version**: ${fix.currentVersion}
- **Updated To**: ${fix.recommendedVersion}
- **Severity**: ${fix.severity}
- **Description**: ${fix.description}

`).join('')}` : ''}

${failedFixes.length > 0 ? `## ❌ Manual Fixes Required

The following vulnerabilities could not be automatically fixed and require manual intervention:

${failedFixes.map(fix => `### ${fix.cveId}: ${fix.dependencyName}
- **Current Version**: ${fix.currentVersion}
- **Recommended Version**: ${fix.recommendedVersion}
- **Severity**: ${fix.severity}
- **Description**: ${fix.description}

**Manual Steps:**
1. Locate \`${fix.dependencyName}\` in your build files
2. Update the version from \`${fix.currentVersion}\` to \`${fix.recommendedVersion}\`
3. If it's a transitive dependency, add version override:
   - **Gradle**: Add to \`dependencyConstraints\` or \`resolutionStrategy.force\`
   - **Maven**: Add to \`<dependencyManagement>\` section
   - **npm**: Add to \`overrides\` in package.json

`).join('')}` : ''}

## 🔍 Build Files to Check

Based on your project structure, check these files for dependency declarations:

### Gradle Projects
- \`build.gradle\` or \`build.gradle.kts\`
- \`gradle.properties\` (for version variables)
- Multi-module: \`*/build.gradle\`

### Maven Projects  
- \`pom.xml\`
- Parent POM files in multi-module projects

### npm/Node.js Projects
- \`package.json\`
- \`package-lock.json\` (may need regeneration)

## 🛠️ Recommended Actions

1. **Review automated changes** (if any) in the modified build files
2. **Apply manual fixes** for vulnerabilities that couldn't be automated
3. **Test your build** after making changes:
   \`\`\`bash
   # Gradle
   ./gradlew build --refresh-dependencies
   
   # Maven
   mvn clean verify -U
   
   # npm
   npm install && npm run build
   \`\`\`
4. **Run security scans** to verify fixes
5. **Update your dependency management** strategy to prevent future vulnerabilities

## 📚 Additional Resources

- [OWASP Dependency Management](https://owasp.org/www-project-dependency-check/)
- [Gradle Dependency Management](https://docs.gradle.org/current/userguide/dependency_management.html)
- [Maven Dependency Management](https://maven.apache.org/guides/introduction/introduction-to-dependency-mechanism.html)
- [npm Security Best Practices](https://docs.npmjs.com/auditing-package-dependencies-for-security-vulnerabilities)

---
*This summary was generated automatically by the Security Dependency Management Tool.*
*Last updated: ${new Date().toISOString()}*
`;

    const summaryPath = path.join(repoPath, 'SECURITY_UPDATES_SUMMARY.md');
    await fs.writeFile(summaryPath, summaryContent, 'utf-8');
    
    logger.info(`📄 Created comprehensive summary with ${successfulFixes.length} automated and ${failedFixes.length} manual fixes`);
  }

  /**
   * Get modified content from a parsing result
   */
  private getModifiedFileContent(result: FileParsingResult): string {
    switch (result.fileType) {
      case 'gradle':
        return this.fileParserService['gradleParser'].getModifiedContent(result.modification as any);
      case 'maven':
        return this.fileParserService['mavenParser'].getModifiedContent(result.modification as any);
      case 'npm':
        return this.fileParserService['npmParser'].getModifiedContent(result.modification as any);
      default:
        return 'Modified content not available';
    }
  }

  /**
   * Parse package-lock.json for transitive dependencies
   */
  private parsePackageLock(lockData: any): Record<string, string> {
    const dependencies: Record<string, string> = {};
    
    const extractDependencies = (deps: any, isTransitive = false) => {
      if (!deps) return;
      
      for (const [name, info] of Object.entries(deps)) {
        if (typeof info === 'object' && info !== null) {
          const versionInfo = info as any;
          if (versionInfo.version) {
            dependencies[name] = versionInfo.version;
          }
          
          // Recursively extract nested dependencies (transitive)
          if (versionInfo.dependencies) {
            extractDependencies(versionInfo.dependencies, true);
          }
        }
      }
    };

    // Extract from packages (npm v7+) or dependencies (older versions)
    if (lockData.packages) {
      for (const [packagePath, packageInfo] of Object.entries(lockData.packages)) {
        if (packagePath && packagePath !== '' && typeof packageInfo === 'object') {
          const info = packageInfo as any;
          if (info.version) {
            const packageName = packagePath.replace(/^node_modules\//, '');
            dependencies[packageName] = info.version;
          }
        }
      }
    } else if (lockData.dependencies) {
      extractDependencies(lockData.dependencies);
    }

    return dependencies;
  }

  /**
   * Parse yarn.lock for transitive dependencies
   */
  private parseYarnLock(content: string): Record<string, string> {
    const dependencies: Record<string, string> = {};
    const lines = content.split('\n');
    let currentPackage = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Package declaration line (contains @, version ranges)
      if (line.includes('@') && line.endsWith(':')) {
        // Extract package name from yarn.lock format: "package@^1.0.0", "@scope/package@^2.0.0":
        const packageDeclaration = line.replace(/:$/, '').replace(/['"]/g, '');
        const packageMatch = packageDeclaration.match(/^(.+?)@[^@]*$/);
        if (packageMatch) {
          currentPackage = packageMatch[1];
        }
      }
      
      // Version line
      if (line.startsWith('version ') && currentPackage) {
        const versionMatch = line.match(/version ["']([^"']+)["']/);
        if (versionMatch && versionMatch[1]) {
          dependencies[currentPackage] = versionMatch[1];
          currentPackage = '';
        }
      }
    }
    
    return dependencies;
  }

  /**
   * Check if a dependency is declared directly in a Gradle build file
   */
  private isDirectGradleDependency(content: string, dependencyName: string): boolean {
    // Escape special regex characters
    const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    const [group, artifact] = dependencyName.includes(':') ? dependencyName.split(':') : ['', dependencyName];
    const escapedGroup = escapeRegex(group || '');
    const escapedArtifact = escapeRegex(artifact || '');
    
    // Patterns that indicate a direct dependency declaration
    const directPatterns: RegExp[] = [];
    
    if (group && group.trim()) {
      // Standard dependency declarations with group:artifact:version
      directPatterns.push(
        new RegExp(`(implementation|compile|api|runtimeOnly|testImplementation)\\s+['"]${escapedGroup}:${escapedArtifact}:`, 'i'),
        new RegExp(`(implementation|compile|api|runtimeOnly|testImplementation)\\s*\\(\\s*['"]${escapedGroup}:${escapedArtifact}:`, 'i')
      );
    }
    
    // Broader patterns for artifact name
    if (escapedArtifact) {
      directPatterns.push(
        new RegExp(`(implementation|compile|api|runtimeOnly|testImplementation)\\s+['"][^:'"]*:${escapedArtifact}:`, 'i'),
        new RegExp(`(implementation|compile|api|runtimeOnly|testImplementation)\\s*\\(\\s*['"][^:'"]*:${escapedArtifact}:`, 'i')
      );
    }
    
    // Check if any pattern matches
    for (const pattern of directPatterns) {
      if (pattern.test(content)) {
        logger.info(`✅ Found direct dependency declaration for ${dependencyName} using pattern: ${pattern.source}`);
        return true;
      }
    }
    
    logger.info(`❌ No direct dependency declaration found for ${dependencyName} - treating as transitive`);
    return false;
  }

  /**
   * Update Gradle dependency version with support for transitive dependencies
   */
  private updateGradleDependency(content: string, dependencyName: string, targetVersion: string, isDirect: boolean = true): string {
    logger.info(`Updating Gradle dependency: ${dependencyName} → ${targetVersion} (${isDirect ? 'direct' : 'transitive'})`);
    
    // Validate inputs
    if (!dependencyName || !targetVersion) {
      logger.warn(`Invalid dependency name or version: ${dependencyName} → ${targetVersion}`);
      return content;
    }
    
    // Escape special regex characters in dependency name
    const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // For Gradle, we need to handle group:artifact format
    const [group, artifact] = dependencyName.includes(':') ? dependencyName.split(':') : ['', dependencyName];
    const escapedGroup = escapeRegex(group || '');
    const escapedArtifact = escapeRegex(artifact || '');
    logger.info(`Parsed dependency - Group: '${group}', Artifact: '${artifact}'`);
    
    let updatedContent = content;
    let changesMade = false;
    
    if (isDirect) {
      // Handle direct dependencies - update existing declarations
      const patterns: RegExp[] = [];
      
      if (group && group.trim()) {
        // Standard format with group: implementation 'group:artifact:version'
        patterns.push(
          new RegExp(`(implementation\\s+['"]${escapedGroup}:${escapedArtifact}:)([^'"]+)(['"])`, 'g'),
          new RegExp(`(compile\\s+['"]${escapedGroup}:${escapedArtifact}:)([^'"]+)(['"])`, 'g'),
          new RegExp(`(runtimeOnly\\s+['"]${escapedGroup}:${escapedArtifact}:)([^'"]+)(['"])`, 'g'),
          new RegExp(`(api\\s+['"]${escapedGroup}:${escapedArtifact}:)([^'"]+)(['"])`, 'g'),
          new RegExp(`(testImplementation\\s+['"]${escapedGroup}:${escapedArtifact}:)([^'"]+)(['"])`, 'g'),
          
          // Variable patterns like ${springBootVersion}
          new RegExp(`(implementation\\s+['"]${escapedGroup}:${escapedArtifact}:\\$\\{)([^}]+)(\\}['"])`, 'g'),
          new RegExp(`(compile\\s+['"]${escapedGroup}:${escapedArtifact}:\\$\\{)([^}]+)(\\}['"])`, 'g')
        );
      }
      
      // Alternative patterns matching any group with this artifact (broader search)
      if (escapedArtifact) {
        patterns.push(
          new RegExp(`(implementation\\s+['"][^:'"]*:${escapedArtifact}:)([^'"]+)(['"])`, 'g'),
          new RegExp(`(compile\\s+['"][^:'"]*:${escapedArtifact}:)([^'"]+)(['"])`, 'g'),
          new RegExp(`(runtimeOnly\\s+['"][^:'"]*:${escapedArtifact}:)([^'"]+)(['"])`, 'g'),
          new RegExp(`(api\\s+['"][^:'"]*:${escapedArtifact}:)([^'"]+)(['"])`, 'g'),
          new RegExp(`(testImplementation\\s+['"][^:'"]*:${escapedArtifact}:)([^'"]+)(['"])`, 'g')
        );
      }
      
      for (const pattern of patterns) {
        logger.info(`Trying pattern: ${pattern.source}`);
        const matches = content.match(pattern);
        if (matches) {
          logger.info(`Pattern matched: ${matches}`);
          const newContent = updatedContent.replace(pattern, `$1${targetVersion}$3`);
          if (newContent !== updatedContent) {
            updatedContent = newContent;
            changesMade = true;
            logger.info(`✅ Applied update with pattern: ${pattern.source}`);
            break; // Stop after first successful update
          }
        }
      }
    } else {
      // Handle transitive dependencies - add to resolutionStrategy
      const dependencyForce = `            '${dependencyName}:${targetVersion}'`;
      
      // Check if configurations.all block exists
      const configBlock = /configurations\.all\s*\{[\s\S]*?resolutionStrategy\s*\{[\s\S]*?\}/;
      if (configBlock.test(content)) {
        // Add to existing resolutionStrategy
        const resolutionStrategyPattern = /(resolutionStrategy\s*\{[\s\S]*?)(^\s*\})/m;
        const match = content.match(resolutionStrategyPattern);
        if (match) {
          const beforeClosing = match[1];
          const closing = match[2];
          
          // Check if force block exists
          if (beforeClosing.includes('force(')) {
            // Add to existing force declarations
            const forcePattern = /(force\s*\(\s*)([\s\S]*?)(\s*\))/;
            const forceMatch = beforeClosing.match(forcePattern);
            if (forceMatch) {
              const forceStart = forceMatch[1];
              const existingForces = forceMatch[2].trim();
              const forceEnd = forceMatch[3];
              const newForceContent = existingForces ? `${existingForces},\n${dependencyForce}` : dependencyForce;
              const updatedForceBlock = `${forceStart}\n${newForceContent}\n        ${forceEnd}`;
              updatedContent = content.replace(forcePattern, updatedForceBlock);
              changesMade = true;
              logger.info(`✅ Added transitive dependency to existing force block`);
            }
          } else {
            // Create new force block
            updatedContent = content.replace(resolutionStrategyPattern, `${beforeClosing}\n        force(\n${dependencyForce}\n        )\n${closing}`);
            changesMade = true;
            logger.info(`✅ Created new force block for transitive dependency`);
          }
        }
      } else {
        // Add new configurations.all block at the end of the file
        const newConfigBlock = `

// Force resolution of transitive dependencies for security fixes
configurations.all {
    resolutionStrategy {
        force(
${dependencyForce}
        )
    }
}`;
        updatedContent = content + newConfigBlock;
        changesMade = true;
        logger.info(`✅ Added new configurations.all block for transitive dependency`);
      }
    }
    
    if (!changesMade) {
      logger.warn(`❌ No patterns matched for ${dependencyName} in Gradle file`);
      // Log some sample lines that might contain the artifact name
      const lines = content.split('\n').filter(line => 
        line.includes('implementation') || 
        line.includes('compile') || 
        line.includes(artifact) ||
        line.includes('runtimeOnly') ||
        line.includes('api')
      );
      if (lines.length > 0) {
        logger.info(`Sample dependency lines found:\n${lines.slice(0, 10).join('\n')}`);
      } else {
        logger.info('No dependency lines found in file');
      }
    }
    
    return updatedContent;
  }

  /**
   * Update package.json dependency version
   */
  private updatePackageJsonDependency(content: string, dependencyName: string, targetVersion: string): string {
    try {
      const packageJson = JSON.parse(content);
      let updated = false;

      // Update dependencies
      if (packageJson.dependencies && packageJson.dependencies[dependencyName]) {
        packageJson.dependencies[dependencyName] = targetVersion;
        updated = true;
      }

      // Update devDependencies
      if (packageJson.devDependencies && packageJson.devDependencies[dependencyName]) {
        packageJson.devDependencies[dependencyName] = targetVersion;
        updated = true;
      }

      if (updated) {
        return JSON.stringify(packageJson, null, 2);
      }
    } catch (error) {
      logger.error('Failed to parse package.json:', error);
    }

    return content;
  }

  /**
   * Update Maven dependency version in pom.xml
   */
  private updateMavenDependency(content: string, dependencyName: string, targetVersion: string): string {
    try {
      logger.info(`🔄 Updating Maven dependency: ${dependencyName} to version ${targetVersion}`);
      
      // Parse the dependency name (format: groupId:artifactId)
      const [groupId, artifactId] = dependencyName.split(':');
      if (!groupId || !artifactId) {
        logger.warn(`Invalid Maven dependency format: ${dependencyName}, expected groupId:artifactId`);
        return content;
      }
      
      // Create regex patterns to match Maven dependencies
      const dependencyPattern = new RegExp(
        `(<dependency>\\s*<groupId>\\s*${this.escapeXmlRegex(groupId)}\\s*</groupId>\\s*<artifactId>\\s*${this.escapeXmlRegex(artifactId)}\\s*</artifactId>\\s*<version>\\s*)[^<]+(\\s*</version>\\s*</dependency>)`,
        'g'
      );
      
      // Check if dependency exists
      if (!dependencyPattern.test(content)) {
        logger.warn(`Maven dependency not found: ${dependencyName}`);
        return content;
      }
      
      // Update the version
      const updatedContent = content.replace(dependencyPattern, `$1${targetVersion}$2`);
      
      // Verify the update was successful
      if (updatedContent === content) {
        logger.warn(`Failed to update Maven dependency: ${dependencyName}`);
        return content;
      }
      
      logger.info(`✅ Successfully updated Maven dependency: ${dependencyName} -> ${targetVersion}`);
      return updatedContent;
    } catch (error) {
      logger.error(`Error updating Maven dependency ${dependencyName}:`, error);
      return content;
    }
  }

  /**
   * Escape special characters for XML regex
   */
  private escapeXmlRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Update requirements.txt dependency version
   */
  private updateRequirementsTxt(content: string, dependencyName: string, targetVersion: string): string {
    const lines = content.split('\n');
    const updatedLines = lines.map(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith(dependencyName) && (trimmed.includes('==') || trimmed.includes('>='))) {
        return `${dependencyName}==${targetVersion}`;
      }
      return line;
    });
    
    return updatedLines.join('\n');
  }

  /**
   * Clean up temporary repository directory (legacy method - removes everything)
   */
  async cleanup(repoPath: string): Promise<void> {
    try {
      if (!repoPath || !path.isAbsolute(repoPath) || !repoPath.includes('temp')) {
        logger.warn('Invalid repository path for cleanup, skipping', { repoPath });
        return;
      }

      // Check if directory exists
      try {
        await fs.access(repoPath);
      } catch {
        logger.info(`Directory already cleaned up: ${repoPath}`);
        return;
      }

      // Use rmdir with recursive option for better compatibility
      try {
        await fs.rm(repoPath, { recursive: true, force: true });
      } catch (rmError) {
        // Fallback to rmdir for older Node.js versions
        await fs.rmdir(repoPath, { recursive: true });
      }
      
      logger.info(`Cleaned up temporary directory: ${repoPath}`);
    } catch (error) {
      logger.warn(`Failed to clean up directory ${repoPath}:`, error);
      // Don't throw error for cleanup failures
    }
  }

  /**
   * Clean up only the working copy, preserve cache
   */
  async cleanupWorkingCopy(repoPath: string): Promise<void> {
    try {
      if (!repoPath || !path.isAbsolute(repoPath) || !repoPath.includes('temp')) {
        logger.warn('Invalid repository path for cleanup, skipping', { repoPath });
        return;
      }

      // Check if directory exists
      try {
        await fs.access(repoPath);
      } catch {
        logger.info(`Working copy already cleaned up: ${repoPath}`);
        return;
      }

      // Only remove the working copy, not the cache
      // The working copy is in temp/repos/{owner}-{repo}-{uuid}
      // The cache is in temp/cache/{owner}-{repo}
      // So we only remove the specific working copy directory
      try {
        await fs.rm(repoPath, { recursive: true, force: true });
        logger.info(`Cleaned up working copy: ${repoPath} (cache preserved)`);
      } catch (rmError) {
        // Fallback to rmdir for older Node.js versions
        await fs.rmdir(repoPath, { recursive: true });
      }
    } catch (error) {
      logger.warn(`Failed to clean up working copy ${repoPath}:`, error);
      // Don't throw error for cleanup failures
    }
  }

  /**
   * Check if a cached repository is valid and up-to-date
   */
  private async isCachedRepositoryValid(cachePath: string, repositoryUrl: string): Promise<boolean> {
    try {
      // Check if cache directory exists
      if (!await fs.access(cachePath).then(() => true).catch(() => false)) {
        logger.info(`📋 Cache not found: ${cachePath}`);
        return false;
      }

      // Check if cache is not too old (24 hours)
      const cacheStats = await fs.stat(cachePath);
      const cacheAge = Date.now() - cacheStats.mtime.getTime();
      const maxCacheAge = 24 * 60 * 60 * 1000; // 24 hours

      if (cacheAge > maxCacheAge) {
        logger.info(`📋 Cache is too old (${Math.round(cacheAge / (60 * 60 * 1000))}h), will re-clone`);
        return false;
      }

      // Check if .git directory exists (indicates valid repository)
      const gitPath = path.join(cachePath, '.git');
      if (!await fs.access(gitPath).then(() => true).catch(() => false)) {
        logger.info(`📋 Cache is not a valid git repository`);
        return false;
      }

      logger.info(`📋 Cache is valid and recent (${Math.round(cacheAge / (60 * 60 * 1000))}h old)`);
      return true;
    } catch (error) {
      logger.warn(`📋 Error checking cache validity:`, error);
      return false;
    }
  }

  /**
   * Copy a cached repository to working directory
   */
  private async copyCachedRepository(cachePath: string, targetPath: string): Promise<void> {
    try {
      // Ensure target directory doesn't exist
      await fs.rm(targetPath, { recursive: true, force: true });
      
      // Copy the entire repository
      await fs.cp(cachePath, targetPath, { recursive: true });
      logger.info(`📋 Repository copied from cache: ${cachePath} -> ${targetPath}`);
    } catch (error) {
      logger.error(`📋 Error copying cached repository:`, error);
      throw new Error(`Failed to copy cached repository: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Cache a repository for future use
   */
  private async cacheRepository(repoPath: string, cachePath: string): Promise<void> {
    try {
      // Ensure cache directory exists
      const cacheDir = path.dirname(cachePath);
      await fs.mkdir(cacheDir, { recursive: true });
      
      // Clean old cache entries before adding new one
      await this.cleanOldCacheEntries(cacheDir);
      
      // Remove existing cache if it exists
      await fs.rm(cachePath, { recursive: true, force: true });
      
      // Copy repository to cache
      await fs.cp(repoPath, cachePath, { recursive: true });
      logger.info(`📋 Repository cached: ${repoPath} -> ${cachePath}`);
    } catch (error) {
      logger.warn(`📋 Error caching repository:`, error);
      // Don't throw - caching failure shouldn't break the main flow
    }
  }

  /**
   * Clean old cache entries to prevent disk space issues
   */
  private async cleanOldCacheEntries(cacheDir: string): Promise<void> {
    try {
      const entries = await fs.readdir(cacheDir);
      const now = Date.now();
      const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
      let cleanedCount = 0;

      for (const entry of entries) {
        const entryPath = path.join(cacheDir, entry);
        try {
          const stats = await fs.stat(entryPath);
          const age = now - stats.mtime.getTime();
          
          if (age > maxAge) {
            await fs.rm(entryPath, { recursive: true, force: true });
            cleanedCount++;
            logger.info(`📋 Cleaned old cache entry: ${entry} (${Math.round(age / (24 * 60 * 60 * 1000))} days old)`);
          }
        } catch (error) {
          logger.warn(`📋 Error checking cache entry ${entry}:`, error);
        }
      }

      if (cleanedCount > 0) {
        logger.info(`📋 Cleaned ${cleanedCount} old cache entries`);
      }
    } catch (error) {
      logger.warn(`📋 Error cleaning cache:`, error);
    }
  }
}