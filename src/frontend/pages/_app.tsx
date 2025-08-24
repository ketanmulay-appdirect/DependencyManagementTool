import React from 'react';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { QueryClient, QueryClientProvider } from 'react-query';
import { ReactQueryDevtools } from 'react-query/devtools';
import { Toaster } from 'react-hot-toast';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useOnlineStatus } from '../hooks';
import '../src/styles/globals.css';

// Create a stable query client instance
const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      cacheTime: 1000 * 60 * 10, // 10 minutes
      retry: (failureCount, error: any) => {
        // Don't retry on 4xx errors (client errors)
        if (error?.status >= 400 && error?.status < 500) {
          return false;
        }
        return failureCount < 3;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      refetchIntervalInBackground: false,
    },
    mutations: {
      retry: 1,
      retryDelay: 1000,
    },
  },
});

// Global error handler for React Query
const handleQueryError = (error: Error) => {
  console.error('React Query Error:', error);
  
  // You can integrate with error reporting service here
  // e.g., Sentry.captureException(error);
};

// Offline status indicator component
const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div 
      className="fixed top-0 left-0 right-0 bg-orange-500 text-white text-center py-2 text-sm z-50"
      role="alert"
      aria-live="polite"
    >
      <span className="font-medium">You are currently offline.</span> Some features may not be available.
    </div>
  );
};

// Main app component
const MyApp: React.FC<AppProps> = ({ Component, pageProps }) => {
  const [queryClient] = React.useState(() => createQueryClient());

  // Set up global error handling
  React.useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('Unhandled promise rejection:', event.reason);
      handleQueryError(event.reason);
    };

    const handleError = (event: ErrorEvent) => {
      console.error('Global error:', event.error);
      handleQueryError(event.error);
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('error', handleError);

    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('error', handleError);
    };
  }, []);

  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#2563eb" />
        <meta name="description" content="Security Dependency Management Tool - Analyze and fix security vulnerabilities in your dependencies" />
        
        {/* Preconnect to external domains for better performance */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        
        {/* Favicon */}
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        
        {/* PWA manifest */}
        <link rel="manifest" href="/manifest.json" />
      </Head>

      <ErrorBoundary
        onError={(error, errorInfo) => {
          console.error('App Error Boundary:', error, errorInfo);
          handleQueryError(error);
        }}
        resetOnPropsChange
      >
        <QueryClientProvider client={queryClient}>
          <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
            <OfflineIndicator />
            
            <main className="relative">
              <ErrorBoundary
                onError={(error, errorInfo) => {
                  console.error('Component Error Boundary:', error, errorInfo);
                }}
              >
                <Component {...pageProps} />
              </ErrorBoundary>
            </main>
          </div>

          {/* Global toast notifications */}
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 4000,
              style: {
                background: '#fff',
                color: '#374151',
                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                borderRadius: '0.5rem',
                border: '1px solid #e5e7eb',
              },
              success: {
                iconTheme: {
                  primary: '#10b981',
                  secondary: '#fff',
                },
              },
              error: {
                iconTheme: {
                  primary: '#ef4444',
                  secondary: '#fff',
                },
                duration: 6000,
              },
              loading: {
                iconTheme: {
                  primary: '#3b82f6',
                  secondary: '#fff',
                },
              },
            }}
          />

          {/* React Query Devtools - only in development */}
          {process.env.NODE_ENV === 'development' && (
            <ReactQueryDevtools
              initialIsOpen={false}
              position="bottom-right"
            />
          )}
        </QueryClientProvider>
      </ErrorBoundary>
    </>
  );
};

// Set display name for debugging
MyApp.displayName = 'MyApp';

export default MyApp; 