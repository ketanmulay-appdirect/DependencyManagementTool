import React, { useState, useCallback, useMemo } from 'react';
import Head from 'next/head';
import { motion } from 'framer-motion';
import { ShieldCheckIcon, CodeBracketIcon, BugAntIcon, ExclamationTriangleIcon, CheckIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';

import { RepositoryAnalysisForm } from '../components/RepositoryAnalysisForm';
import { VulnerabilityDashboard } from '../components/VulnerabilityDashboard';
import { FalsePositivesTable } from '../components/FalsePositivesTable/FalsePositivesTable';
import { MajorUpgradeRequirementsTable } from '../components/MajorUpgradeRequirements/MajorUpgradeRequirementsTable';
import { DependencyTree } from '../components/DependencyTree/DependencyTree';
import { AnalysisProgress } from '../components/AnalysisProgress';
import { StatsCard } from '../components/StatsCard';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useApiPost, useDocumentTitle, useErrorHandler } from '../hooks';
import type { 
  AnalysisRequest, 
  AnalysisResults, 
  AnalysisProgress as AnalysisProgressType,
  AnalysisSummary
} from '../types';
import type { Vulnerability } from '../types';

// Feature cards data
const FEATURE_CARDS = [
  {
    icon: ShieldCheckIcon,
    title: 'Security Analysis',
    description: 'Automatically detect and analyze security vulnerabilities in your dependencies across multiple package managers.',
    color: 'blue' as const,
  },
  {
    icon: CodeBracketIcon,
    title: 'Multi-Platform Support',
    description: 'Support for npm, yarn, pip, Maven, Gradle, Go modules, and Bundler package managers.',
    color: 'green' as const,
  },
  {
    icon: BugAntIcon,
    title: 'JIRA Integration',
    description: 'Seamlessly integrate with JIRA to track and manage Wiz security findings and recommendations.',
    color: 'purple' as const,
  },
  {
    icon: ExclamationTriangleIcon,
    title: 'Automated Fixes',
    description: 'Generate automated pull requests with security fixes and version updates for vulnerable dependencies.',
    color: 'red' as const,
  },
] as const;

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
    },
  },
};

// Feature card component
const FeatureCard: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  color: 'blue' | 'green' | 'purple' | 'red';
}> = ({ icon: Icon, title, description, color }) => (
  <motion.div
    variants={itemVariants}
    className="card hover:shadow-lg transition-shadow duration-300"
  >
    <div className="flex items-start space-x-4">
      <div className={`
        flex-shrink-0 p-3 rounded-lg
        ${color === 'blue' ? 'bg-blue-100' : ''}
        ${color === 'green' ? 'bg-green-100' : ''}
        ${color === 'purple' ? 'bg-purple-100' : ''}
        ${color === 'red' ? 'bg-red-100' : ''}
      `}>
        <Icon className={`
          h-6 w-6
          ${color === 'blue' ? 'text-blue-600' : ''}
          ${color === 'green' ? 'text-green-600' : ''}
          ${color === 'purple' ? 'text-purple-600' : ''}
          ${color === 'red' ? 'text-red-600' : ''}
        `} />
      </div>
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          {title}
        </h3>
        <p className="text-gray-600 leading-relaxed">
          {description}
        </p>
      </div>
    </div>
  </motion.div>
);

// Main HomePage component
const HomePage: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [analysisResults, setAnalysisResults] = useState<AnalysisResults | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgressType>({
    step: 'idle',
    progress: 0,
    message: 'Ready to analyze',
  });
  const [originalRequest, setOriginalRequest] = useState<AnalysisRequest | null>(null);
  const [isCreatingPR, setIsCreatingPR] = useState(false);

  const { handleError } = useErrorHandler();

  // Set dynamic document title
  useDocumentTitle(
    analysisResults 
      ? `Analysis Complete - ${analysisResults.repository.name}` 
      : 'Security Dependency Management Tool'
  );

  // API hook for analysis
  const {
    post: submitAnalysis,
    loading: isAnalyzing,
    error: analysisError,
    reset: resetAnalysis,
  } = useApiPost<AnalysisRequest, AnalysisResults>('/api/analysis/analyze-repository', {
    timeout: 900000, // 15 minutes for large repositories (matches backend timeout)
    onSuccess: (data) => {
      setAnalysisResults(data);
      setAnalysisProgress({
        step: 'completed',
        progress: 100,
        message: 'Analysis completed successfully!',
      });
      toast.success('Repository analysis completed successfully!');
    },
    onError: (error) => {
      setAnalysisProgress({
        step: 'error',
        progress: 0,
        message: error.message || 'Analysis failed',
      });
      toast.error(error.message || 'Analysis failed. Please try again.');
    },
  });

  // Handle analysis submission
  const handleAnalysisSubmit = useCallback(async (data: AnalysisRequest) => {
    try {
      resetAnalysis();
    setAnalysisResults(null);
      setOriginalRequest(data); // Store the original request for PR creation
      
      // Update progress for better UX
    setAnalysisProgress({ step: 'starting', progress: 10, message: 'Starting analysis...' });

      setTimeout(() => {
      setAnalysisProgress({ step: 'cloning', progress: 25, message: 'Cloning repository and scanning packages...' });
      }, 500);
      
      setTimeout(() => {
      setAnalysisProgress({ step: 'jira', progress: 50, message: 'Fetching JIRA tickets and Wiz findings...' });
      }, 1500);
      
      setTimeout(() => {
      setAnalysisProgress({ step: 'analyzing', progress: 75, message: 'Analyzing dependencies and vulnerabilities...' });
      }, 2500);

      await submitAnalysis(data);
    } catch (error) {
      // Handle API errors with detailed messages
      if (error && typeof error === 'object' && 'message' in error) {
        const apiError = error as any;
        
        // For specific error codes, show detailed information
        if (apiError.code === 'UNRESOLVED_DEPENDENCY_VERSIONS') {
          const details = apiError.details || {};
          const unresolvedCount = details.unresolvedCount || 0;
          const totalDeps = details.totalDependencies || 0;
          const percentage = Math.round((unresolvedCount / totalDeps) * 100) || 0;
          
          const errorMessage = `Dependency Resolution Failed:\n\n` +
            `${unresolvedCount} out of ${totalDeps} dependencies (${percentage}%) have unresolved versions.\n\n` +
            `This usually means Gradle dependency resolution commands failed. ` +
            `Check that your repository has a working gradlew file and builds successfully.\n\n` +
            `Examples of unresolved dependencies:\n` +
            (details.unresolvedSamples?.slice(0, 3).map((dep: any) => 
              `• ${dep.name}: ${dep.version} (${dep.packageManager})`
            ).join('\n') || 'No samples available');
          
          toast.error(errorMessage, {
            duration: 8000,
            style: {
              maxWidth: '600px',
              whiteSpace: 'pre-line'
            }
          });
          return;
        } else if (apiError.code === 'NO_DEPENDENCIES_FOUND') {
          toast.error(
            `No Dependencies Found:\n\n${apiError.message}\n\nPlease verify your repository contains valid package files.`,
            {
              duration: 6000,
              style: {
                maxWidth: '500px',
                whiteSpace: 'pre-line'
              }
            }
          );
          return;
        }
        
        // For other API errors, show the detailed message
        const detailedMessage = apiError.message || 'Analysis failed';
        toast.error(detailedMessage, { duration: 5000 });
      } else {
        // Fallback for unknown errors
        handleError(error instanceof Error ? error : new Error('Analysis failed'));
      }
    }
  }, [submitAnalysis, resetAnalysis, handleError]);

  // Handle PR creation with selected vulnerabilities
  const handleCreatePR = useCallback(async (selectedVulnIds: string[]): Promise<{ url: string; number: string; title: string } | null> => {
    if (!analysisResults || !originalRequest) return null;
    
    setIsCreatingPR(true);
    
    try {
      // Extract recommended version helper function
      const extractRecommendedVersion = (vulnerability: Vulnerability): string => {
        console.log('🔍 Extracting version for vulnerability:', vulnerability.id, vulnerability.cveId);
        
        // First try to get version from JIRA recommendedActions (if it exists)
        const jiraTicket = vulnerability.jiraTicket as any; // Type assertion for now
        if (jiraTicket && jiraTicket.wizFindings && Array.isArray(jiraTicket.wizFindings)) {
          console.log('📋 Checking wizFindings:', jiraTicket.wizFindings.length, 'findings');
          for (const finding of jiraTicket.wizFindings) {
            if (finding.recommendedActions && finding.recommendedActions.length > 0) {
              console.log('🎯 Found recommendedActions:', finding.recommendedActions);
              for (const action of finding.recommendedActions) {
                const versionMatch = action.match(/(?:to|→|->)\s*(?:version\s*)?([0-9]+(?:\.[0-9]+)*(?:\.[0-9]+)*(?:-[a-zA-Z0-9]+)?)/i);
                if (versionMatch && versionMatch[1]) {
                  console.log('✅ Extracted version from recommendedActions:', versionMatch[1]);
                  return versionMatch[1];
                }
              }
            }
          }
        }
        
        // Try to get from affectedDependencies targetVersion
        if (vulnerability.affectedDependencies && vulnerability.affectedDependencies.length > 0) {
          for (const dep of vulnerability.affectedDependencies) {
            if (dep.targetVersion && dep.targetVersion !== 'latest' && dep.targetVersion !== 'unknown') {
              console.log('✅ Found targetVersion in affectedDependencies:', dep.targetVersion);
              return dep.targetVersion;
            }
          }
        }
        
        // Fallback to description parsing
        if (vulnerability.description) {
          console.log('🔍 Checking description for version info');
          // Try multiple patterns
          const patterns = [
            /(?:to|→|->)\s*(?:version\s*)?([0-9]+(?:\.[0-9]+)*(?:\.[0-9]+)*(?:-[a-zA-Z0-9]+)?)/i,
            /version\s*:?\s*([0-9]+(?:\.[0-9]+)*(?:\.[0-9]+)*(?:-[a-zA-Z0-9]+)?)/i,
            /update\s+to\s+([0-9]+(?:\.[0-9]+)*(?:\.[0-9]+)*(?:-[a-zA-Z0-9]+)?)/i,
            /([0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9]+)?)/
          ];
          
          for (const pattern of patterns) {
            const versionMatch = vulnerability.description.match(pattern);
            if (versionMatch && versionMatch[1]) {
              console.log('✅ Extracted version from description:', versionMatch[1]);
              return versionMatch[1];
            }
          }
        }
        
        // Try JIRA ticket summary
        if (jiraTicket && jiraTicket.summary) {
          console.log('🔍 Checking JIRA summary for version info');
          const versionMatch = jiraTicket.summary.match(/([0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9]+)?)/);
          if (versionMatch && versionMatch[1]) {
            console.log('✅ Extracted version from JIRA summary:', versionMatch[1]);
            return versionMatch[1];
          }
        }
        
        console.log('❌ No version found, using latest');
        return 'latest';
      };

      // Collect detailed fix information for selected vulnerabilities
      const selectedFixes = selectedVulnIds
        .map(vulnId => {
          const vuln = analysisResults.vulnerabilities.find(v => v.id === vulnId);
          if (!vuln) return null;
          
          return {
            vulnerabilityId: vuln.id,
            cveId: vuln.cveId,
            jiraTicket: vuln.jiraTicket?.key,
            affectedDependencies: vuln.affectedDependencies?.map(dep => {
              const recommendedVersion = extractRecommendedVersion(vuln);
              return {
                name: dep.name,
                currentVersion: dep.version,
                targetVersion: recommendedVersion, // Extract actual version instead of 'latest'
                packageManager: dep.packageManager,
                filePath: dep.filePath,
              };
            }) || [],
          };
        })
        .filter((fix): fix is NonNullable<typeof fix> => fix !== null);

      // Create detailed PR description
      const prDescription = `# Security Vulnerability Fixes

This PR addresses ${selectedVulnIds.length} security vulnerabilities identified by Wiz Security:

${selectedFixes.map(fix => `
## ${fix.cveId || fix.vulnerabilityId}
- **JIRA Ticket**: ${fix.jiraTicket}
- **Affected Dependencies**: ${fix.affectedDependencies.map(dep => dep.name).join(', ')}
- **Security Fix**: Versions will be updated to secure, compatible versions based on project constraints
`).join('\n')}

## Automated Security Updates
This PR automatically applies security fixes while maintaining compatibility with your project's Java version and existing dependencies. Specific version selections are optimized for:
- Security vulnerability remediation
- Java version compatibility  
- Minimal breaking changes
- Latest stable versions within compatible ranges

## Testing Recommendations
- Run full test suite before merging
- Verify no breaking changes in affected functionality
- Check for any deprecated API usage

## References
${selectedFixes.map(fix => 
  fix.jiraTicket ? `- [${fix.jiraTicket}](https://appdirect.jira.com/browse/${fix.jiraTicket})` : ''
).filter(Boolean).join('\n')}
`;

      // Validate required parameters for PR creation
      if (!originalRequest.githubToken) {
        toast.error('❌ GitHub token is required for PR creation. Please re-run the analysis with a valid GitHub token.');
        return null;
      }

      if (!originalRequest.repositoryUrl) {
        toast.error('❌ Repository URL is required for PR creation. Please re-run the analysis.');
        return null;
      }

      const response = await fetch('/api/pull-requests/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repositoryId: analysisResults.repositoryId,
          repositoryUrl: originalRequest.repositoryUrl,
          githubToken: originalRequest.githubToken,
          fixes: selectedFixes,
          prTitle: `Security Fix: Address ${selectedVulnIds.length} vulnerabilities`,
          prDescription: prDescription,
          createSeparatePRs: false,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        console.log('PR creation result:', result); // Debug log
        
        if (result.success && result.data.pullRequests && result.data.pullRequests.length > 0) {
          const firstPR = result.data.pullRequests[0];
          
          // Create proper PR URL if missing
          const prUrl = firstPR.url || `https://github.com/${originalRequest.repositoryUrl?.split('/').slice(-2).join('/')}/pull/${firstPR.number}`;
          const prNumber = firstPR.number || 'Unknown';
          const prTitle = firstPR.title || `Security Fix: Address ${selectedVulnIds.length} vulnerabilities`;
          
          // Toast with proper null checking
          const message = result.data.message || 'Pull request created successfully';
          toast.success(`✅ ${message}\n\nPR #${prNumber}: ${prUrl}`);
          
          return {
            url: prUrl,
            number: prNumber.toString(),
            title: prTitle
          };
        } else {
          const message = result.data?.message || result.message || 'Pull request process completed successfully';
          toast.success(`✅ ${message}`);
          return null;
        }
      } else {
        const error = await response.json();
        const errorMessage = error.error?.message || error.message || 'Unknown error occurred';
        toast.error(`❌ Failed to create pull request: ${errorMessage}`);
        return null;
      }
    } catch (error) {
      console.error('Error creating PR:', error);
      toast.error('❌ Failed to create pull request. Please try again.');
      return null;
    } finally {
      setIsCreatingPR(false);
    }
  }, [analysisResults, originalRequest, toast]);

  // Handle analysis reset
  const handleAnalysisReset = useCallback(() => {
    setAnalysisResults(null);
    setOriginalRequest(null);
    setAnalysisProgress({
      step: 'idle',
      progress: 0,
      message: 'Ready to analyze',
    });
    resetAnalysis();
  }, [resetAnalysis]);

  // Calculate summary statistics
  const analysisSummary = useMemo((): AnalysisSummary | null => {
    if (!analysisResults) return null;

    const { dependencyTree, vulnerabilities = [], suggestions = [] } = analysisResults;

    // Defensive programming - ensure arrays exist
    const dependencies = dependencyTree?.dependencies || [];
    const packageFiles = dependencyTree?.packageFiles || [];
    const vulns = Array.isArray(vulnerabilities) ? vulnerabilities : [];
    const sug = Array.isArray(suggestions) ? suggestions : [];

    return {
      totalDependencies: dependencies.length,
      vulnerableDependencies: dependencies.filter(d => d?.isVulnerable).length,
      criticalVulnerabilities: vulns.filter(v => v?.severity === 'critical').length,
      highVulnerabilities: vulns.filter(v => v?.severity === 'high').length,
      fixableSuggestions: sug.length,
      packageFiles: packageFiles.length,
      directDependencies: dependencies.filter(d => d?.type === 'direct').length,
      transitiveDependencies: dependencies.filter(d => d?.type === 'transitive').length,
    };
  }, [analysisResults]);

  return (
    <>
      <Head>
        <title>Security Dependency Management Tool</title>
        <meta 
          name="description" 
          content="Analyze and fix security vulnerabilities in your dependencies with automated JIRA integration and pull request generation" 
        />
      </Head>

      <div className="min-h-screen">
        {/* Header */}
        <header className="bg-white shadow-sm border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center">
                <ShieldCheckIcon className="h-8 w-8 text-primary-600" aria-hidden="true" />
                <h1 className="ml-3 text-xl font-bold text-gray-900">
                  Security Dependency Tool
                </h1>
              </div>
              
              {analysisResults && (
                <button
                  type="button"
                  onClick={handleAnalysisReset}
                  className="button-secondary"
                  aria-label="Analyze another repository"
                >
                  Analyze Another
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {!analysisResults ? (
            <div className="space-y-8">
              {/* Analysis Form */}
              <ErrorBoundary>
                <section aria-labelledby="analysis-form-heading">
                  <h2 id="analysis-form-heading" className="sr-only">
                    Repository Analysis Form
            </h2>
              <RepositoryAnalysisForm
                onSubmit={handleAnalysisSubmit}
                isLoading={isAnalyzing}
              />
                </section>
              </ErrorBoundary>

              {/* Progress Indicator */}
              {isAnalyzing && (
                <ErrorBoundary>
                  <section aria-labelledby="analysis-progress-heading">
                    <h2 id="analysis-progress-heading" className="sr-only">
                      Analysis Progress
                    </h2>
                    <AnalysisProgress {...analysisProgress} />
                  </section>
                </ErrorBoundary>
              )}

          {isAnalyzing && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
                  className="bg-white rounded-lg border border-gray-200 p-8 shadow-sm"
                >
                  <div className="flex items-center justify-center space-x-4">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                    <div className="text-center">
                      <p className="text-lg font-medium text-gray-900">Analyzing Repository</p>
                      <p className="text-sm text-gray-600 mt-1">
                        This may take a few minutes...
                      </p>
                      
                      {/* Progress Steps */}
                      <div className="mt-6 space-y-3">
                        <div className="flex items-center space-x-3 text-sm">
                          <div className="flex-shrink-0 w-4 h-4 bg-green-500 rounded-full flex items-center justify-center">
                            <CheckIcon className="w-2.5 h-2.5 text-white" />
                          </div>
                          <span className="text-gray-700">Repository cloned successfully</span>
                        </div>
                        
                        <div className="flex items-center space-x-3 text-sm">
                          <div className="flex-shrink-0 w-4 h-4 bg-blue-500 rounded-full animate-pulse"></div>
                          <span className="text-gray-700">Finding package files (build.gradle, pom.xml, package.json)</span>
                        </div>
                        
                        <div className="flex items-center space-x-3 text-sm">
                          <div className="flex-shrink-0 w-4 h-4 bg-gray-300 rounded-full"></div>
                          <span className="text-gray-500">Running Gradle dependency resolution commands</span>
                        </div>
                        
                        <div className="flex items-center space-x-3 text-sm">
                          <div className="flex-shrink-0 w-4 h-4 bg-gray-300 rounded-full"></div>
                          <span className="text-gray-500">Parsing dependency tree with resolved versions</span>
                        </div>
                        
                        <div className="flex items-center space-x-3 text-sm">
                          <div className="flex-shrink-0 w-4 h-4 bg-gray-300 rounded-full"></div>
                          <span className="text-gray-500">Fetching JIRA tickets and vulnerability data</span>
                        </div>
                        
                        <div className="flex items-center space-x-3 text-sm">
                          <div className="flex-shrink-0 w-4 h-4 bg-gray-300 rounded-full"></div>
                          <span className="text-gray-500">Matching vulnerabilities against dependencies</span>
                        </div>
                      </div>
                      
                      {/* Progress Bar */}
                      <div className="mt-6">
                        <div className="bg-gray-200 rounded-full h-2">
                          <div 
                            className="bg-blue-600 h-2 rounded-full transition-all duration-1000 ease-out"
                            style={{ width: '25%' }}
                          ></div>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                          Step 2 of 6: Building dependency tree...
                        </p>
                      </div>
                    </div>
                  </div>
            </motion.div>
          )}

              {/* Error Display */}
              {analysisError && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
                  className="card border-red-200 bg-red-50"
                  role="alert"
                  aria-live="polite"
            >
                  <div className="flex items-start">
                    <ExclamationTriangleIcon className="h-5 w-5 text-red-600 mt-0.5 mr-3 flex-shrink-0" />
                  <div>
                      <h3 className="text-sm font-medium text-red-800 mb-1">
                        Analysis Failed
                    </h3>
                      <p className="text-sm text-red-700">
                        {analysisError.message}
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Feature Cards */}
              {!isAnalyzing && !analysisError && (
                <section aria-labelledby="features-heading">
                  <h2 id="features-heading" className="sr-only">
                    Tool Features
                  </h2>
                  <motion.div
                    variants={containerVariants}
                    initial="hidden"
                    animate="visible"
                    className="grid grid-cols-1 md:grid-cols-2 gap-6"
                  >
                    {FEATURE_CARDS.map((feature) => (
                      <FeatureCard key={feature.title} {...feature} />
                    ))}
                  </motion.div>
                </section>
              )}
            </div>
          ) : (
            <div className="space-y-8">
              {/* Repository Information */}
              <ErrorBoundary>
                <section aria-labelledby="repository-info-heading">
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="card"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 id="repository-info-heading" className="text-lg font-semibold text-gray-900">
                          {analysisResults.repository.fullName}
                        </h2>
                        <p className="text-sm text-gray-500 mt-1">
                          {analysisResults.repository.description || 'No description available'}
                        </p>
                        <div className="flex items-center mt-2 space-x-4 text-sm text-gray-500">
                          <span>{analysisResults.repository.language}</span>
                          <span>•</span>
                      <a
                        href={analysisResults.repository.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary-600 hover:text-primary-700"
                      >
                        View on GitHub
                      </a>
                    </div>
                  </div>
                </div>
                  </motion.div>
                </section>
              </ErrorBoundary>

              {/* Statistics Cards */}
              {analysisSummary && (
                <ErrorBoundary>
                  <section aria-labelledby="statistics-heading">
                    <h2 id="statistics-heading" className="sr-only">
                      Analysis Statistics
                    </h2>
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 }}
                      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6"
                    >
                  <StatsCard
                    title="Dependencies"
                        value={analysisSummary.totalDependencies}
                    icon={CodeBracketIcon}
                    color="blue"
                        subtitle={`${analysisSummary.directDependencies} direct, ${analysisSummary.transitiveDependencies} transitive`}
                        tooltip="Total number of dependencies found in your repository. Direct dependencies are explicitly declared in your package files (package.json, build.gradle, etc.), while transitive dependencies are dependencies of your dependencies that are automatically included."
                  />
                  <StatsCard
                    title="Vulnerabilities"
                        value={analysisResults.vulnerabilities?.length || 0}
                    icon={BugAntIcon}
                    color="red"
                        subtitle={`${analysisSummary.criticalVulnerabilities} critical, ${analysisSummary.highVulnerabilities} high`}
                        tooltip="Security vulnerabilities discovered in your dependencies based on JIRA tickets from Wiz Security. These represent known security issues that could potentially affect your application and should be addressed according to their severity level."
                  />
                  <StatsCard
                    title="Fix Suggestions"
                        value={analysisSummary.fixableSuggestions}
                    icon={ShieldCheckIcon}
                    color="green"
                        subtitle="Automated fixes available"
                        tooltip="Number of automated fix suggestions generated for your vulnerabilities. These suggestions include specific version updates and can be used to create pull requests that resolve security issues in your dependencies."
                  />
                  <StatsCard
                        title="False Positives"
                        value={analysisResults.falsePositives?.length || 0}
                    icon={ExclamationTriangleIcon}
                        color="orange"
                        subtitle="VM tickets not affecting this repo"
                        tooltip="Vulnerability Management (VM) tickets from JIRA that don't actually affect this repository. These occur when tickets reference dependencies that aren't found in your codebase, often due to different package names or ecosystems."
                      />
                    </motion.div>
                  </section>
                </ErrorBoundary>
              )}

              {/* Vulnerability Table */}
              <ErrorBoundary>
                <section aria-labelledby="vulnerabilities-heading">
                  <VulnerabilityDashboard
                    vulnerabilities={analysisResults.vulnerabilities || []}
                    suggestions={analysisResults.suggestions || []}
                    repositoryId={analysisResults.repositoryId}
                    repositoryUrl={originalRequest?.repositoryUrl}
                    githubToken={originalRequest?.githubToken}
                    onCreatePR={handleCreatePR}
                  />
                </section>
              </ErrorBoundary>

              {/* Major Upgrade Requirements */}
              <ErrorBoundary>
                <MajorUpgradeRequirementsTable
                  requirements={analysisResults.majorUpgradeRequirements || []}
                />
              </ErrorBoundary>

              {/* False Positives Table */}
              <ErrorBoundary>
                <section aria-labelledby="false-positives-heading">
                  <h2 id="false-positives-heading" className="text-xl font-semibold text-gray-900 mb-6">
                    False Positives Analysis
                  </h2>
                  <FalsePositivesTable
                    falsePositives={analysisResults.falsePositives || []}
                  />
                </section>
              </ErrorBoundary>

              {/* Dependency Tree */}
              <ErrorBoundary>
                <section aria-labelledby="dependencies-heading">
                  <h2 id="dependencies-heading" className="text-xl font-semibold text-gray-900 mb-6">
                  Dependency Tree
                  </h2>
                <DependencyTree
                    dependencies={analysisResults.dependencyTree?.dependencies || []}
                    packageFiles={analysisResults.dependencyTree?.packageFiles || []}
                  />
                </section>
              </ErrorBoundary>
              </div>
          )}
        </main>
      </div>
    </>
  );
};

export default HomePage; 