import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { GitHubService } from '../services/github/GitHubService';
import { logger } from '../utils/logger';
import { GitHubConfig } from '../types';
import { v4 as uuidv4 } from 'uuid';

interface FileChange {
  filePath: string;
  dependency: string;
  currentVersion: string;
  targetVersion: string;
}

interface PullRequest {
  id: string;
  repositoryId: string;
  number: number;
  title: string;
  description: string;
  branchName: string;
  status: string;
  fixes: {
    vulnerabilityId: string;
    cveId: string;
    affectedDependencies: any[];
    jiraTicket: string;
  }[];
  jiraTickets: string[];
  filesChanged: FileChange[];
  createdAt: Date;
  updatedAt: Date;
  url?: string; // GitHub PR URL
}

const router = Router();

/**
 * POST /api/pull-requests/create
 * Create pull request with fixes
 */
router.post('/create', asyncHandler(async (req: Request, res: Response) => {
  const { repositoryId, fixes, prTitle, prDescription, createSeparatePRs, githubToken, repositoryUrl } = req.body;

  logger.info('PR creation request received:', {
    repositoryId,
    fixesCount: fixes?.length || 0,
    prTitle,
    createSeparatePRs,
    hasGithubToken: !!githubToken,
    repositoryUrl
  });

  // Validate input
  if (!fixes || !Array.isArray(fixes) || fixes.length === 0) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_FIXES',
        message: 'No fixes provided for PR creation',
      },
    });
  }

  if (!githubToken) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_GITHUB_TOKEN',
        message: 'GitHub token is required for PR creation',
      },
    });
  }

  if (!repositoryUrl) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_REPOSITORY_URL',
        message: 'Repository URL is required for PR creation',
      },
    });
  }

  try {
    // Initialize GitHub service
    const githubConfig: GitHubConfig = { token: githubToken };
    const githubService = new GitHubService(githubConfig);

    // Create pull requests
    const pullRequests: PullRequest[] = [];
    
    if (createSeparatePRs) {
      // Create separate PR for each fix
      for (let i = 0; i < fixes.length; i++) {
        const fix = fixes[i];
        const branchName = `security-fix-${fix.cveId || fix.vulnerabilityId}-${Date.now()}`;
        const fixTitle = `${prTitle} - ${fix.cveId}`;
        
        try {
          logger.info(`Creating PR for ${fix.cveId}...`);
          
          // Create file changes for this fix
          const fileChanges = fix.affectedDependencies.map((dep: any) => {
            // Determine file type based on package manager
            let filePath = 'build.gradle'; // Default for Gradle
            if (dep.packageManager === 'npm' || dep.packageManager === 'yarn') {
              filePath = 'package.json';
            } else if (dep.packageManager === 'maven') {
              filePath = 'pom.xml';
            } else if (dep.packageManager === 'pip') {
              filePath = 'requirements.txt';
            }
            
            return {
              filePath,
              dependency: dep.name,
              currentVersion: dep.currentVersion,
              targetVersion: dep.targetVersion || 'latest',
            };
          });

          // Note: Actual file modification logic is now implemented in GitHubService.createPullRequest()
          // This route provides fallback descriptive PRs for compatibility
          const prDescriptionWithChanges = `${prDescription}

## Changes Made

${fileChanges.map((change: FileChange) => 
  `- Update \`${change.dependency}\` from \`${change.currentVersion}\` to \`${change.targetVersion}\` in \`${change.filePath}\``
).join('\n')}

## JIRA Ticket
- ${fix.jiraTicket}

## Testing
- [ ] Run full test suite
- [ ] Verify no breaking changes
- [ ] Test affected functionality

**Note**: This PR was created automatically by the Security Dependency Management Tool.`;

          const pr = await githubService.createPullRequest(
            repositoryUrl,
            [fix], // Pass the fix as FixSuggestion array
            fixTitle,
            prDescriptionWithChanges,
            branchName
          );

          const pullRequestObj: PullRequest = {
            id: uuidv4(),
            repositoryId: `${repositoryId}`,
            number: pr.number || 0, // Handle potential undefined
            title: fixTitle,
            description: prDescriptionWithChanges,
            branchName,
            status: 'open',
            fixes: [{
              vulnerabilityId: fix.vulnerabilityId,
              cveId: fix.cveId,
              affectedDependencies: fix.affectedDependencies,
              jiraTicket: fix.jiraTicket,
            }],
            jiraTickets: [fix.jiraTicket],
            filesChanged: fileChanges,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          pullRequests.push(pullRequestObj);

          logger.info(`PR created successfully: #${pr.number}`);
        } catch (prError: any) {
          logger.error(`Failed to create PR for ${fix.cveId}:`, prError);
          // Continue with other PRs even if one fails
        }
      }
    } else {
      // Create single PR for all fixes
      const branchName = `security-fixes-${Date.now()}`;
      
      // Use the frontend's generic description directly without adding detailed changes
      // The actual changes will be visible in the PR diff

      try {
        const pr = await githubService.createPullRequest(
          repositoryUrl,
          fixes,
          prTitle,
          prDescription,  // Use frontend's generic description directly
          branchName
        );

        const pullRequestObj: PullRequest = {
          id: uuidv4(),
          repositoryId: `${repositoryId}`,
          number: pr.number || 0, // Handle potential undefined
          title: prTitle,
          description: prDescription,  // Use frontend's generic description
          branchName,
          status: 'open',
          fixes: fixes.map((fix: any) => ({
            vulnerabilityId: fix.vulnerabilityId,
            cveId: fix.cveId,
            affectedDependencies: fix.affectedDependencies,
            jiraTicket: fix.jiraTicket,
          })),
          jiraTickets: [...new Set(fixes.map((fix: any) => fix.jiraTicket))].filter(Boolean),
          filesChanged: [],
          createdAt: new Date(),
          updatedAt: new Date(),
          url: pr.url, // Add the GitHub PR URL
        };

        pullRequests.push(pullRequestObj);
        
      } catch (error: any) {
        logger.error(`❌ Failed to create combined PR:`, error);
        throw new Error(`Failed to create pull request: ${error.message}`);
      }
    }

    if (pullRequests.length === 0) {
      throw new Error('No pull requests were created successfully');
    }

    logger.info('PR creation completed:', {
      pullRequestsCreated: pullRequests.length,
      prNumbers: pullRequests.map(pr => pr.number)
    });

    res.json({
      success: true,
      data: {
        pullRequests,
        message: `Successfully created ${pullRequests.length} pull request(s)`,
        summary: {
          totalFixes: fixes.length,
          totalDependencies: fixes.reduce((acc: number, fix: any) => acc + fix.affectedDependencies.length, 0),
          vulnerabilitiesFixed: fixes.map((fix: any) => fix.cveId).filter(Boolean),
        }
      },
    });
  } catch (error: any) {
    logger.error('PR creation failed:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'PR_CREATION_FAILED',
        message: `Failed to create pull request: ${error.message}`,
      },
    });
  }
}));

/**
 * GET /api/pull-requests
 * List pull requests
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      pullRequests: [],
      message: 'Pull request listing not implemented yet',
    },
  });
}));

export { router as prRoutes }; 