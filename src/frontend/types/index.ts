// Core API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
  timestamp: string;
  details?: Record<string, any>;
}

// Repository & Analysis Types
export interface Repository {
  id: string;
  name: string;
  fullName: string;
  url: string;
  language: string;
  description?: string;
  owner: {
    login: string;
    avatarUrl?: string;
  };
  isPrivate: boolean;
  defaultBranch: string;
  createdAt: string;
  updatedAt: string;
}

export interface Dependency {
  name: string;
  version: string;
  targetVersion?: string; // Recommended/target version for security fixes
  type: 'direct' | 'transitive';
  packageManager: PackageManager;
  filePath: string;
  isDev: boolean;
  isVulnerable?: boolean;
  vulnerabilities?: string[];
}

export interface DependencyTree {
  repositoryId: string;
  dependencies: Dependency[];
  packageFiles: PackageFile[];
  generatedAt: string;
  stats: DependencyStats;
}

export interface DependencyStats {
  total: number;
  direct: number;
  transitive: number;
  vulnerable: number;
  dev: number;
  prod: number;
}

export interface PackageFile {
  filePath: string;
  packageManager: PackageManager;
  dependencies: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export type PackageManager = 'npm' | 'yarn' | 'pip' | 'poetry' | 'maven' | 'gradle' | 'go' | 'bundler';

// Vulnerability Types
export interface Vulnerability {
  id: string;
  cveId?: string;
  title: string;
  description: string;
  severity: VulnerabilitySeverity;
  publishedAt: string;
  updatedAt: string;
  affectedPackages: AffectedPackage[];
  affectedDependencies: Dependency[];
  jiraTicket?: JiraTicketSummary;
  references?: VulnerabilityReference[];
}

export interface AffectedPackage {
  name: string;
  ecosystem: PackageManager;
  affectedVersions: string[];
  fixedVersions: string[];
}

export interface VulnerabilityReference {
  type: 'advisory' | 'article' | 'report' | 'fix';
  url: string;
  title?: string;
}

export type VulnerabilitySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

// JIRA Integration Types
export interface JiraTicketSummary {
  key: string;
  summary: string;
  status: string;
  priority?: string;
  assignee?: string;
  url?: string;
}

export interface JiraTicket extends JiraTicketSummary {
  description: string;
  created: string;
  updated: string;
  reporter: string;
  labels: string[];
  wizFindings: WizFinding[];
}

export interface WizFinding {
  id: string;
  title: string;
  description: string;
  severity: VulnerabilitySeverity;
  category: string;
  cveIds: string[];
  affectedPackages: string[];
  recommendedActions: string[];
  detectionDate: string;
  resourceInfo?: {
    type: string;
    name: string;
    region?: string;
  };
}

// Fix Suggestion Types
export interface FixSuggestion {
  id: string;
  dependencyName: string;
  currentVersion: string;
  suggestedVersion: string;
  updateType: UpdateType;
  confidence: number;
  fixesVulnerabilities: string[];
  testingRequired: boolean;
  estimatedEffort: EffortLevel;
  breakingChanges: BreakingChange[];
  migrationNotes?: string;
  automationAvailable: boolean;
}

export type UpdateType = 'patch' | 'minor' | 'major' | 'alternative';
export type EffortLevel = 'low' | 'medium' | 'high';

export interface BreakingChange {
  type: 'api' | 'config' | 'dependency' | 'behavior';
  description: string;
  mitigation: string;
  impact: 'low' | 'medium' | 'high';
}

// False Positive Types
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

// Analysis Types
export interface AnalysisRequest {
  repositoryUrl: string;
  jiraTickets: string[];
  githubToken: string;
  jiraToken: string;
  jiraEmail: string;
  jiraBaseUrl: string;
}

export interface AnalysisResults {
  repositoryId: string;
  repository: Repository;
  dependencyTree: DependencyTree;
  vulnerabilities: Vulnerability[];
  falsePositives: FalsePositive[];
  suggestions: FixSuggestion[];
  majorUpgradeRequirements: MajorUpgradeRequirement[];
  analysisId: string;
  completedAt: string;
  summary: AnalysisSummary;
}

export interface AnalysisSummary {
  totalDependencies: number;
  vulnerableDependencies: number;
  criticalVulnerabilities: number;
  highVulnerabilities: number;
  fixableSuggestions: number;
  packageFiles: number;
  directDependencies: number;
  transitiveDependencies: number;
}

export interface AnalysisProgress {
  step: AnalysisStep;
  progress: number;
  message: string;
  estimatedTimeRemaining?: number;
  currentOperation?: string;
}

export type AnalysisStep = 'idle' | 'starting' | 'cloning' | 'scanning' | 'jira' | 'analyzing' | 'matching' | 'suggestions' | 'completed' | 'error';

// UI State Types
export interface LoadingState {
  isLoading: boolean;
  message?: string;
  progress?: number;
}

export interface ErrorState {
  hasError: boolean;
  error?: Error | ApiError;
  errorBoundary?: boolean;
}

// Form Types
export interface FormFieldError {
  message: string;
  type: string;
}

export interface FormState<T = any> {
  data: T;
  errors: Record<keyof T, FormFieldError | undefined>;
  isValid: boolean;
  isDirty: boolean;
  isSubmitting: boolean;
}

// Table & Filter Types
export interface TableColumn<T = any> {
  key: keyof T;
  label: string;
  sortable?: boolean;
  width?: string;
  align?: 'left' | 'center' | 'right';
  render?: (value: any, row: T) => React.ReactNode;
}

export interface SortConfig {
  field: string;
  direction: 'asc' | 'desc';
}

export interface FilterConfig {
  field: string;
  value: any;
  operator: 'equals' | 'contains' | 'greater' | 'less' | 'in';
}

// Component Props Types
export interface BaseComponentProps {
  className?: string;
  children?: React.ReactNode;
  'data-testid'?: string;
}

export interface IconProps {
  className?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  'aria-hidden'?: boolean;
}

// Modal & Dialog Types
export interface ModalProps extends BaseComponentProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  closeOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
}

// Notification Types
export interface NotificationOptions {
  type: 'success' | 'error' | 'warning' | 'info';
  title?: string;
  message: string;
  duration?: number;
  persistent?: boolean;
  actions?: NotificationAction[];
}

export interface NotificationAction {
  label: string;
  action: () => void;
  style?: 'primary' | 'secondary';
}

// Theme & Styling Types
export interface ThemeConfig {
  colors: Record<string, string>;
  spacing: Record<string, string>;
  typography: Record<string, any>;
  breakpoints: Record<string, string>;
}

// Utility Types
export type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// Component Specific Types
export interface BadgeProps extends BaseComponentProps {
  variant?: 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'info';
  size?: 'sm' | 'md' | 'lg';
  showIcon?: boolean;
}

export interface ButtonProps extends BaseComponentProps {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ComponentType<IconProps>;
  iconPosition?: 'left' | 'right';
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  type?: 'button' | 'submit' | 'reset';
  'aria-label'?: string;
}

// Hook Return Types
export interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  refetch: () => Promise<void>;
}

export interface UseLocalStorageResult<T> {
  value: T;
  setValue: (value: T | ((prev: T) => T)) => void;
  removeValue: () => void;
} 