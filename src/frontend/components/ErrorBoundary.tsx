import React from 'react';
import { ExclamationTriangleIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import type { ErrorState, BaseComponentProps } from '../types';

interface ErrorBoundaryState extends ErrorState {
  errorInfo?: React.ErrorInfo;
  eventId?: string;
}

interface ErrorBoundaryProps extends BaseComponentProps {
  fallback?: React.ComponentType<ErrorFallbackProps>;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  resetOnPropsChange?: boolean;
  resetKeys?: Array<string | number>;
}

interface ErrorFallbackProps {
  error: Error;
  resetError: () => void;
  eventId?: string;
}

const DefaultErrorFallback: React.FC<ErrorFallbackProps> = ({ 
  error, 
  resetError, 
  eventId 
}) => (
  <div className="min-h-[400px] flex items-center justify-center p-8">
    <div className="text-center max-w-md">
      <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100 mb-4">
        <ExclamationTriangleIcon 
          className="h-6 w-6 text-red-600" 
          aria-hidden="true"
        />
      </div>
      
      <h3 className="text-lg font-medium text-gray-900 mb-2">
        Something went wrong
      </h3>
      
      <p className="text-sm text-gray-500 mb-6">
        We encountered an unexpected error. Please try refreshing the page or contact support if the problem persists.
      </p>
      
      {process.env.NODE_ENV === 'development' && (
        <details className="text-left mb-6 p-4 bg-gray-50 rounded-lg">
          <summary className="cursor-pointer text-sm font-medium text-gray-700 mb-2">
            Error Details (Development Only)
          </summary>
          <pre className="text-xs text-red-600 whitespace-pre-wrap overflow-auto">
            {error.stack || error.message}
          </pre>
          {eventId && (
            <p className="text-xs text-gray-500 mt-2">
              Event ID: {eventId}
            </p>
          )}
        </details>
      )}
      
      <button
        type="button"
        onClick={resetError}
        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors"
        aria-label="Try again"
      >
        <ArrowPathIcon className="h-4 w-4 mr-2" aria-hidden="true" />
        Try Again
      </button>
    </div>
  </div>
);

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private resetTimeoutId: number | null = null;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: undefined,
      errorBoundary: true,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
      errorBoundary: true,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    const eventId = this.generateEventId();
    
    // Log error to console in development
    if (process.env.NODE_ENV === 'development') {
      console.group('🚨 Error Boundary Caught Error');
      console.error('Error:', error);
      console.error('Error Info:', errorInfo);
      console.error('Component Stack:', errorInfo.componentStack);
      console.groupEnd();
    }

    // Update state with error info
    this.setState({
      errorInfo,
      eventId,
    });

    // Call custom error handler if provided
    this.props.onError?.(error, errorInfo);

    // Log to external service (implement based on your logging service)
    this.logErrorToService(error, errorInfo, eventId);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    const { resetKeys, resetOnPropsChange } = this.props;
    const { hasError } = this.state;

    // Reset error state if resetKeys changed
    if (hasError && resetKeys) {
      const hasResetKeyChanged = resetKeys.some((key, index) => 
        prevProps.resetKeys?.[index] !== key
      );
      
      if (hasResetKeyChanged) {
        this.resetError();
      }
    }

    // Reset error state if any props changed and resetOnPropsChange is true
    if (hasError && resetOnPropsChange) {
      const propsChanged = Object.keys(this.props).some(key => 
        this.props[key as keyof ErrorBoundaryProps] !== prevProps[key as keyof ErrorBoundaryProps]
      );
      
      if (propsChanged) {
        this.resetError();
      }
    }
  }

  componentWillUnmount(): void {
    if (this.resetTimeoutId) {
      clearTimeout(this.resetTimeoutId);
    }
  }

  private generateEventId = (): string => {
    return `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  };

  private logErrorToService = (
    error: Error, 
    errorInfo: React.ErrorInfo, 
    eventId: string
  ): void => {
    // Implement logging to your preferred service (Sentry, LogRocket, etc.)
    // Example implementation:
    try {
      const errorData = {
        eventId,
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        url: window.location.href,
        userId: 'anonymous', // Replace with actual user ID if available
      };

      // Log to your service
      // logService.error(errorData);
      
      // For now, log to console
      console.warn('Error logged with ID:', eventId, errorData);
    } catch (loggingError) {
      console.error('Failed to log error to service:', loggingError);
    }
  };

  private resetError = (): void => {
    this.setState({
      hasError: false,
      error: undefined,
      errorInfo: undefined,
      eventId: undefined,
      errorBoundary: true,
    });
  };

  private handleRetryWithDelay = (): void => {
    // Reset error state after a short delay to prevent rapid retries
    this.resetTimeoutId = window.setTimeout(() => {
      this.resetError();
    }, 100);
  };

  render(): React.ReactNode {
    const { hasError, error, eventId } = this.state;
    const { children, fallback: FallbackComponent = DefaultErrorFallback } = this.props;

    if (hasError && error) {
      // Convert ApiError to Error if needed
      const errorToPass = error instanceof Error 
        ? error 
        : new Error((error as any).message || 'Unknown error');
      
      return (
        <FallbackComponent
          error={errorToPass}
          resetError={this.handleRetryWithDelay}
          eventId={eventId}
        />
      );
    }

    return children;
  }
}

// HOC for wrapping components with error boundary
export const withErrorBoundary = <P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Partial<ErrorBoundaryProps>
) => {
  const WrappedComponent = React.forwardRef<any, P>((props, ref) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <Component {...(props as P)} ref={ref} />
    </ErrorBoundary>
  ));

  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`;

  return WrappedComponent;
};

// Hook for handling errors in functional components
export const useErrorHandler = () => {
  const [error, setError] = React.useState<Error | null>(null);

  const resetError = React.useCallback(() => {
    setError(null);
  }, []);

  const handleError = React.useCallback((error: Error | string) => {
    const errorObject = error instanceof Error ? error : new Error(error);
    setError(errorObject);
    
    // Log error
    console.error('useErrorHandler caught error:', errorObject);
  }, []);

  // Throw error to be caught by error boundary
  React.useEffect(() => {
    if (error) {
      throw error;
    }
  }, [error]);

  return {
    handleError,
    resetError,
    hasError: error !== null,
  };
}; 