import { useState, useEffect, useCallback, useRef } from 'react';
import type { ApiResponse, ApiError, UseApiResult } from '../types';

interface UseApiOptions<T> {
  immediate?: boolean;
  onSuccess?: (data: T) => void;
  onError?: (error: ApiError) => void;
  retries?: number;
  retryDelay?: number;
  timeout?: number;
}

interface ApiRequestConfig {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: any;
  timeout?: number;
}

const DEFAULT_TIMEOUT = 900000; // 15 minutes for large repositories
const DEFAULT_RETRIES = 0;
const DEFAULT_RETRY_DELAY = 1000;

const createApiError = (message: string, code: string, status?: number): ApiError => ({
  code,
  message,
  timestamp: new Date().toISOString(),
  details: { status },
});

const parseErrorResponse = async (response: Response): Promise<ApiError> => {
  try {
    const contentType = response.headers.get('content-type');
    
    if (contentType?.includes('application/json')) {
      const errorData = await response.json();
      return errorData.error || createApiError(
        errorData.message || 'An error occurred',
        errorData.code || 'API_ERROR',
        response.status
      );
    } else {
      const textError = await response.text();
      return createApiError(
        textError || response.statusText || 'An error occurred',
        'HTTP_ERROR',
        response.status
      );
    }
  } catch (parseError) {
    return createApiError(
      `Failed to parse error response: ${response.statusText}`,
      'PARSE_ERROR',
      response.status
    );
  }
};

const makeApiRequest = async <T>(
  url: string,
  config: ApiRequestConfig = {}
): Promise<T> => {
  const {
    method = 'GET',
    headers = {},
    body,
    timeout = DEFAULT_TIMEOUT,
  } = config;

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const requestConfig: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      signal: controller.signal,
    };

    if (body && method !== 'GET') {
      requestConfig.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const response = await fetch(url, requestConfig);
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await parseErrorResponse(response);
      throw error;
    }

    // Handle empty responses
    const contentLength = response.headers.get('content-length');
    if (contentLength === '0' || response.status === 204) {
      return {} as T;
    }

    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      const apiResponse: ApiResponse<T> = await response.json();
      
      if (!apiResponse.success && apiResponse.error) {
        throw apiResponse.error;
      }
      
      return apiResponse.data as T;
    } else {
      // Handle non-JSON responses
      const text = await response.text();
      return text as unknown as T;
    }
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw createApiError('Request timeout', 'TIMEOUT_ERROR');
      }
      
      if (error.message === 'Failed to fetch') {
        throw createApiError('Network error - please check your connection', 'NETWORK_ERROR');
      }
    }
    
    // Re-throw API errors as-is
    if (error && typeof error === 'object' && 'code' in error) {
      throw error;
    }
    
    // Wrap other errors
    throw createApiError(
      error instanceof Error ? error.message : 'Unknown error occurred',
      'UNKNOWN_ERROR'
    );
  }
};

export const useApi = <T>(
  url: string | null,
  options: UseApiOptions<T> = {}
): UseApiResult<T> & {
  execute: (overrideUrl?: string, overrideConfig?: ApiRequestConfig) => Promise<T>;
  reset: () => void;
} => {
  const {
    immediate = true,
    onSuccess,
    onError,
    retries = DEFAULT_RETRIES,
    retryDelay = DEFAULT_RETRY_DELAY,
    timeout = DEFAULT_TIMEOUT,
  } = options;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  
  const retriesRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setLoading(false);
    retriesRef.current = 0;
    
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const execute = useCallback(async (
    overrideUrl?: string,
    overrideConfig: ApiRequestConfig = {}
  ): Promise<T> => {
    const requestUrl = overrideUrl || url;
    
    if (!requestUrl) {
      throw createApiError('No URL provided', 'NO_URL');
    }

    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();
    setLoading(true);
    setError(null);

    const attemptRequest = async (attempt: number): Promise<T> => {
      try {
        const result = await makeApiRequest<T>(requestUrl, {
          timeout,
          ...overrideConfig,
        });

        setData(result);
        setLoading(false);
        retriesRef.current = 0;
        
        onSuccess?.(result);
        return result;
      } catch (requestError) {
        const apiError = requestError as ApiError;
        
        // Don't retry on certain errors
        const nonRetryableErrors = ['VALIDATION_ERROR', 'UNAUTHORIZED', 'FORBIDDEN'];
        const shouldRetry = attempt < retries && !nonRetryableErrors.includes(apiError.code);
        
        if (shouldRetry) {
          retriesRef.current = attempt + 1;
          
          // Exponential backoff
          const delay = retryDelay * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
          
          return attemptRequest(attempt + 1);
        } else {
          setError(apiError);
          setLoading(false);
          onError?.(apiError);
          throw apiError;
        }
      }
    };

    return attemptRequest(0);
  }, [url, timeout, retries, retryDelay, onSuccess, onError]);

  const refetch = useCallback(async (): Promise<void> => {
    await execute();
  }, [execute]);

  // Auto-execute on mount if immediate is true and URL is provided
  useEffect(() => {
    if (immediate && url) {
      execute().catch(() => {
        // Error is already handled in execute function
      });
    }

    // Cleanup on unmount
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [immediate, url, execute]);

  return {
    data,
    loading,
    error,
    refetch,
    execute,
    reset,
  };
};

// Hook for POST requests
export const useApiPost = <TRequest, TResponse>(
  url: string,
  options: Omit<UseApiOptions<TResponse>, 'immediate'> = {}
) => {
  const { execute, ...result } = useApi<TResponse>(null, {
    ...options,
    immediate: false,
  });

  const post = useCallback((data: TRequest) => {
    return execute(url, {
      method: 'POST',
      body: data,
    });
  }, [execute, url]);

  return {
    ...result,
    post,
  };
};

// Hook for PUT requests
export const useApiPut = <TRequest, TResponse>(
  url: string,
  options: Omit<UseApiOptions<TResponse>, 'immediate'> = {}
) => {
  const { execute, ...result } = useApi<TResponse>(null, {
    ...options,
    immediate: false,
  });

  const put = useCallback((data: TRequest) => {
    return execute(url, {
      method: 'PUT',
      body: data,
    });
  }, [execute, url]);

  return {
    ...result,
    put,
  };
};

// Hook for DELETE requests
export const useApiDelete = <TResponse = void>(
  url: string,
  options: Omit<UseApiOptions<TResponse>, 'immediate'> = {}
) => {
  const { execute, ...result } = useApi<TResponse>(null, {
    ...options,
    immediate: false,
  });

  const remove = useCallback(() => {
    return execute(url, {
      method: 'DELETE',
    });
  }, [execute, url]);

  return {
    ...result,
    delete: remove,
  };
}; 