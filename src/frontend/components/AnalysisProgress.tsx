import React from 'react';
import { motion } from 'framer-motion';
import { 
  CheckCircleIcon, 
  ExclamationCircleIcon,
  ClockIcon 
} from '@heroicons/react/24/outline';
import { LoadingSpinner } from './LoadingSpinner';

interface AnalysisProgressProps {
  step: string;
  progress: number;
  message: string;
}

export const AnalysisProgress: React.FC<AnalysisProgressProps> = ({
  step,
  progress,
  message,
}) => {
  const steps = [
    { id: 'starting', label: 'Initializing', description: 'Setting up analysis environment' },
    { id: 'cloning', label: 'Repository', description: 'Cloning and scanning package files' },
    { id: 'jira', label: 'JIRA Integration', description: 'Fetching Wiz security findings' },
    { id: 'analyzing', label: 'Analysis', description: 'Analyzing dependencies and vulnerabilities' },
    { id: 'completed', label: 'Complete', description: 'Analysis finished successfully' },
  ];

  const getStepStatus = (stepId: string) => {
    const currentStepIndex = steps.findIndex(s => s.id === step);
    const stepIndex = steps.findIndex(s => s.id === stepId);
    
    if (step === 'error') {
      return stepIndex <= currentStepIndex ? 'error' : 'pending';
    }
    
    if (stepIndex < currentStepIndex) return 'completed';
    if (stepIndex === currentStepIndex) return 'current';
    return 'pending';
  };

  const getStepIcon = (stepId: string) => {
    const status = getStepStatus(stepId);
    
    switch (status) {
      case 'completed':
        return <CheckCircleIcon className="h-5 w-5 text-green-600" />;
      case 'current':
        return <LoadingSpinner size="sm" className="text-primary-600" />;
      case 'error':
        return <ExclamationCircleIcon className="h-5 w-5 text-red-600" />;
      default:
        return <ClockIcon className="h-5 w-5 text-gray-400" />;
    }
  };

  const getStepClasses = (stepId: string) => {
    const status = getStepStatus(stepId);
    
    const baseClasses = 'flex items-center p-4 rounded-lg border';
    
    switch (status) {
      case 'completed':
        return `${baseClasses} bg-green-50 border-green-200`;
      case 'current':
        return `${baseClasses} bg-primary-50 border-primary-200`;
      case 'error':
        return `${baseClasses} bg-red-50 border-red-200`;
      default:
        return `${baseClasses} bg-gray-50 border-gray-200`;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="card"
    >
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          Analysis Progress
        </h3>
        <p className="text-gray-600">{message}</p>
      </div>

      {/* Progress Bar */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium text-gray-700">Progress</span>
          <span className="text-sm text-gray-500">{progress}%</span>
        </div>
        <div className="progress-bar">
          <motion.div
            className={`progress-fill ${step === 'error' ? 'bg-red-600' : 'bg-primary-600'}`}
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
      </div>

      {/* Step List */}
      <div className="space-y-3">
        {steps.map((stepItem, index) => {
          const status = getStepStatus(stepItem.id);
          const isActive = status === 'current';
          
          return (
            <motion.div
              key={stepItem.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className={getStepClasses(stepItem.id)}
            >
              <div className="flex items-center">
                <div className="flex-shrink-0 mr-3">
                  {getStepIcon(stepItem.id)}
                </div>
                <div className="flex-1">
                  <h4 className={`text-sm font-medium ${
                    status === 'completed' ? 'text-green-900' :
                    status === 'current' ? 'text-primary-900' :
                    status === 'error' ? 'text-red-900' :
                    'text-gray-500'
                  }`}>
                    {stepItem.label}
                  </h4>
                  <p className={`text-xs ${
                    status === 'completed' ? 'text-green-600' :
                    status === 'current' ? 'text-primary-600' :
                    status === 'error' ? 'text-red-600' :
                    'text-gray-400'
                  }`}>
                    {isActive && step !== 'error' ? message : stepItem.description}
                  </p>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Error State */}
      {step === 'error' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg"
        >
          <div className="flex">
            <ExclamationCircleIcon className="h-5 w-5 text-red-400 mr-2 mt-0.5" />
            <div>
              <h4 className="text-sm font-medium text-red-800">Analysis Failed</h4>
              <p className="text-sm text-red-700 mt-1">{message}</p>
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}; 