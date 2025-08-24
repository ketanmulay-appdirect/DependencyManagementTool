import React, { forwardRef, useState } from 'react';
import { EyeIcon, EyeSlashIcon, ExclamationCircleIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import type { BaseComponentProps } from '../../types';

interface InputProps extends BaseComponentProps {
  type?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url' | 'search';
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  autoComplete?: string;
  autoFocus?: boolean;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'error' | 'success';
  label?: string;
  helperText?: string;
  errorMessage?: string;
  successMessage?: string;
  leftIcon?: React.ComponentType<{ className?: string }>;
  rightIcon?: React.ComponentType<{ className?: string }>;
  showPasswordToggle?: boolean;
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onFocus?: (event: React.FocusEvent<HTMLInputElement>) => void;
  onBlur?: (event: React.FocusEvent<HTMLInputElement>) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

// Input component
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({
    type = 'text',
    value,
    defaultValue,
    placeholder,
    disabled = false,
    readOnly = false,
    required = false,
    autoComplete,
    autoFocus = false,
    maxLength,
    minLength,
    pattern,
    size = 'md',
    variant = 'default',
    label,
    helperText,
    errorMessage,
    successMessage,
    leftIcon: LeftIcon,
    rightIcon: RightIcon,
    showPasswordToggle = false,
    className = '',
    onChange,
    onFocus,
    onBlur,
    onKeyDown,
    'aria-describedby': ariaDescribedBy,
    'aria-invalid': ariaInvalid,
    'data-testid': testId,
    ...props
  }, ref) => {
    const [showPassword, setShowPassword] = useState(false);
    const [isFocused, setIsFocused] = useState(false);

    // Determine the actual input type
    const inputType = type === 'password' && showPassword ? 'text' : type;

    // Determine variant based on props
    const actualVariant = errorMessage ? 'error' : successMessage ? 'success' : variant;

    // Generate unique IDs for accessibility
    const inputId = React.useId();
    const helperTextId = `${inputId}-helper`;
    const errorId = `${inputId}-error`;
    const successId = `${inputId}-success`;

    // Size-specific classes
    const sizeClasses = {
      sm: {
        input: 'px-3 py-2 text-sm',
        icon: 'h-4 w-4',
        label: 'text-sm',
        helper: 'text-xs',
      },
      md: {
        input: 'px-3 py-2.5 text-sm',
        icon: 'h-5 w-5',
        label: 'text-sm',
        helper: 'text-sm',
      },
      lg: {
        input: 'px-4 py-3 text-base',
        icon: 'h-6 w-6',
        label: 'text-base',
        helper: 'text-sm',
      },
    };

    // Variant-specific classes
    const variantClasses = {
      default: {
        container: 'border-gray-300 focus-within:border-primary-500 focus-within:ring-primary-500',
        input: 'focus:border-primary-500 focus:ring-primary-500',
        icon: 'text-gray-400',
      },
      error: {
        container: 'border-red-300 focus-within:border-red-500 focus-within:ring-red-500',
        input: 'focus:border-red-500 focus:ring-red-500',
        icon: 'text-red-400',
      },
      success: {
        container: 'border-green-300 focus-within:border-green-500 focus-within:ring-green-500',
        input: 'focus:border-green-500 focus:ring-green-500',
        icon: 'text-green-400',
      },
    };

    // Base input classes
    const inputBaseClasses = `
      block w-full border rounded-lg
      placeholder-gray-400
      focus:outline-none focus:ring-1
      disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-50
      transition-colors duration-200
    `;

    // Combine input classes
    const inputClasses = `
      ${inputBaseClasses}
      ${sizeClasses[size].input}
      ${variantClasses[actualVariant].input}
      ${disabled ? 'bg-gray-50' : 'bg-white'}
      ${LeftIcon || RightIcon || (type === 'password' && showPasswordToggle) ? 'pr-10' : ''}
      ${LeftIcon ? 'pl-10' : ''}
      ${className}
    `.trim().replace(/\s+/g, ' ');

    // Container classes for input with icons
    const containerClasses = `
      relative
      ${variantClasses[actualVariant].container}
      ${isFocused ? 'ring-1' : ''}
      rounded-lg
    `;

    // Handle focus events
    const handleFocus = (event: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(true);
      onFocus?.(event);
    };

    const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(false);
      onBlur?.(event);
    };

    // Handle password toggle
    const togglePasswordVisibility = () => {
      setShowPassword(!showPassword);
    };

    // Determine aria-describedby
    const describedBy = [
      ariaDescribedBy,
      helperText ? helperTextId : '',
      errorMessage ? errorId : '',
      successMessage ? successId : '',
    ].filter(Boolean).join(' ') || undefined;

    return (
      <div className="space-y-1">
        {/* Label */}
        {label && (
          <label
            htmlFor={inputId}
            className={`
              block font-medium text-gray-700
              ${sizeClasses[size].label}
              ${required ? 'after:content-["*"] after:ml-0.5 after:text-red-500' : ''}
            `}
          >
            {label}
          </label>
        )}

        {/* Input container */}
        <div className={containerClasses}>
          {/* Left icon */}
          {LeftIcon && (
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <LeftIcon
                className={`${sizeClasses[size].icon} ${variantClasses[actualVariant].icon}`}
                aria-hidden="true"
              />
            </div>
          )}

          {/* Input element */}
          <input
            ref={ref}
            id={inputId}
            type={inputType}
            value={value}
            defaultValue={defaultValue}
            placeholder={placeholder}
            disabled={disabled}
            readOnly={readOnly}
            required={required}
            autoComplete={autoComplete}
            autoFocus={autoFocus}
            maxLength={maxLength}
            minLength={minLength}
            pattern={pattern}
            className={inputClasses}
            onChange={onChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={onKeyDown}
            aria-describedby={describedBy}
            aria-invalid={ariaInvalid ?? !!errorMessage}
            data-testid={testId}
            {...props}
          />

          {/* Right icon or password toggle */}
          {(RightIcon || (type === 'password' && showPasswordToggle) || actualVariant !== 'default') && (
            <div className="absolute inset-y-0 right-0 flex items-center">
              {/* Status icon (error/success) */}
              {actualVariant === 'error' && (
                <ExclamationCircleIcon
                  className={`${sizeClasses[size].icon} text-red-500 mr-3`}
                  aria-hidden="true"
                />
              )}
              {actualVariant === 'success' && (
                <CheckCircleIcon
                  className={`${sizeClasses[size].icon} text-green-500 mr-3`}
                  aria-hidden="true"
                />
              )}

              {/* Password toggle */}
              {type === 'password' && showPasswordToggle && (
                <button
                  type="button"
                  className={`
                    mr-3 p-1 rounded
                    text-gray-400 hover:text-gray-600
                    focus:outline-none focus:text-gray-600
                    transition-colors duration-200
                  `}
                  onClick={togglePasswordVisibility}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1} // Remove from tab order to avoid confusion
                >
                  {showPassword ? (
                    <EyeSlashIcon className={sizeClasses[size].icon} />
                  ) : (
                    <EyeIcon className={sizeClasses[size].icon} />
                  )}
                </button>
              )}

              {/* Custom right icon */}
              {RightIcon && (
                <div className="mr-3 pointer-events-none">
                  <RightIcon
                    className={`${sizeClasses[size].icon} ${variantClasses[actualVariant].icon}`}
                    aria-hidden="true"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Helper text */}
        {helperText && !errorMessage && !successMessage && (
          <p
            id={helperTextId}
            className={`${sizeClasses[size].helper} text-gray-500`}
          >
            {helperText}
          </p>
        )}

        {/* Error message */}
        {errorMessage && (
          <p
            id={errorId}
            className={`${sizeClasses[size].helper} text-red-600`}
            role="alert"
            aria-live="polite"
          >
            {errorMessage}
          </p>
        )}

        {/* Success message */}
        {successMessage && (
          <p
            id={successId}
            className={`${sizeClasses[size].helper} text-green-600`}
            role="status"
            aria-live="polite"
          >
            {successMessage}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

// Textarea component
interface TextareaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> {
  rows?: number;
  cols?: number;
  resize?: 'none' | 'vertical' | 'horizontal' | 'both';
  label?: string;
  error?: string;
  helperText?: string;
  className?: string;
}

// Simple utility to combine class names
const classNames = (...classes: (string | undefined | null | false)[]): string => {
  return classes.filter(Boolean).join(' ');
};

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({
    rows = 4,
    cols,
    resize = 'vertical',
    label,
    error,
    helperText,
    className,
    ...props
  }, ref) => {
    return (
      <div className="space-y-1">
        {label && (
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          rows={rows}
          cols={cols}
          className={classNames(
            'input-field',
            resize === 'none' && 'resize-none',
            resize === 'vertical' && 'resize-y',
            resize === 'horizontal' && 'resize-x',
            resize === 'both' && 'resize',
            error && 'border-red-300 focus:border-red-500 focus:ring-red-500',
            className
          )}
          {...props}
        />
        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}
        {helperText && !error && (
          <p className="text-sm text-gray-500">{helperText}</p>
        )}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea'; 