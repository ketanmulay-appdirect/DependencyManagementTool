// Core Types
export interface Repository {
  id: string;
  name: string;
  fullName: string;
  url: string;
  defaultBranch: string;
  language: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Dependency {
  name: string;
  version: string;
  targetVersion?: string; // Recommended/target version for security fixes
  type: 'direct' | 'transitive';
  packageManager: PackageManager;
  filePath: string;
  isDev: boolean;
  parent?: string; // For transitive dependencies
  children?: Dependency[]; // For dependency tree
  comment?: string; // Additional comments for the dependency (e.g., transitive dependency notes)
}

export interface DependencyTree {
  repositoryId: string;
  dependencies: Dependency[];
  packageFiles: PackageFile[];
  generatedAt: Date;
}

export interface PackageFile {
  filePath: string;
  packageManager: PackageManager;
  content: string;
  dependencies: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export type PackageManager = 'npm' | 'yarn' | 'pip' | 'poetry' | 'maven' | 'gradle' | 'go' | 'bundler' | 'docker' | 'version';

// Vulnerability Types
export interface Vulnerability {
  id: string;
  cveId?: string;
  title: string;
  description: string;
  severity: VulnerabilitySeverity;
  affectedPackages: AffectedPackage[];
  fixedIn?: string[];
  publishedAt: Date;
  updatedAt: Date;
  // Additional fields for frontend display
  affectedDependencies?: {
    name: string;
    version: string;
    packageManager: string;
    filePath: string;
  }[];
  jiraTicket?: {
    key: string;
    summary: string;
    status: string;
  };
}

export interface AffectedPackage {
  name: string;
  ecosystem: PackageManager;
  affectedVersions: string[];
  fixedVersions: string[];
}

export type VulnerabilitySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

// JIRA Integration Types
export interface JiraTicket {
  id: string;
  key: string;
  summary: string;
  description: string;
  status: string;
  priority: string;
  assignee?: string;
  reporter: string;
  createdAt: Date;
  updatedAt: Date;
  wizFindings?: WizFinding[];
}

export interface WizFinding {
  id: string;
  title: string;
  description: string;
  severity: VulnerabilitySeverity;
  category: string;
  resourceType: string;
  resourceName: string;
  cveIds: string[];
  affectedPackages: string[];
  recommendedActions: string[];
  detectionDate: Date;
}

// Fix Suggestion Types
export interface FixSuggestion {
  id: string;
  dependencyName: string;
  currentVersion: string;
  suggestedVersion: string;
  updateType: UpdateType;
  fixesVulnerabilities: string[]; // CVE IDs
  breakingChanges: BreakingChange[];
  migrationNotes?: string;
  confidence: number; // 0-1 scale
  testingRequired: boolean;
}

export type UpdateType = 'patch' | 'minor' | 'major' | 'alternative';

export interface BreakingChange {
  type: 'api' | 'behavior' | 'dependency';
  description: string;
  mitigation?: string;
}

// Pull Request Types
export interface PullRequest {
  id: string;
  repositoryId: string;
  number?: number;
  title: string;
  description: string;
  branchName: string;
  status: PRStatus;
  fixes: FixSuggestion[];
  jiraTickets: string[];
  filesChanged: FileChange[];
  createdAt: Date;
  updatedAt: Date;
  mergedAt?: Date;
  url?: string; // GitHub PR URL
}

export type PRStatus = 'draft' | 'open' | 'merged' | 'closed' | 'error';

export interface FileChange {
  filePath: string;
  changeType: 'modified' | 'added' | 'deleted';
  content: string;
  diff?: string;
}

// API Request/Response Types
export interface AnalyzeRepositoryRequest {
  repositoryUrl: string;
  jiraTickets: string[];
  githubToken: string;
  jiraToken: string;
  jiraEmail: string;
  jiraBaseUrl: string;
}

export interface FalsePositive {
  id: string;
  cveId?: string;
  title: string;
  description: string;
  severity: VulnerabilitySeverity;
  publishedAt: string;
  updatedAt: string;
  affectedPackages: AffectedPackage[];
  jiraTicket?: JiraTicketSummary;
  reason: string;
  missingPackages: string[];
}

// Major Upgrade Requirements - for dependencies that require Java/framework version upgrades
export interface MajorUpgradeRequirement {
  id: string;
  dependencyName: string;
  currentVersion: string;
  recommendedVersion: string;
  cveIds: string[];
  jiraTickets: string[];
  reason: string;
  requiredUpgrades: RequiredUpgrade[];
  packageManager: PackageManager;
  filePath: string;
  severity: VulnerabilitySeverity;
}

export interface RequiredUpgrade {
  type: 'java' | 'spring-boot' | 'framework';
  current: string;
  required: string;
  description: string;
}

export interface AnalyzeRepositoryResponse {
  repositoryId: string;
  repository: Repository;
  dependencyTree: DependencyTree;
  vulnerabilities: Vulnerability[];
  falsePositives: FalsePositive[];
  suggestions: FixSuggestion[];
  majorUpgradeRequirements: MajorUpgradeRequirement[];
  analysisId: string;
}

export interface VulnerabilityMatch {
  vulnerability: Vulnerability;
  affectedDependencies: Dependency[];
  jiraTicket?: JiraTicket;
  fixSuggestions: FixSuggestion[];
}

export interface CreatePullRequestRequest {
  repositoryId: string;
  selectedFixes: string[]; // Fix suggestion IDs
  prTitle?: string;
  prDescription?: string;
  createSeparatePRs: boolean;
}

export interface CreatePullRequestResponse {
  pullRequests: PullRequest[];
  success: boolean;
  errors?: string[];
}

// Analysis Types
export interface AnalysisResult {
  id: string;
  repositoryId: string;
  status: AnalysisStatus;
  startedAt: Date;
  completedAt?: Date;
  errors?: string[];
  results?: AnalyzeRepositoryResponse;
}

export type AnalysisStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

// Configuration Types
export interface GitHubConfig {
  token: string;
  appId?: string;
  privateKey?: string;
}

export interface JiraConfig {
  baseUrl: string;
  email: string;
  token: string;
  projectKey: string;
}

export interface JiraTicketSummary {
  key: string;
  summary: string;
  status: string;
  priority?: string;
  assignee?: string;
  url?: string;
}

export interface WizConfig {
  apiUrl: string;
  token: string;
}

// User Management Types (for future authentication)
export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
}

export type UserRole = 'admin' | 'manager' | 'developer' | 'viewer';

export interface Organization {
  id: string;
  name: string;
  repositories: string[];
  settings: OrganizationSettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationSettings {
  autoScan: boolean;
  scanFrequency: string; // cron expression
  notificationSettings: NotificationSettings;
  securityPolicies: SecurityPolicy[];
}

export interface NotificationSettings {
  email: boolean;
  slack: boolean;
  webhookUrl?: string;
  channels: NotificationChannel[];
}

export interface NotificationChannel {
  type: 'email' | 'slack' | 'webhook';
  config: Record<string, any>;
  enabled: boolean;
}

export interface SecurityPolicy {
  id: string;
  name: string;
  description: string;
  rules: SecurityRule[];
  enabled: boolean;
}

export interface SecurityRule {
  type: 'severity_threshold' | 'license_restriction' | 'package_blacklist';
  config: Record<string, any>;
  action: 'block' | 'warn' | 'notify';
}

// Error Types
export interface APIError {
  code: string;
  message: string;
  details?: Record<string, any>;
  timestamp: Date;
}

export interface ValidationError extends APIError {
  field: string;
  value: any;
} 