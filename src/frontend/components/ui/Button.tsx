import React, { forwardRef } from 'react';
import { motion } from 'framer-motion';
import type { ButtonProps, IconProps } from '../../types';

// Loading spinner component
const LoadingSpinner: React.FC<{ size?: IconProps['size'] }> = ({ size = 'sm' }) => {
  const sizeClasses = {
    xs: 'h-3 w-3',
    sm: 'h-4 w-4',
    md: 'h-5 w-5',
    lg: 'h-6 w-6',
    xl: 'h-7 w-7',
  };

  return (
    <motion.div
      animate={{ rotate: 360 }}
      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
      className={`${sizeClasses[size]} border-2 border-current border-t-transparent rounded-full`}
      aria-hidden="true"
    />
  );
};

// Button component
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({
    children,
    variant = 'primary',
    size = 'md',
    disabled = false,
    loading = false,
    icon: Icon,
    iconPosition = 'left',
    className = '',
    onClick,
    type = 'button',
    'aria-label': ariaLabel,
    'data-testid': testId,
    ...props
  }, ref) => {
    // Base classes for all buttons
    const baseClasses = `
      inline-flex items-center justify-center
      font-medium rounded-lg
      transition-all duration-200
      focus:outline-none focus:ring-2 focus:ring-offset-2
      disabled:opacity-50 disabled:cursor-not-allowed
      disabled:pointer-events-none
    `;

    // Variant-specific classes
    const variantClasses = {
      primary: `
        bg-primary-600 hover:bg-primary-700 active:bg-primary-800
        text-white border border-transparent
        focus:ring-primary-500
        shadow-sm hover:shadow-md
      `,
      secondary: `
        bg-white hover:bg-gray-50 active:bg-gray-100
        text-gray-700 border border-gray-300
        focus:ring-gray-500
        shadow-sm hover:shadow-md
      `,
      outline: `
        bg-transparent hover:bg-primary-50 active:bg-primary-100
        text-primary-600 border border-primary-600
        focus:ring-primary-500
      `,
      ghost: `
        bg-transparent hover:bg-gray-100 active:bg-gray-200
        text-gray-700 border border-transparent
        focus:ring-gray-500
      `,
      danger: `
        bg-danger-600 hover:bg-danger-700 active:bg-danger-800
        text-white border border-transparent
        focus:ring-danger-500
        shadow-sm hover:shadow-md
      `,
    };

    // Size-specific classes
    const sizeClasses = {
      xs: 'px-2.5 py-1.5 text-xs gap-1',
      sm: 'px-3 py-2 text-sm gap-1.5',
      md: 'px-4 py-2.5 text-sm gap-2',
      lg: 'px-6 py-3 text-base gap-2.5',
      xl: 'px-8 py-4 text-lg gap-3',
    };

    // Icon size mapping
    const iconSizeMap = {
      xs: 'xs' as const,
      sm: 'xs' as const,
      md: 'sm' as const,
      lg: 'md' as const,
      xl: 'lg' as const,
    };

    const iconSizeClasses = {
      xs: 'h-3 w-3',
      sm: 'h-4 w-4',
      md: 'h-4 w-4',
      lg: 'h-5 w-5',
      xl: 'h-6 w-6',
    };

    // Combine all classes
    const combinedClasses = `
      ${baseClasses}
      ${variantClasses[variant]}
      ${sizeClasses[size]}
      ${className}
    `.trim().replace(/\s+/g, ' ');

    // Handle click events
    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      if (disabled || loading) {
        event.preventDefault();
        return;
      }
      onClick?.(event);
    };

    // Handle keyboard events for accessibility
    const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        if (disabled || loading) {
          event.preventDefault();
          return;
        }
        // Let the browser handle the click
      }
    };

    // Determine what content to show
    const showLoadingSpinner = loading;
    const showIcon = Icon && !showLoadingSpinner;
    const isIconOnly = !children && (showIcon || showLoadingSpinner);

    // Calculate icon size
    const iconSize = iconSizeMap[size];

    return (
      <motion.button
        ref={ref}
        type={type}
        className={combinedClasses}
        disabled={disabled || loading}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        aria-label={ariaLabel || (isIconOnly ? 'Button' : undefined)}
        aria-disabled={disabled || loading}
        aria-busy={loading}
        data-testid={testId}
        whileHover={disabled || loading ? {} : { scale: 1.02 }}
        whileTap={disabled || loading ? {} : { scale: 0.98 }}
        transition={{ duration: 0.1 }}
        {...props}
      >
        {/* Left icon or loading spinner */}
        {(showIcon || showLoadingSpinner) && iconPosition === 'left' && (
          <>
            {showLoadingSpinner ? (
              <LoadingSpinner size={iconSize} />
            ) : Icon ? (
              <Icon
                className={iconSizeClasses[size]}
                aria-hidden={true}
              />
            ) : null}
          </>
        )}

        {/* Button text/children */}
        {children && (
          <span className={loading ? 'opacity-75' : ''}>
            {children}
          </span>
        )}

        {/* Right icon */}
        {showIcon && iconPosition === 'right' && Icon && (
          <Icon
            className={iconSizeClasses[size]}
            aria-hidden={true}
          />
        )}
      </motion.button>
    );
  }
);

Button.displayName = 'Button';

// Preset button variants for common use cases
export const PrimaryButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, 'variant'>>(
  (props, ref) => <Button ref={ref} variant="primary" {...props} />
);
PrimaryButton.displayName = 'PrimaryButton';

export const SecondaryButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, 'variant'>>(
  (props, ref) => <Button ref={ref} variant="secondary" {...props} />
);
SecondaryButton.displayName = 'SecondaryButton';

export const OutlineButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, 'variant'>>(
  (props, ref) => <Button ref={ref} variant="outline" {...props} />
);
OutlineButton.displayName = 'OutlineButton';

export const GhostButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, 'variant'>>(
  (props, ref) => <Button ref={ref} variant="ghost" {...props} />
);
GhostButton.displayName = 'GhostButton';

export const DangerButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, 'variant'>>(
  (props, ref) => <Button ref={ref} variant="danger" {...props} />
);
DangerButton.displayName = 'DangerButton'; 