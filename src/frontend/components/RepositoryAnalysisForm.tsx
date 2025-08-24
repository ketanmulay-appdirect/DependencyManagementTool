import React, { useState, useCallback } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { 
  CodeBracketIcon,
  DocumentTextIcon,
  EyeIcon,
  EyeSlashIcon,
  QuestionMarkCircleIcon,
  InformationCircleIcon
} from '@heroicons/react/24/outline';

import { Input, Textarea, PrimaryButton } from './ui';
import { useErrorHandler } from '../hooks';
import type { AnalysisRequest } from '../types';

// Validation schema
const analysisSchema = z.object({
  repositoryUrl: z.string()
    .min(1, 'Repository URL is required')
    .url('Please enter a valid URL')
    .refine(url => url.includes('github.com'), {
      message: 'URL must be a GitHub repository (github.com)',
    }),
  jiraTickets: z.string()
    .min(1, 'At least one JIRA ticket is required')
    .refine(value => {
      const tickets = value.split(',').map(t => t.trim()).filter(Boolean);
      return tickets.length > 0;
    }, {
      message: 'Please provide at least one valid JIRA ticket',
    }),
  githubToken: z.string()
    .min(1, 'GitHub token is required')
    .min(40, 'GitHub token must be at least 40 characters')
    .regex(/^gh[ps]_[a-zA-Z0-9]{36,}$|^[a-f0-9]{40}$/, {
      message: 'Invalid GitHub token format',
    }),
  jiraEmail: z.string()
    .min(1, 'JIRA email is required')
    .email('Please enter a valid email address'),
  jiraToken: z.string()
    .min(1, 'JIRA token is required')
    .min(16, 'JIRA token must be at least 16 characters'),
  jiraBaseUrl: z.string()
    .min(1, 'JIRA base URL is required')
    .url('Please enter a valid JIRA URL')
    .refine(url => {
      const validPatterns = [
        /atlassian\.net/i,
        /\.jira\./i,
        /jira\./i,
        /\/jira/i,
      ];
      return validPatterns.some(pattern => pattern.test(url));
    }, {
      message: 'Please enter a valid JIRA URL (e.g., https://company.atlassian.net)',
    }),
  useMockData: z.boolean().optional(),
});

// Form data interface
interface AnalysisFormData {
  repositoryUrl: string;
  jiraTickets: string;
  githubToken: string;
  jiraEmail: string;
  jiraToken: string;
  jiraBaseUrl: string;
  useMockData?: boolean;
}

// Component props
interface RepositoryAnalysisFormProps {
  onSubmit: (data: AnalysisRequest) => Promise<void>;
  isLoading: boolean;
}

// Help text content
const HELP_TEXT = {
  repositoryUrl: 'Enter the full GitHub repository URL (e.g., https://github.com/owner/repo)',
  jiraTickets: 'Enter JIRA ticket keys separated by commas (e.g., WIZ-123, WIZ-456)',
  githubToken: 'GitHub Personal Access Token with repository access permissions',
  jiraEmail: 'Your JIRA account email address',
  jiraToken: 'JIRA API token for authentication',
  jiraBaseUrl: 'Your organization\'s JIRA base URL (e.g., https://company.atlassian.net)',
} as const;

// Example values for placeholders
const PLACEHOLDERS = {
  repositoryUrl: 'https://github.com/owner/repository',
  jiraTickets: 'WIZ-123, WIZ-456, VM-789',
  githubToken: 'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  jiraEmail: 'your.email@company.com',
  jiraToken: 'ATATT3xFfGF0...',
  jiraBaseUrl: 'https://your-org.atlassian.net',
} as const;

// Animation variants
const containerVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3 },
  },
};

// Help tooltip component
const HelpTooltip: React.FC<{ content: string }> = ({ content }) => (
  <div className="group relative">
    <QuestionMarkCircleIcon 
      className="h-4 w-4 text-gray-400 hover:text-gray-600 transition-colors cursor-help"
      aria-hidden="true"
    />
    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-10 pointer-events-none">
      {content}
      <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-2 h-2 bg-gray-900 rotate-45 -mt-1"></div>
    </div>
  </div>
);

// Security notice component
const SecurityNotice: React.FC = () => (
  <motion.div
    variants={itemVariants}
    className="bg-blue-50 border border-blue-200 rounded-lg p-4"
    role="region"
    aria-labelledby="security-notice-title"
  >
    <div className="flex items-start">
      <InformationCircleIcon className="h-5 w-5 text-blue-600 mt-0.5 mr-3 flex-shrink-0" />
      <div>
        <h3 id="security-notice-title" className="text-sm font-medium text-blue-800 mb-1">
          Security Notice
        </h3>
        <div className="text-sm text-blue-700 space-y-1">
          <p>Your tokens are processed securely and are not stored permanently.</p>
          <ul className="list-disc list-inside ml-2 space-y-1">
            <li>GitHub tokens should have <code className="bg-blue-100 px-1 rounded">repo</code> scope</li>
            <li>JIRA tokens can be generated in your Atlassian account settings</li>
            <li>All communication is encrypted in transit</li>
          </ul>
        </div>
      </div>
    </div>
  </motion.div>
);

// Main form component
export const RepositoryAnalysisForm: React.FC<RepositoryAnalysisFormProps> = ({
  onSubmit,
  isLoading,
}) => {
  const [showGithubToken, setShowGithubToken] = useState(false);
  const [showJiraToken, setShowJiraToken] = useState(false);
  const { handleError } = useErrorHandler();

  // React Hook Form setup
  const {
    control,
    handleSubmit,
    formState: { errors, isValid, isDirty },
    setValue,
    watch,
    reset,
  } = useForm<AnalysisFormData>({
    resolver: zodResolver(analysisSchema),
    mode: 'onChange',
    defaultValues: {
      githubToken: '',
      jiraEmail: '',
      jiraToken: '',
      jiraBaseUrl: '',
    },
  });

  // Watch repository URL for validation feedback
  const repositoryUrl = watch('repositoryUrl');

  // Form submission handler
  const onFormSubmit = useCallback(async (data: AnalysisFormData) => {
    try {
      // Transform jiraTickets string to array
      const transformedData: AnalysisRequest = {
        ...data,
        jiraTickets: data.jiraTickets
          .split(',')
          .map(ticket => ticket.trim())
          .filter(Boolean),
      };

      await onSubmit(transformedData);
    } catch (error) {
      handleError(error instanceof Error ? error : new Error('Form submission failed'));
    }
  }, [onSubmit, handleError]);

  // Reset form handler
  const handleReset = useCallback(() => {
    reset();
    setShowGithubToken(false);
    setShowJiraToken(false);
  }, [reset]);

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="card max-w-4xl mx-auto"
    >
      <div className="mb-8">
        <motion.h2 
          variants={itemVariants}
          className="text-2xl font-bold text-gray-900 mb-2"
        >
          Repository Security Analysis
        </motion.h2>
        <motion.p 
          variants={itemVariants}
          className="text-gray-600"
        >
          Analyze your repository for security vulnerabilities and get automated fix suggestions.
        </motion.p>
      </div>

      <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-6" noValidate>
        {/* Repository Information Section */}
        <motion.fieldset variants={itemVariants} className="space-y-4">
          <legend className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <CodeBracketIcon className="h-5 w-5 mr-2" aria-hidden="true" />
            Repository Information
          </legend>

          <Controller
            name="repositoryUrl"
            control={control}
            render={({ field }) => (
              <Input
                {...field}
                type="url"
                label="GitHub Repository URL"
                placeholder={PLACEHOLDERS.repositoryUrl}
                helperText={HELP_TEXT.repositoryUrl}
                errorMessage={errors.repositoryUrl?.message}
                required
                autoComplete="url"
                leftIcon={CodeBracketIcon}
                data-testid="repository-url-input"
              />
            )}
          />
        </motion.fieldset>

        {/* JIRA Integration Section */}
        <motion.fieldset variants={itemVariants} className="space-y-4">
          <legend className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <DocumentTextIcon className="h-5 w-5 mr-2" aria-hidden="true" />
            JIRA Integration
          </legend>

          <Controller
            name="jiraTickets"
            control={control}
            render={({ field }) => (
              <Textarea
                {...field}
                label="JIRA Ticket Keys"
                placeholder={PLACEHOLDERS.jiraTickets}
                helperText={HELP_TEXT.jiraTickets}
                error={errors.jiraTickets?.message}
                required
                rows={3}
                resize="vertical"
                data-testid="jira-tickets-input"
              />
            )}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Controller
              name="jiraEmail"
              control={control}
              render={({ field }) => (
                <Input
                  {...field}
                  type="email"
                  label="JIRA Email"
                  placeholder={PLACEHOLDERS.jiraEmail}
                  helperText={HELP_TEXT.jiraEmail}
                  errorMessage={errors.jiraEmail?.message}
                  required
                  autoComplete="email"
                  data-testid="jira-email-input"
                />
              )}
            />

            <Controller
              name="jiraBaseUrl"
              control={control}
              render={({ field }) => (
                <Input
                  {...field}
                  type="url"
                  label="JIRA Base URL"
                  placeholder={PLACEHOLDERS.jiraBaseUrl}
                  helperText={HELP_TEXT.jiraBaseUrl}
                  errorMessage={errors.jiraBaseUrl?.message}
                  required
                  autoComplete="url"
                  data-testid="jira-base-url-input"
                />
              )}
            />
          </div>

          {/* JIRA Test Button */}
          <div className="mt-4">
            <button
              type="button"
              onClick={async () => {
                const formData = watch();
                if (!formData.jiraBaseUrl || !formData.jiraEmail || !formData.jiraToken) {
                  alert('Please fill in all JIRA credentials first');
                  return;
                }
                
                try {
                  const response = await fetch('/api/jira/test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      jiraBaseUrl: formData.jiraBaseUrl,
                      jiraEmail: formData.jiraEmail,
                      jiraToken: formData.jiraToken,
                    }),
                  });
                  
                  const result = await response.json();
                  if (result.success) {
                    alert('✅ JIRA connection successful!');
                  } else {
                    alert(`❌ JIRA connection failed: ${result.error?.message}`);
                  }
                } catch (error) {
                  alert('❌ JIRA test failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
                }
              }}
              disabled={isLoading}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium underline"
            >
              🧪 Test JIRA Connection
            </button>
          </div>
        </motion.fieldset>

        {/* Authentication Section */}
        <motion.fieldset variants={itemVariants} className="space-y-4">
          <legend className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <span className="inline-flex items-center">
              Authentication Tokens
              <HelpTooltip content="These tokens are required to access your repositories and JIRA tickets securely" />
            </span>
          </legend>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Controller
              name="githubToken"
              control={control}
              render={({ field }) => (
                <Input
                  {...field}
                  type="password"
                  label="GitHub Personal Access Token"
                  placeholder={PLACEHOLDERS.githubToken}
                  helperText={HELP_TEXT.githubToken}
                  errorMessage={errors.githubToken?.message}
                  required
                  autoComplete="off"
                  showPasswordToggle
                  data-testid="github-token-input"
                />
              )}
            />

            <Controller
              name="jiraToken"
              control={control}
              render={({ field }) => (
                <Input
                  {...field}
                  type="password"
                  label="JIRA API Token"
                  placeholder={PLACEHOLDERS.jiraToken}
                  helperText={HELP_TEXT.jiraToken}
                  errorMessage={errors.jiraToken?.message}
                  required
                  autoComplete="off"
                  showPasswordToggle
                  data-testid="jira-token-input"
                />
              )}
            />
          </div>
        </motion.fieldset>

        {/* Security Notice */}
        <SecurityNotice />

        {/* Form Actions */}
        <motion.div 
          variants={itemVariants}
          className="flex flex-col sm:flex-row gap-4 pt-6 border-t border-gray-200"
        >
          <PrimaryButton
            type="submit"
            loading={isLoading}
            disabled={!isValid || isLoading}
            className="flex-1 sm:flex-none"
            data-testid="submit-analysis-button"
          >
            {isLoading ? 'Analyzing Repository...' : 'Start Security Analysis'}
          </PrimaryButton>

          {isDirty && (
            <button
              type="button"
              onClick={handleReset}
              disabled={isLoading}
              className="button-secondary flex-1 sm:flex-none"
              data-testid="reset-form-button"
            >
              Reset Form
            </button>
          )}
        </motion.div>

        {/* Mock Data Option */}
        <motion.div
          variants={itemVariants}
          className="flex justify-center pt-2"
        >
          <Controller
            name="useMockData"
            control={control}
            render={({ field }) => (
              <label className="flex items-center space-x-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={field.value || false}
                  onChange={(e) => field.onChange(e.target.checked)}
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span>Use mock data (for testing when JIRA is unavailable)</span>
              </label>
            )}
          />
        </motion.div>

        {/* Form Status */}
        {!isValid && isDirty && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="text-sm text-gray-500 text-center"
            role="status"
            aria-live="polite"
          >
            Please fix the errors above to continue
          </motion.div>
        )}
      </form>
    </motion.div>
  );
}; 