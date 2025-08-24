import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { GitHubService } from '../services/github/GitHubService';
import { JiraService } from '../services/jira/JiraService';
import { DependencyAnalyzer } from '../services/dependencyAnalyzer/DependencyAnalyzer';
import { VulnerabilityMatcher } from '../services/vulnerabilityMatcher/VulnerabilityMatcher';
import { FileParserService } from '../services/fileParser/FileParserService';
import { logger } from '../utils/logger';
import { 
  AnalyzeRepositoryRequest, 
  AnalyzeRepositoryResponse,
  GitHubConfig,
  JiraConfig,
  PackageManager,
  Dependency,
  MajorUpgradeRequirement
} from '../types';

const router = Router();

// Helper function to clean up version strings and resolve from dependency tree
const cleanVersion = (version: string, dependencyName: string, dependencyTree?: Dependency[]): string => {
  logger.info(`🔍 Cleaning version: "${version}" for dependency: "${dependencyName}"`);
  
  // ALWAYS try to find the dependency in the tree first (whether it has variables or not)
  if (dependencyTree && dependencyTree.length > 0) {
    logger.info(`🌳 Searching dependency tree with ${dependencyTree.length} dependencies for: ${dependencyName}`);
    
    // Strategy 1: Exact name match
    let resolvedDep = dependencyTree.find(dep => dep.name === dependencyName);
    
    // Strategy 2: Check if dependency name contains the artifact name (for Gradle format like "group:artifact")
    if (!resolvedDep && dependencyName.includes(':')) {
      const artifactName = dependencyName.split(':')[1];
      resolvedDep = dependencyTree.find(dep => 
        dep.name === dependencyName ||
        dep.name.includes(artifactName) ||
        dep.name.endsWith(`:${artifactName}`)
      );
    }
    
    // Strategy 3: Reverse lookup - check if tree dependency matches our name
    if (!resolvedDep) {
      resolvedDep = dependencyTree.find(dep => 
        dependencyName.includes(dep.name) ||
        (dep.name.includes(':') && dependencyName.includes(dep.name.split(':')[1]))
      );
    }
    
    // Strategy 4: Spring Boot special handling
    if (!resolvedDep && dependencyName.includes('spring-boot')) {
      resolvedDep = dependencyTree.find(dep => 
        dep.name.includes('spring-boot') && 
        (dep.name.includes('starter') || dep.name.includes('boot')) &&
        dep.version && 
        !dep.version.includes('$') && 
        !dep.version.includes('unknown')
      );
    }
    
    if (resolvedDep && resolvedDep.version && !resolvedDep.version.includes('$') && !resolvedDep.version.includes('unknown')) {
      logger.info(`✅ Found in dependency tree: ${dependencyName} -> ${resolvedDep.name}:${resolvedDep.version}`);
      return resolvedDep.version;
    } else {
      logger.warn(`⚠️ Not found in dependency tree: ${dependencyName}`, {
        searchedIn: dependencyTree.slice(0, 5).map(d => `${d.name}:${d.version}`)
      });
    }
  }
  
  // Handle Gradle variables like ${springBootVersion}
  if (version.startsWith('${') && version.endsWith('}')) {
    const varName = version.slice(2, -1);
    logger.warn(`⚠️ Gradle variable ${varName} could not be resolved - using dependency tree failed`);
    return 'unknown';
  }
  
  // Handle other variable formats
  if (version.includes('$')) {
    logger.warn(`⚠️ Unknown variable format: ${version}`);
    return 'unknown';
  }
  
  // Clean up version ranges and keep only the version number
  const cleanedVersion = version.replace(/[~^>=<]/g, '').trim();
  
  return cleanedVersion || 'unknown';
};

// Enhanced version extraction from JIRA data
const extractTargetVersion = (wizFinding: any, dependencyName: string): string | undefined => {
  if (!wizFinding) return undefined;
  
  logger.info(`🔍 Extracting target version for ${dependencyName} from JIRA data`);
  
  // Multiple patterns to try for version extraction - updated to handle JIRA markdown formatting
  const patterns = [
    // JIRA markdown patterns with asterisks and tabs/whitespace - both semantic and date versions
    /\s*\*Recommended Version\*:\s*([0-9]+(?:\.[0-9]+)*(?:\.[0-9]+)*[a-zA-Z0-9.-]*)/i,
    /\s*Recommended Version\*:\s*([0-9]+(?:\.[0-9]+)*(?:\.[0-9]+)*[a-zA-Z0-9.-]*)/i,
    /\s*\*Recommended Version:\s*([0-9]+(?:\.[0-9]+)*(?:\.[0-9]+)*[a-zA-Z0-9.-]*)/i,
    // Standard patterns - both semantic and date versions
    /Recommended Version:\s*([0-9]+(?:\.[0-9]+)*(?:\.[0-9]+)*[a-zA-Z0-9.-]*)/i,
    /recommended version[:\s]+([0-9]+(?:\.[0-9]+)*(?:\.[0-9]+)*[a-zA-Z0-9.-]*)/i,
    // Action patterns with asterisks - both semantic and date versions
    /Update to version\s*\*?\s*([0-9]+(?:\.[0-9]+)*(?:\.[0-9]+)*[a-zA-Z0-9.-]*)/i,
    /update to version[:\s*]+([0-9]+(?:\.[0-9]+)*(?:\.[0-9]+)*[a-zA-Z0-9.-]*)/i,
    /upgrade to[:\s*]+([0-9]+(?:\.[0-9]+)*(?:\.[0-9]+)*[a-zA-Z0-9.-]*)/i,
    // Maven coordinate patterns in commands - both semantic and date versions
    /commons-io:commons-io:([0-9]+(?:\.[0-9]+)*(?:\.[0-9]+)*[a-zA-Z0-9.-]*)/i,
    /org\.springframework\.boot:spring-boot[^:]*:([0-9]+(?:\.[0-9]+)*(?:\.[0-9]+)*[a-zA-Z0-9.-]*)/i,
    /org\.springframework:spring-[^:]*:([0-9]+(?:\.[0-9]+)*(?:\.[0-9]+)*[a-zA-Z0-9.-]*)/i,
    /org\.springframework\.security:spring-security-[^:]*:([0-9]+(?:\.[0-9]+)*(?:\.[0-9]+)*[a-zA-Z0-9.-]*)/i,
    // Generic version patterns (these work well!) - both semantic and date versions
    /version[:\s*]+([0-9]+(?:\.[0-9]+)*(?:\.[0-9]+)*[a-zA-Z0-9.-]*)/i,
    /v([0-9]+(?:\.[0-9]+)*(?:\.[0-9]+)*[a-zA-Z0-9.-]*)/i
  ];
  
  // Check description first
  if (wizFinding.description) {
    const description = wizFinding.description;
    logger.info(`Checking description for ${dependencyName}:`, {
      description: description.substring(0, 300)
    });
    
    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
      const match = description.match(pattern);
      if (match && match[1]) {
        const version = match[1].replace(/\*/g, '').trim();
        logger.info(`✅ Found version in description using pattern ${i+1}/${patterns.length} "${pattern.source}": ${dependencyName} -> ${version}`);
        return version;
      } else {
        logger.info(`❌ Pattern ${i+1}/${patterns.length} "${pattern.source}" did not match`);
      }
    }
  }
  
  // Check recommended actions
  if (wizFinding.recommendedActions) {
    for (const action of wizFinding.recommendedActions) {
      logger.info(`Checking action for ${dependencyName}: ${action}`);
      
      for (let i = 0; i < patterns.length; i++) {
        const pattern = patterns[i];
        const match = action.match(pattern);
        if (match && match[1]) {
          const version = match[1].replace(/\*/g, '').trim();
          logger.info(`✅ Found version in action using pattern ${i+1}/${patterns.length} "${pattern.source}": ${dependencyName} -> ${version}`);
          return version;
        }
      }
    }
  }
  
  // Check command field if available
  if (wizFinding.command) {
    logger.info(`Checking command for ${dependencyName}: ${wizFinding.command}`);
    
    for (const pattern of patterns) {
      const match = wizFinding.command.match(pattern);
      if (match && match[1]) {
        const version = match[1].replace(/\*/g, '').trim();
        logger.info(`✅ Found version in command using pattern "${pattern.source}": ${dependencyName} -> ${version}`);
        return version;
      }
    }
  }
  
  logger.warn(`❌ No target version found for ${dependencyName} in JIRA data`);
  return undefined;
};

/**
 * POST /api/analysis/analyze
 * Alias for analyze-repository endpoint
 */
router.post('/analyze', asyncHandler(async (req: Request, res: Response) => {
  // Forward to the main analysis endpoint
  const {
    repositoryUrl,
    jiraTickets,
    githubConfig,
    jiraConfig
  } = req.body;

  // Transform the request format
  const transformedRequest = {
    repositoryUrl,
    jiraTickets,
    githubToken: githubConfig?.token,
    jiraToken: jiraConfig?.apiToken,
    jiraEmail: jiraConfig?.username,
    jiraBaseUrl: jiraConfig?.baseUrl
  };

  // Set longer timeout for repository analysis (first-time Gradle downloads can take time)
  res.setTimeout(900000); // 15 minutes (matches frontend timeout)
  req.setTimeout(900000); // 15 minutes
  
  const analysisTimeout = setTimeout(() => {
    logger.warn('Analysis timeout reached');
  }, 840000); // 14 minutes warning

  // Set the transformed request body
  req.body = transformedRequest;
  
  // Call the analyze-repository handler directly
  return analyzeRepositoryHandler(req, res);
}));

// Extract the main analysis logic into a reusable function
const analyzeRepositoryHandler = async (req: Request, res: Response) => {
  const {
    repositoryUrl,
    jiraTickets,
    githubToken,
    jiraToken,
    jiraEmail,
    jiraBaseUrl
  }: AnalyzeRepositoryRequest = req.body;

  logger.info('Starting repository analysis', {
    repositoryUrl,
    ticketCount: jiraTickets.length,
    tickets: jiraTickets,
  });

      // Set a timeout for the entire analysis (increased for large repositories)
    const analysisTimeout = setTimeout(() => {
      logger.error('Analysis timeout exceeded (15 minutes)');
      return res.status(500).json({
        success: false,
        error: {
          code: 'ANALYSIS_TIMEOUT',
          message: 'Analysis took too long and was terminated. Large repositories may need more time. Please try again.',
          timestamp: new Date(),
        },
      });
    }, 15 * 60 * 1000); // 15 minutes timeout (increased from 10 minutes)

  try {
    // Initialize services
    const githubConfig: GitHubConfig = { token: githubToken };
    const jiraConfig: JiraConfig = {
      baseUrl: jiraBaseUrl,
      email: jiraEmail,
      token: jiraToken,
      projectKey: 'WIZ', // Default project key
    };

    const githubService = new GitHubService(githubConfig);
    const jiraService = new JiraService(jiraConfig);
    const dependencyAnalyzer = new DependencyAnalyzer();
    const vulnerabilityMatcher = new VulnerabilityMatcher();

    // Step 1: Get repository information
    logger.info('Fetching repository information');
    const repository = await githubService.getRepository(repositoryUrl);
    logger.info('Repository fetched successfully', { repositoryId: repository.id });

          // Step 2: Clone repository and analyze dependencies
      logger.info('Cloning repository and analyzing dependencies');
      const repoPath = await githubService.cloneRepository(repositoryUrl);
      logger.info('Repository cloned successfully', { repoPath });
      
      // Add a checkpoint to track progress
      const startTime = Date.now();
      const logProgress = () => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        logger.info(`⏱️ Analysis progress: ${elapsed}s elapsed`);
      };
      
      // Log progress every 30 seconds
      const progressInterval = setInterval(logProgress, 30000);
      
      // Clear timeout and interval on completion
      const cleanup = () => {
        clearTimeout(analysisTimeout);
        clearInterval(progressInterval);
      };
    
    try {
      // Step 2: Analyze repository and build dependency tree
      logger.info('=== DEPENDENCY ANALYSIS STARTED ===');
      
      // Progress tracking
      const progress = {
        stage: 'Scanning files',
        message: 'Finding package files in repository...',
        percentage: 10
      };
      
      // Emit progress update (you can implement WebSocket/SSE for real-time updates)
      logger.info('📊 PROGRESS:', progress);

      logger.info('Finding package files...');
      progress.stage = 'Finding package files';
      progress.message = 'Scanning repository for build files...';
      progress.percentage = 20;
      logger.info('📊 PROGRESS:', progress);
      
      const packageFiles = await githubService.findPackageFiles(repoPath);
      logger.info('Package files found', { count: packageFiles.length, files: packageFiles.map(f => f.filePath) });
      
      if (packageFiles.length === 0) {
        logger.warn('No package files found in repository');
      }

      progress.stage = 'Building dependency tree';
      progress.message = 'Running Gradle commands to resolve dependencies...';
      progress.percentage = 40;
      logger.info('📊 PROGRESS:', progress);

      logger.info('Building dependency tree for repository');
      logger.info('Repository path:', { repoPath });

      // Build dependency relationships with Gradle resolution and timeout
      const treeStartTime = Date.now();
      const maxTreeTime = 600000; // 10 minutes max for dependency tree building (accounts for first-time library downloads)
      
      const treePromise = dependencyAnalyzer.buildDependencyTree(
        repository.id,
        packageFiles,
        repoPath  // Pass the cloned repository path
      );
      const treeTimeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Dependency tree building timed out after 10 minutes')), maxTreeTime);
      });
      
      const dependencyTree = await Promise.race([treePromise, treeTimeoutPromise]) as any;
      
      const treeTime = Date.now() - treeStartTime;
      logger.info(`🌳 Dependency tree built in ${treeTime}ms`);
      
      // ✅ VALIDATION: Check if Gradle placeholders were properly resolved
      const remainingPlaceholders = dependencyTree.dependencies.filter((d: any) => 
        d.name === 'gradle-project-placeholder' || d.version === 'placeholder'
      );
      
      if (remainingPlaceholders.length > 0) {
        logger.error('❌ Gradle resolution failed - placeholder dependencies still present');
        logger.error('🔍 Gradle placeholders found:', remainingPlaceholders.map((d: any) => `${d.name}:${d.version}`));
        
        // Send error response immediately instead of throwing
        clearTimeout(analysisTimeout);
        return res.status(400).json({
          success: false,
          error: {
            code: 'GRADLE_RESOLUTION_FAILED',
            message: `Gradle dependency resolution failed: ${remainingPlaceholders.length} placeholder dependencies were not resolved by gradle dependencies command`,
            details: {
              placeholders: remainingPlaceholders.map((d: any) => ({ name: d.name, version: d.version })),
              possibleCauses: [
                'Gradle commands failed to execute properly',
                'gradlew is not executable or missing',
                'Project structure incompatible with gradle dependencies command'
              ]
            },
            timestamp: new Date(),
          },
        });
      }

      progress.stage = 'Dependencies resolved';
      progress.message = `Found ${dependencyTree.dependencies.length} dependencies`;
      progress.percentage = 60;
      logger.info('📊 PROGRESS:', progress);
      
      logger.info('Dependency tree built successfully', { 
        dependencies: dependencyTree.dependencies.length,
        sampleDeps: dependencyTree.dependencies.slice(0, 5).map((d: any) => `${d.name}:${d.version}`)
      });

      // ✅ VALIDATION: Stop if dependency tree is empty or invalid
      if (!dependencyTree || !dependencyTree.dependencies || dependencyTree.dependencies.length === 0) {
        logger.error('❌ ANALYSIS STOPPED: No dependencies found in repository');
        logger.error('📊 Dependency tree validation failed:', {
          treeExists: !!dependencyTree,
          dependenciesExists: !!(dependencyTree?.dependencies),
          dependencyCount: dependencyTree?.dependencies?.length || 0,
          packageFiles: packageFiles.length,
          packageFilePaths: packageFiles.map(f => f.filePath)
        });
        
        progress.stage = 'Failed';
        progress.message = 'No dependencies detected - analysis stopped';
        progress.percentage = 0;
        logger.info('📊 PROGRESS:', progress);
        
        return res.status(400).json({
          success: false,
          error: {
            code: 'NO_DEPENDENCIES_FOUND',
            message: 'No dependencies could be detected in this repository. Please ensure it contains valid package files (build.gradle, pom.xml, package.json, etc.) and try again.',
            details: {
              packageFilesFound: packageFiles.length,
              packageFiles: packageFiles.map(f => ({ path: f.filePath })),
              suggestedActions: [
                'Verify the repository contains build files',
                'Ensure Gradle wrapper (gradlew) is present for Gradle projects',
                'Check if the repository is a valid package manager project'
              ]
            },
            timestamp: new Date(),
          },
        });
      }

      // ✅ VALIDATION: Stop if dependencies have unresolved versions
            const unresolvedDeps = dependencyTree.dependencies.filter((dep: any) =>
        dep.version.includes('${') || 
        dep.version === 'vunknown' || 
        dep.version.startsWith('v${') ||
        dep.version === 'unknown'
      );

      if (unresolvedDeps.length > 0) {
        logger.error('❌ ANALYSIS STOPPED: Dependencies have unresolved versions');
        logger.error('🔍 Unresolved dependencies found:', {
          count: unresolvedDeps.length,
          totalDeps: dependencyTree.dependencies.length,
          percentage: Math.round((unresolvedDeps.length / dependencyTree.dependencies.length) * 100),
          samples: unresolvedDeps.slice(0, 10).map((d: any) => `${d.name}:${d.version} (${d.packageManager})`)
        });

        // Check specifically for Gradle dependencies
        const gradleDeps = dependencyTree.dependencies.filter(d => d.packageManager === 'gradle');
        const unresolvedGradleDeps = unresolvedDeps.filter(d => d.packageManager === 'gradle');
        
        logger.error('📋 Gradle dependency analysis:', {
          totalGradleDeps: gradleDeps.length,
          unresolvedGradleDeps: unresolvedGradleDeps.length,
          gradleResolutionWorked: unresolvedGradleDeps.length === 0,
          sampleGradleDeps: gradleDeps.slice(0, 5).map(d => `${d.name}:${d.version}`)
        });

        progress.stage = 'Failed';
        progress.message = `${unresolvedDeps.length} dependencies have unresolved versions - analysis stopped`;
        progress.percentage = 0;
        logger.info('📊 PROGRESS:', progress);
        
        return res.status(400).json({
          success: false,
          error: {
            code: 'UNRESOLVED_DEPENDENCY_VERSIONS',
            message: `Cannot continue analysis: ${unresolvedDeps.length} out of ${dependencyTree.dependencies.length} dependencies have unresolved versions (${Math.round((unresolvedDeps.length / dependencyTree.dependencies.length) * 100)}%).`,
            details: {
              unresolvedCount: unresolvedDeps.length,
              totalDependencies: dependencyTree.dependencies.length,
              unresolvedSamples: unresolvedDeps.slice(0, 10).map(d => ({
                name: d.name,
                version: d.version,
                packageManager: d.packageManager,
                filePath: d.filePath
              })),
              possibleCauses: [
                'Gradle dependency resolution commands failed to execute',
                'Variables in build.gradle files could not be resolved',
                'Gradle wrapper (gradlew) is missing or not executable',
                'Project structure is not compatible with gradle dependencies command'
              ],
              suggestedActions: [
                'Check backend logs for Gradle command execution details',
                'Ensure gradlew is present and executable in the repository',
                'Verify the repository builds successfully with gradle',
                'Check if multi-module Gradle project is properly configured'
              ]
            },
            timestamp: new Date(),
          },
        });
      }

      // ✅ Log dependency summary before continuing
      logger.info('🎯 DEPENDENCY TREE VALIDATED - Continuing with analysis');
      logger.info(`📦 Total dependencies: ${dependencyTree.dependencies.length}`);
      logger.info('🔍 Top 10 dependencies with versions:');
      dependencyTree.dependencies.slice(0, 10).forEach((dep, index) => {
        logger.info(`   ${index + 1}. ${dep.name}:${dep.version}`);
      });

      // Step 3: Fetch JIRA tickets and Wiz findings
      let vulnerabilities: any[] = [];
      let tickets: any[] = [];
      
      try {
        logger.info('🎫 JIRA TICKET PROCESSING DEBUG - Starting');
        logger.info(`📝 Requested ${jiraTickets.length} tickets: ${jiraTickets.join(', ')}`);
        
        tickets = await jiraService.getTickets(jiraTickets);
        
        logger.info('🎫 JIRA TICKET FETCH RESULTS:');
        logger.info(`✅ Successfully fetched: ${tickets.length} tickets`);
        logger.info(`❌ Failed to fetch: ${jiraTickets.length - tickets.length} tickets`);
        
        const fetchedKeys = tickets.map(t => t.key);
        const missingKeys = jiraTickets.filter(key => !fetchedKeys.includes(key));
        
        if (missingKeys.length > 0) {
          logger.error(`🚨 MISSING TICKETS: ${missingKeys.join(', ')}`);
          missingKeys.forEach(key => {
            logger.error(`❌ Failed to fetch ticket: ${key}`);
          });
        }
        
        // Log detailed JIRA ticket parsing information
        let totalWizFindings = 0;
        const ticketAnalysis = tickets.map((ticket, index) => {
          const wizFindingsCount = ticket.wizFindings?.length || 0;
          totalWizFindings += wizFindingsCount;
          
          const analysis = {
            position: index + 1,
            key: ticket.key,
            summary: ticket.summary,
            wizFindingsCount,
            hasDescription: !!ticket.description,
            descriptionLength: ticket.description?.length || 0,
            status: ticket.status,
            wizFindings: ticket.wizFindings?.map((f: any) => ({
              id: f.id,
              title: f.title,
              severity: f.severity,
              cveIds: f.cveIds,
              affectedPackages: f.affectedPackages?.length || 0
            })) || []
          };
          
          logger.info(`🎫 Ticket ${index + 1}/${tickets.length} Analysis:`, analysis);
          
          if (wizFindingsCount === 0) {
            logger.warn(`⚠️ No WizFindings extracted from ticket ${ticket.key}`);
            logger.warn(`   Summary: ${ticket.summary}`);
            logger.warn(`   Description preview: ${(ticket.description || '').substring(0, 200)}...`);
          }
          
          return analysis;
        });
        
        logger.info('🎫 JIRA PARSING SUMMARY:');
        logger.info(`📊 Total tickets processed: ${tickets.length}`);
        logger.info(`📊 Total WizFindings extracted: ${totalWizFindings}`);
        logger.info(`📊 Tickets with no findings: ${ticketAnalysis.filter(t => t.wizFindingsCount === 0).length}`);
        
        // Extract vulnerabilities from JIRA tickets
        logger.info('🔄 VULNERABILITY EXTRACTION - Starting');
        
        vulnerabilities = tickets.flatMap((ticket: any, ticketIndex: number) => {
          if (!ticket.wizFindings || ticket.wizFindings.length === 0) {
            logger.warn(`⚠️ Ticket ${ticket.key} has no WizFindings - skipping vulnerability extraction`);
            return [];
          }
          
          logger.info(`🔄 Processing ${ticket.wizFindings.length} findings from ticket ${ticket.key}`);
          
          return ticket.wizFindings.map((finding: any, findingIndex: number) => {
            // Better ecosystem mapping based on package files found
            const ecosystemMap = new Map();
            packageFiles.forEach((pf: any) => {
              ecosystemMap.set(pf.packageManager, pf.packageManager);
            });
            
            const mappedPackages = finding.affectedPackages.map((pkg: any) => {
               let packageName = pkg;
               let ecosystem: PackageManager = 'npm'; // default
               
               // Handle Maven coordinate format: group:artifact or group:artifact:version
               if (pkg.includes(':') && pkg.split(':').length >= 2) {
                 const parts = pkg.split(':');
                 packageName = `${parts[0]}:${parts[1]}`; // group:artifact
                 ecosystem = 'maven';
               } else if (pkg.includes('/')) {
                 // Handle scoped npm packages
                 packageName = pkg;
                 if (ecosystemMap.has('maven') || ecosystemMap.has('gradle')) {
                   ecosystem = 'maven'; // Treat Gradle as Maven for vulnerability matching
                 } else if (ecosystemMap.has('npm') || ecosystemMap.has('yarn')) {
                   ecosystem = 'npm';
                 } else if (ecosystemMap.has('pip') || ecosystemMap.has('poetry')) {
                   ecosystem = 'pip';  
                 } else if (ecosystemMap.has('go')) {
                   ecosystem = 'go';
                 }
               }
               
               // Extract recommended version from findings
               const fixedVersions: string[] = [];
               const recommendedActions = finding.recommendedActions || [];
               for (const action of recommendedActions) {
                 const versionMatch = action.match(/Update to version ([0-9]+\.[0-9]+\.[0-9]+[a-zA-Z0-9.-]*)/);
                 if (versionMatch) {
                   fixedVersions.push(versionMatch[1]);
                 }
               }
               
               return {
                 name: packageName,
                 ecosystem,
                 affectedVersions: ['*'],
                 fixedVersions,
               };
             });

            const vulnerability = {
              id: finding.id,
              cveId: finding.cveIds?.[0] || finding.id,
              title: finding.title,
              description: finding.description,
              severity: finding.severity,
              affectedPackages: mappedPackages,
              publishedAt: finding.detectionDate,
              updatedAt: finding.detectionDate,
            };

            logger.info(`✅ Created vulnerability from ${ticket.key} finding ${findingIndex + 1}:`, {
               sourceTicket: ticket.key,
               vulnerabilityId: vulnerability.id,
               cveId: vulnerability.cveId,
               title: vulnerability.title,
               severity: vulnerability.severity,
               affectedPackagesCount: mappedPackages.length,
               rawAffectedPackages: finding.affectedPackages,
               mappedPackages: mappedPackages.map((pkg: any) => ({ name: pkg.name, ecosystem: pkg.ecosystem }))
             });
            
            return vulnerability;
          });
        });
        
        logger.info('🔄 VULNERABILITY EXTRACTION RESULTS:');
        logger.info(`📊 Total vulnerabilities before deduplication: ${vulnerabilities.length}`);
        
        // Deduplicate vulnerabilities by CVE ID to prevent duplicates
        const originalCount = vulnerabilities.length;
        const deduplicatedVulnerabilities = vulnerabilities.reduce((acc: any[], vuln: any) => {
          const existingVuln = acc.find(existing => existing.cveId === vuln.cveId);
          if (!existingVuln) {
            acc.push(vuln);
            logger.info(`✅ Added unique vulnerability: ${vuln.cveId || vuln.id}`);
          } else {
            logger.warn(`🔄 Merging duplicate CVE: ${vuln.cveId} (original from ${existingVuln.id}, duplicate from ${vuln.id})`);
            // If duplicate found, merge affected packages
            existingVuln.affectedPackages = [
              ...existingVuln.affectedPackages,
              ...vuln.affectedPackages
            ].filter((pkg: any, index: number, arr: any[]) => 
              arr.findIndex(p => p.name === pkg.name && p.ecosystem === pkg.ecosystem) === index
            );
          }
          return acc;
        }, []);

        vulnerabilities = deduplicatedVulnerabilities;
        
        logger.info('🔄 DEDUPLICATION RESULTS:');
        logger.info(`📊 Original count: ${originalCount}`);
        logger.info(`📊 Deduplicated count: ${vulnerabilities.length}`);
        logger.info(`📊 Duplicates removed: ${originalCount - vulnerabilities.length}`);
        
        logger.info('🔄 FINAL VULNERABILITY LIST:');
        vulnerabilities.forEach((v: any, index: number) => {
          logger.info(`📋 Vulnerability ${index + 1}/${vulnerabilities.length}:`, {
            id: v.id,
            cveId: v.cveId,
            title: v.title,
            severity: v.severity,
            affectedPackagesCount: v.affectedPackages.length
          });
        });
        
        } catch (jiraError: any) {
          logger.error('JIRA service failed - no fallback data available', { 
            error: jiraError.message 
          });
          
          // No mock data - must use real JIRA data
          throw new Error(`JIRA service is required but failed: ${jiraError.message}`);
        }

      // Step 4: Enhanced vulnerability matching (bypassing old analyzer)
      logger.info('Matching vulnerabilities with ALL dependencies using enhanced logic');
      const vulnerabilityMatches = await vulnerabilityMatcher.matchVulnerabilities(
        vulnerabilities,
        dependencyTree.dependencies, // Pass ALL dependencies, not just pre-filtered ones
        tickets
      );

      // Step 5: Identify false positives (vulnerabilities with no matching dependencies)
      const matchedVulnerabilityIds = new Set(vulnerabilityMatches.map(match => match.vulnerability.id));
      const falsePositives = vulnerabilities.filter(vuln => !matchedVulnerabilityIds.has(vuln.id));
      
      logger.info('False positives identified', {
        falsePositiveCount: falsePositives.length,
        falsePositives: falsePositives.map(fp => ({
          id: fp.id,
          cveId: fp.cveId,
          title: fp.title,
          affectedPackages: fp.affectedPackages.map((pkg: any) => pkg.name)
        }))
      });
      
      // Extract affected dependencies and generate suggestions from matches
      const affectedDependencies = vulnerabilityMatches.flatMap(match => match.affectedDependencies);
      const suggestions = vulnerabilityMatches.flatMap(match => match.fixSuggestions || []);
      
      // ✅ FIX: Mark dependencies as vulnerable in the dependency tree
      logger.info('🔧 Marking dependencies as vulnerable in dependency tree...');
      const vulnerableDependencyNames = new Set(affectedDependencies.map(dep => dep.name));
      
      // Update the dependency tree to mark vulnerable dependencies
      dependencyTree.dependencies = dependencyTree.dependencies.map(dep => ({
        ...dep,
        isVulnerable: vulnerableDependencyNames.has(dep.name),
        // Keep existing isDev value
        isDev: dep.isDev || false
      }));
      
      logger.info(`✅ Marked ${vulnerableDependencyNames.size} dependencies as vulnerable`);
      logger.info('📊 Vulnerability marking summary:', {
        totalDependencies: dependencyTree.dependencies.length,
        vulnerableDependencies: dependencyTree.dependencies.filter(d => d.isVulnerable).length,
        developmentDependencies: dependencyTree.dependencies.filter(d => d.isDev).length
      });
      
      // Check for major version upgrade requirements
      logger.info('🔍 COMPATIBILITY ANALYSIS - Checking for major version upgrade requirements');
      const majorUpgradeRequirements: MajorUpgradeRequirement[] = [];
      const compatibleSuggestions = [];
      
      // File modification tracking variables
      let filesModified = 0;
      let gradleFilesModified = 0;
      let mavenFilesModified = 0;
      
      if (suggestions.length > 0) {
        const fileParserService = new FileParserService();
        
        // Parse repository files to understand current environment
        const gradleFiles = dependencyTree.packageFiles.filter(f => f.filePath.endsWith('.gradle'));
        const mavenFiles = dependencyTree.packageFiles.filter(f => f.filePath.endsWith('pom.xml'));
        
        // Also include Dockerfiles and version files for Java version detection
        const dockerFiles = dependencyTree.packageFiles.filter(f => 
          f.filePath.toLowerCase().includes('dockerfile') || 
          f.filePath.endsWith('Dockerfile') ||
          f.filePath.endsWith('.Dockerfile')
        );
        const versionFiles = dependencyTree.packageFiles.filter(f => {
          const fileName = f.filePath.split('/').pop() || '';
          return ['.java-version', '.sdkmanrc', '.tool-versions', 'runtime.txt'].includes(fileName);
        });
        
        let parsingResults = [];
        
        const allFilesToParse = [...gradleFiles, ...mavenFiles, ...dockerFiles, ...versionFiles];
        logger.info(`📊 Found files for compatibility analysis: ${allFilesToParse.length} total (${gradleFiles.length} gradle, ${mavenFiles.length} maven, ${dockerFiles.length} docker, ${versionFiles.length} version)`);
        
        for (const file of allFilesToParse) {
          try {
            // Use absolute path by prepending repoPath
            const absoluteFilePath = `${repoPath}/${file.filePath}`;
            const result = await fileParserService.parseFile(absoluteFilePath);
            parsingResults.push(result);
            const fileName = file.filePath.split('/').pop() || file.filePath;
            logger.info(`📄 Parsed ${fileName} for compatibility analysis`);
          } catch (error) {
            const fileName = file.filePath.split('/').pop() || file.filePath;
            logger.warn(`⚠️ Failed to parse ${fileName}:`, error);
          }
        }
        
        if (parsingResults.length > 0) {
          // Check each suggestion for compatibility issues
          for (const suggestion of suggestions) {
            const fix = {
              dependencyName: suggestion.dependencyName,
              currentVersion: suggestion.currentVersion,
              recommendedVersion: suggestion.suggestedVersion,
              cveId: suggestion.fixesVulnerabilities?.[0] || 'Unknown',
              severity: 'medium',
              description: `Compatibility check for ${suggestion.dependencyName}`
            };
            
            const compatibilityIssue = await fileParserService.checkCompatibilityIssues(fix, parsingResults);
            
            if (compatibilityIssue) {
              logger.info(`⚠️ Compatibility issue found for ${suggestion.dependencyName}: ${compatibilityIssue.reason}`);
              majorUpgradeRequirements.push(compatibilityIssue);
            } else {
              compatibleSuggestions.push(suggestion);
            }
          }
        } else {
          logger.warn('⚠️ No build files found for compatibility analysis, keeping all suggestions');
          compatibleSuggestions.push(...suggestions);
        }
        
                          // Step 6: Apply vulnerability fixes using modular orchestrator
         logger.info('🔧 APPLYING VULNERABILITY FIXES TO FILES');
         
         if (compatibleSuggestions.length > 0) {
           try {
             // Import the modular orchestrator
             const { VulnerabilityFixerOrchestrator } = await import('../services/vulnerabilityFixers');
             const orchestrator = new VulnerabilityFixerOrchestrator();
             
             // Apply fixes using modular fixers that reuse existing code
             const fixResult = await orchestrator.applyVulnerabilityFixes(
               parsingResults,
               compatibleSuggestions,
               dependencyTree.dependencies
             );
             
             // Update tracking variables
             filesModified = fixResult.filesModified;
             gradleFilesModified = fixResult.gradleFilesModified;
             mavenFilesModified = fixResult.mavenFilesModified;
             
             // Log any errors from the fixer
             if (fixResult.errors.length > 0) {
               logger.warn(`⚠️ Vulnerability fixer errors:`, fixResult.errors);
             }
             
             // Validate modified files by type
             const validationResult = await orchestrator.validateAllFiles(parsingResults);
             if (!validationResult.allValid) {
               logger.warn(`⚠️ File validation issues:`, validationResult.errors);
             }
             
             // Generate build commands for modified files
             const buildCommands = orchestrator.generateAllBuildCommands(parsingResults);
             if (buildCommands.allCommands.length > 0) {
               logger.info(`🔨 Generated build commands:`, buildCommands.allCommands);
             }
             
           } catch (error) {
             logger.error('❌ Failed to apply vulnerability fixes:', error);
           }
         } else {
           logger.info('📋 No compatible suggestions to apply');
         }
      }
      
      logger.info(`📊 Compatibility Analysis Results:`);
      logger.info(`   Compatible suggestions: ${compatibleSuggestions.length}`);
      logger.info(`   Major upgrade requirements: ${majorUpgradeRequirements.length}`);
      logger.info(`   Files Modified: ${filesModified} (${gradleFilesModified} Gradle, ${mavenFilesModified} Maven)`);
      
      // Transform VulnerabilityMatch objects to expected frontend format
      const transformedVulnerabilities = vulnerabilityMatches.map(match => {
        // Extract clean vulnerability info from JIRA ticket
        const wizFinding = match.jiraTicket?.wizFindings?.[0];
        
        // Extract clean CVE ID as title
        let cleanTitle = match.vulnerability.cveId || wizFinding?.cveIds?.[0];
        if (!cleanTitle || cleanTitle === match.vulnerability.id) {
          // Try to extract CVE from title or description
          const cveMatch = (match.vulnerability.title + ' ' + match.vulnerability.description).match(/CVE-\d{4}-\d{4,}/);
          cleanTitle = cveMatch?.[0] || match.vulnerability.title || match.vulnerability.id;
        }
        
        // Clean up the description - extract key information
        const rawDescription = match.vulnerability.description || wizFinding?.description || '';
        let cleanDescription = rawDescription;
        
        // Extract component information from description if available
        const componentMatch = rawDescription.match(/Component:\s*([^\n\r]+)/i);
        const component = componentMatch?.[1]?.trim();
        
        if (component) {
          cleanDescription = `Component: ${component}`;
          // Add severity and other key info
          if (match.vulnerability.severity) {
            cleanDescription += `\nSeverity: ${match.vulnerability.severity}`;
          }
        } else {
          // Fallback to original description
          cleanDescription = match.vulnerability.description || match.vulnerability.title || '';
        }
        
        // Extract target version from remediation command or recommended version
        let targetVersion: string | undefined;
        
        // First try to get from recommended actions
        const recommendedVersionAction = wizFinding?.recommendedActions?.find(action => 
          action.includes('Update to version')
        );
        if (recommendedVersionAction) {
          const versionMatch = recommendedVersionAction.match(/Update to version\s+([^\s\n]+)/);
          targetVersion = versionMatch?.[1];
        }
        
        // Fallback to parsing remediation command
        if (!targetVersion) {
          const remediationCommand = wizFinding?.recommendedActions?.find(action => 
            action.includes('mvn versions:use-latest-releases') || action.includes('Recommended Version:')
          );
          const targetVersionMatch = remediationCommand?.match(/Recommended Version:\s*([^\s\n]+)/);
          targetVersion = targetVersionMatch?.[1];
        }

        // Clean up and deduplicate affected dependencies with proper current/target versions
        const cleanedDependencies = match.affectedDependencies
          .map(dep => {
            // Use the ACTUAL repository version as current version (not from JIRA)
            let currentVersion = dep.version;
            
            // If the dependency version has variables, resolve it from the dependency tree
            if (currentVersion.startsWith('${') && currentVersion.endsWith('}')) {
              currentVersion = cleanVersion(dep.version, dep.name, dependencyTree.dependencies);
            }
            
            // Extract target version using enhanced extraction logic
            let targetVersion: string | undefined;
            
            // Use the enhanced extraction function
            targetVersion = extractTargetVersion(wizFinding, dep.name);
            
            // FALLBACK: Try to extract from vulnerability's fixed versions
            if (!targetVersion) {
              const affectedPackage = match.vulnerability.affectedPackages?.find((pkg: any) => 
                pkg.name === dep.name || dep.name.includes(pkg.name)
              );
              if (affectedPackage && affectedPackage.fixedVersions && affectedPackage.fixedVersions.length > 0) {
                targetVersion = affectedPackage.fixedVersions[0];
                logger.info(`✅ Using fixed version from vulnerability data: ${dep.name} -> ${targetVersion}`);
              }
            }
            
            // FINAL FALLBACK: Use 'latest' only if absolutely nothing else is found
            if (!targetVersion) {
              targetVersion = 'latest';
              logger.warn(`⚠️ No specific version found, using 'latest' for ${dep.name}`);
            }
            
            return {
              name: dep.name,
              version: currentVersion, // Use actual repository version as current version
              targetVersion: targetVersion, // Add target version separately
              packageManager: dep.packageManager,
              filePath: dep.filePath || '',
            };
          })
          // Deduplicate by name and package manager
          .filter((dep, index, arr) => 
            arr.findIndex(d => d.name === dep.name && d.packageManager === dep.packageManager) === index
          )
          // Limit to 5 most relevant dependencies
          .slice(0, 5);

        return {
          ...match.vulnerability,
          title: cleanTitle,
          description: cleanDescription,
          targetVersion, // Add target version for PR creation
          affectedDependencies: cleanedDependencies,
          jiraTicket: match.jiraTicket ? {
            key: match.jiraTicket.key,
            summary: match.jiraTicket.summary,
            status: match.jiraTicket.status || 'Unknown',
          } : undefined,
        };
      });
      
      logger.info('Vulnerability matching completed', { 
        matches: vulnerabilityMatches.length,
        transformedVulnerabilities: transformedVulnerabilities.length 
      });

      // Transform false positives for response
      const transformedFalsePositives = falsePositives.map((fp: any) => {
        const fpTicket = tickets.find(t => t.wizFindings?.some((f: any) => f.id === fp.id));
        return {
          ...fp,
          jiraTicket: fpTicket ? {
            key: fpTicket.key,
            summary: fpTicket.summary,
            status: fpTicket.status || 'Open',
          } : undefined,
          reason: 'No matching dependencies found in repository',
          missingPackages: fp.affectedPackages.map((pkg: any) => pkg.name),
        };
      });

      logger.info('🏁 FINAL ANALYSIS RESULTS - Ready for Frontend:');
      logger.info(`📊 Vulnerabilities (matched): ${transformedVulnerabilities.length}`);
      logger.info(`📊 False Positives: ${transformedFalsePositives.length}`);
      logger.info(`📊 Compatible Fix Suggestions: ${compatibleSuggestions.length}`);
      logger.info(`📊 Major Upgrade Requirements: ${majorUpgradeRequirements.length}`);
      logger.info(`📊 Total Security Issues: ${transformedVulnerabilities.length + transformedFalsePositives.length}`);
      
      // Final accounting check
      const totalOriginalTickets = jiraTickets.length;
      const totalFetchedTickets = tickets.length;
      const totalWizFindings = tickets.reduce((sum, t) => sum + (t.wizFindings?.length || 0), 0);
      const totalExtractedVulns = vulnerabilities.length; // After deduplication
      const totalMatchedVulns = transformedVulnerabilities.length;
      const totalFalsePositives = transformedFalsePositives.length;
      
      logger.info('🔍 TICKET-TO-VULNERABILITY ACCOUNTING:');
      logger.info(`📋 Original tickets requested: ${totalOriginalTickets}`);
      logger.info(`📋 Tickets successfully fetched: ${totalFetchedTickets}`);
      logger.info(`📋 WizFindings extracted: ${totalWizFindings}`);
      logger.info(`📋 Vulnerabilities after deduplication: ${totalExtractedVulns}`);
      logger.info(`📋 Vulnerabilities matched to dependencies: ${totalMatchedVulns}`);
      logger.info(`📋 Vulnerabilities marked as false positives: ${totalFalsePositives}`);
      logger.info(`📋 Total shown in frontend: ${totalMatchedVulns + totalFalsePositives}`);
      
      const totalMajorUpgrades = majorUpgradeRequirements.length;
      const totalFrontendItems = totalMatchedVulns + totalFalsePositives + totalMajorUpgrades;
      
      if (totalOriginalTickets !== totalFrontendItems) {
        logger.error(`🚨 MISMATCH DETECTED!`);
        logger.error(`   Expected: ${totalOriginalTickets} tickets should produce vulnerabilities`);
        logger.error(`   Actual: ${totalFrontendItems} items in frontend (${totalMatchedVulns} matched, ${totalFalsePositives} false positives, ${totalMajorUpgrades} major upgrades)`);
        logger.error(`   Missing: ${totalOriginalTickets - totalFrontendItems} vulnerabilities`);
      }

      const response: AnalyzeRepositoryResponse = {
        repositoryId: repository.id,
        repository,
        dependencyTree,
        vulnerabilities: transformedVulnerabilities,
        falsePositives: transformedFalsePositives,
        suggestions: compatibleSuggestions,
        majorUpgradeRequirements,
        analysisId: `analysis-${Date.now()}`,
      };

      logger.info('Analysis completed successfully', {
        repositoryId: repository.id,
        dependenciesFound: dependencyTree.dependencies.length,
        vulnerabilitiesFound: vulnerabilityMatches.length,
        compatibleSuggestionsGenerated: compatibleSuggestions.length,
        majorUpgradeRequirements: majorUpgradeRequirements.length,
      });

      clearTimeout(analysisTimeout);
      
      // Add analysis duration to response
      const analysisDuration = Math.floor((Date.now() - startTime) / 1000);
      logger.info(`✅ Analysis completed successfully in ${analysisDuration} seconds`);
      
      res.json({
        success: true,
        data: {
          ...response,
          analysisDuration,
          timestamp: new Date().toISOString(),
        },
      });

    } finally {
      // Cleanup
      clearInterval(progressInterval);
      
      // Skip cleanup in development environment or when PRESERVE_REPO is set
      const preserveRepo = process.env.PRESERVE_REPO === 'true' || process.env.NODE_ENV === 'development';
      
      if (preserveRepo) {
        logger.info(`🔍 Repository preserved for review at: ${repoPath}`);
        logger.info(`📋 To cleanup manually later, remove: ${repoPath}`);
      } else {
        // Cleanup only the working copy, preserve cache
        try {
          await githubService.cleanupWorkingCopy(repoPath);
          logger.info('Working copy cleaned up successfully (cache preserved)');
        } catch (cleanupError) {
          logger.warn('Failed to cleanup working copy:', cleanupError);
        }
      }
    }

  } catch (error: any) {
    clearTimeout(analysisTimeout);
    logger.error('Repository analysis failed:', error);
    
    // Determine error type for better user feedback
    let errorCode = 'ANALYSIS_FAILED';
    let errorMessage = error.message;
    
    if (error.message?.includes('Repository not found')) {
      errorCode = 'REPOSITORY_NOT_FOUND';
      errorMessage = 'Repository not found or not accessible with provided token';
    } else if (error.message?.includes('JIRA')) {
      errorCode = 'JIRA_CONNECTION_FAILED';
      errorMessage = 'Failed to connect to JIRA or fetch tickets';
    } else if (error.message?.includes('clone')) {
      errorCode = 'REPOSITORY_CLONE_FAILED';
      errorMessage = 'Failed to clone repository. Check repository URL and token permissions';
    }
    
    res.status(500).json({
      success: false,
      error: {
        code: errorCode,
        message: errorMessage,
        timestamp: new Date(),
      },
    });
  }
};

/**
 * GET /api/analysis/health
 * Health check endpoint for debugging connectivity issues
 */
router.get('/health', asyncHandler(async (req: Request, res: Response) => {
  logger.info('Health check requested');
  
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
}));

/**
 * POST /api/analysis/analyze-repository
 * Analyze a repository for security vulnerabilities
 */
router.post('/analyze-repository', asyncHandler(analyzeRepositoryHandler));

/**
 * GET /api/analysis/:analysisId
 * Get analysis results by ID
 */
router.get('/:analysisId', asyncHandler(async (req: Request, res: Response) => {
  const { analysisId } = req.params;

  // In a real implementation, this would fetch from a database
  // For now, return a 404
  res.status(404).json({
    success: false,
    error: {
      code: 'ANALYSIS_NOT_FOUND',
      message: 'Analysis not found',
      timestamp: new Date(),
    },
  });
}));

/**
 * GET /api/analysis
 * List all analyses (with pagination)
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const { page = 1, limit = 10 } = req.query;

  // In a real implementation, this would fetch from a database
  res.json({
    success: true,
    data: {
      analyses: [],
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: 0,
        totalPages: 0,
      },
    },
  });
}));

export default router;