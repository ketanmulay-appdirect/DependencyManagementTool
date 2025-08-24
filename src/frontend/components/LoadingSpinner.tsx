import React from 'react';
import { motion } from 'framer-motion';
import type { BaseComponentProps } from '../types';

interface LoadingSpinnerProps extends BaseComponentProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'spinner' | 'dots' | 'pulse' | 'bars';
  color?: 'primary' | 'secondary' | 'white' | 'gray';
  text?: string;
  centered?: boolean;
}

const sizeClasses = {
  xs: { spinner: 'h-3 w-3', text: 'text-xs', container: 'gap-1' },
  sm: { spinner: 'h-4 w-4', text: 'text-sm', container: 'gap-2' },
  md: { spinner: 'h-6 w-6', text: 'text-base', container: 'gap-2' },
  lg: { spinner: 'h-8 w-8', text: 'text-lg', container: 'gap-3' },
  xl: { spinner: 'h-12 w-12', text: 'text-xl', container: 'gap-4' },
};

const colorClasses = {
  primary: 'text-primary-600',
  secondary: 'text-gray-600',
  white: 'text-white',
  gray: 'text-gray-400',
};

// Spinner variant
const SpinnerVariant: React.FC<{ size: string; color: string }> = ({ size, color }) => (
  <motion.div
    className={`${size} border-2 border-current border-t-transparent rounded-full ${color}`}
    animate={{ rotate: 360 }}
    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
    aria-hidden="true"
  />
);

// Dots variant
const DotsVariant: React.FC<{ size: string; color: string }> = ({ size, color }) => {
  const dotSize = size.includes('h-3') ? 'h-1 w-1' : 
                  size.includes('h-4') ? 'h-1.5 w-1.5' :
                  size.includes('h-6') ? 'h-2 w-2' :
                  size.includes('h-8') ? 'h-2.5 w-2.5' : 'h-3 w-3';

  return (
    <div className={`flex space-x-1 ${color}`} aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className={`${dotSize} bg-current rounded-full`}
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.7, 1, 0.7],
          }}
          transition={{
            duration: 0.6,
            repeat: Infinity,
            delay: i * 0.2,
          }}
        />
      ))}
    </div>
  );
};

// Pulse variant
const PulseVariant: React.FC<{ size: string; color: string }> = ({ size, color }) => (
  <motion.div
    className={`${size} bg-current rounded-full ${color}`}
    animate={{
      scale: [1, 1.2, 1],
      opacity: [0.7, 1, 0.7],
    }}
    transition={{
      duration: 1,
      repeat: Infinity,
    }}
    aria-hidden="true"
  />
);

// Bars variant
const BarsVariant: React.FC<{ size: string; color: string }> = ({ size, color }) => {
  const barHeight = size.includes('h-3') ? 'h-3' : 
                   size.includes('h-4') ? 'h-4' :
                   size.includes('h-6') ? 'h-6' :
                   size.includes('h-8') ? 'h-8' : 'h-12';
  
  const barWidth = 'w-1';

  return (
    <div className={`flex items-end space-x-1 ${color}`} aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <motion.div
          key={i}
          className={`${barWidth} bg-current rounded-sm`}
          animate={{
            height: [`25%`, `100%`, `25%`],
          }}
          transition={{
            duration: 0.8,
            repeat: Infinity,
            delay: i * 0.2,
          }}
          style={{ height: barHeight }}
        />
      ))}
    </div>
  );
};

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'md',
  variant = 'spinner',
  color = 'primary',
  text,
  centered = false,
  className = '',
  'data-testid': testId,
  ...props
}) => {
  const sizes = sizeClasses[size];
  const colorClass = colorClasses[color];

  const renderVariant = () => {
    switch (variant) {
      case 'dots':
        return <DotsVariant size={sizes.spinner} color={colorClass} />;
      case 'pulse':
        return <PulseVariant size={sizes.spinner} color={colorClass} />;
      case 'bars':
        return <BarsVariant size={sizes.spinner} color={colorClass} />;
      default:
        return <SpinnerVariant size={sizes.spinner} color={colorClass} />;
    }
  };

  const content = (
    <div
      className={`
        flex items-center
        ${sizes.container}
        ${centered ? 'justify-center' : ''}
        ${className}
      `}
      role="status"
      aria-live="polite"
      aria-label={text || 'Loading'}
      data-testid={testId}
      {...props}
    >
      {renderVariant()}
      
      {text && (
        <span className={`font-medium ${colorClass} ${sizes.text}`}>
          {text}
        </span>
      )}
      
      <span className="sr-only">
        {text || 'Loading, please wait...'}
      </span>
    </div>
  );

  if (centered) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        {content}
      </div>
    );
  }

  return content;
};

// Preset loading components for common use cases
export const PageLoader: React.FC<{ text?: string }> = ({ text = 'Loading page...' }) => (
  <div className="min-h-screen flex items-center justify-center">
    <LoadingSpinner size="lg" text={text} color="primary" />
  </div>
);

export const SectionLoader: React.FC<{ text?: string }> = ({ text = 'Loading...' }) => (
  <div className="flex items-center justify-center py-12">
    <LoadingSpinner size="md" text={text} color="primary" />
  </div>
);

export const ButtonLoader: React.FC = () => (
  <LoadingSpinner size="sm" color="white" />
);

export const InlineLoader: React.FC<{ text?: string }> = ({ text }) => (
  <LoadingSpinner size="sm" text={text} color="primary" />
); 