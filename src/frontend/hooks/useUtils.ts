import { useState, useEffect, useCallback, useRef } from 'react';
import type { UseLocalStorageResult } from '../types';

/**
 * Hook for managing localStorage with TypeScript support and SSR safety
 */
export const useLocalStorage = <T>(
  key: string,
  initialValue: T
): UseLocalStorageResult<T> => {
  // State to store our value
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === 'undefined') {
      return initialValue;
    }

    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  // Return a wrapped version of useState's setter function that persists the new value to localStorage
  const setValue = useCallback((value: T | ((val: T) => T)) => {
    try {
      // Allow value to be a function so we have the same API as useState
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      
      setStoredValue(valueToStore);
      
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, JSON.stringify(valueToStore));
      }
    } catch (error) {
      console.warn(`Error setting localStorage key "${key}":`, error);
    }
  }, [key, storedValue]);

  const removeValue = useCallback(() => {
    try {
      setStoredValue(initialValue);
      
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(key);
      }
    } catch (error) {
      console.warn(`Error removing localStorage key "${key}":`, error);
    }
  }, [key, initialValue]);

  return {
    value: storedValue,
    setValue,
    removeValue,
  };
};

/**
 * Hook for debouncing values
 */
export const useDebounce = <T>(value: T, delay: number): T => {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
};

/**
 * Hook for getting previous value
 */
export const usePrevious = <T>(value: T): T | undefined => {
  const ref = useRef<T>();
  
  useEffect(() => {
    ref.current = value;
  });
  
  return ref.current;
};

/**
 * Hook for managing boolean states with helper functions
 */
export const useBoolean = (initialValue = false) => {
  const [value, setValue] = useState(initialValue);

  const setTrue = useCallback(() => setValue(true), []);
  const setFalse = useCallback(() => setValue(false), []);
  const toggle = useCallback(() => setValue(prev => !prev), []);

  return {
    value,
    setValue,
    setTrue,
    setFalse,
    toggle,
  };
};

/**
 * Hook for managing array states with helper functions
 */
export const useArray = <T>(initialValue: T[] = []) => {
  const [array, setArray] = useState<T[]>(initialValue);

  const push = useCallback((element: T) => {
    setArray(prev => [...prev, element]);
  }, []);

  const filter = useCallback((callback: (item: T, index: number) => boolean) => {
    setArray(prev => prev.filter(callback));
  }, []);

  const update = useCallback((index: number, newElement: T) => {
    setArray(prev => prev.map((item, i) => i === index ? newElement : item));
  }, []);

  const remove = useCallback((index: number) => {
    setArray(prev => prev.filter((_, i) => i !== index));
  }, []);

  const clear = useCallback(() => {
    setArray([]);
  }, []);

  const insertAt = useCallback((index: number, element: T) => {
    setArray(prev => [
      ...prev.slice(0, index),
      element,
      ...prev.slice(index),
    ]);
  }, []);

  return {
    array,
    setArray,
    push,
    filter,
    update,
    remove,
    clear,
    insertAt,
  };
};

/**
 * Hook for handling async operations with loading and error states
 */
export const useAsync = <T, Args extends any[]>(
  asyncFunction: (...args: Args) => Promise<T>
) => {
  const [state, setState] = useState<{
    data: T | null;
    loading: boolean;
    error: Error | null;
  }>({
    data: null,
    loading: false,
    error: null,
  });

  const execute = useCallback(async (...args: Args) => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const result = await asyncFunction(...args);
      setState({ data: result, loading: false, error: null });
      return result;
    } catch (error) {
      const errorObject = error instanceof Error ? error : new Error(String(error));
      setState({ data: null, loading: false, error: errorObject });
      throw error;
    }
  }, [asyncFunction]);

  const reset = useCallback(() => {
    setState({ data: null, loading: false, error: null });
  }, []);

  return {
    ...state,
    execute,
    reset,
  };
};

/**
 * Hook for detecting if component is mounted
 */
export const useIsMounted = () => {
  const isMountedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return useCallback(() => isMountedRef.current, []);
};

/**
 * Hook for managing focus state
 */
export const useFocus = <T extends HTMLElement = HTMLElement>() => {
  const [isFocused, setIsFocused] = useState(false);
  const ref = useRef<T>(null);

  const setFocus = useCallback(() => {
    if (ref.current) {
      ref.current.focus();
    }
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const handleFocus = () => setIsFocused(true);
    const handleBlur = () => setIsFocused(false);

    element.addEventListener('focus', handleFocus);
    element.addEventListener('blur', handleBlur);

    return () => {
      element.removeEventListener('focus', handleFocus);
      element.removeEventListener('blur', handleBlur);
    };
  }, []);

  return {
    ref,
    isFocused,
    setFocus,
  };
};

/**
 * Hook for managing hover state
 */
export const useHover = <T extends HTMLElement = HTMLElement>() => {
  const [isHovered, setIsHovered] = useState(false);
  const ref = useRef<T>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const handleMouseEnter = () => setIsHovered(true);
    const handleMouseLeave = () => setIsHovered(false);

    element.addEventListener('mouseenter', handleMouseEnter);
    element.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      element.removeEventListener('mouseenter', handleMouseEnter);
      element.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, []);

  return {
    ref,
    isHovered,
  };
};

/**
 * Hook for managing online/offline status
 */
export const useOnlineStatus = () => {
  const [isOnline, setIsOnline] = useState(
    typeof window !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
};

/**
 * Hook for managing window size
 */
export const useWindowSize = () => {
  const [windowSize, setWindowSize] = useState<{
    width: number;
    height: number;
  }>(() => {
    if (typeof window === 'undefined') {
      return { width: 0, height: 0 };
    }
    
    return {
      width: window.innerWidth,
      height: window.innerHeight,
    };
  });

  useEffect(() => {
    const handleResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener('resize', handleResize);
    
    // Call handler right away so state gets updated with initial window size
    handleResize();

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return windowSize;
};

/**
 * Hook for managing document title
 */
export const useDocumentTitle = (title: string) => {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;

    return () => {
      document.title = previousTitle;
    };
  }, [title]);
};

/**
 * Hook for copying text to clipboard
 */
export const useClipboard = () => {
  const [isCopied, setIsCopied] = useState(false);

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setIsCopied(true);
      
      // Reset after 2 seconds
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy text: ', error);
      setIsCopied(false);
    }
  }, []);

  return {
    isCopied,
    copyToClipboard,
  };
}; 