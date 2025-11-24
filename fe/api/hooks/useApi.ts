import { useState, useEffect } from 'react';

export interface ApiError {
  message: string;
  code?: string;
  status?: number;
}

export interface ApiResponse<T> {
  data: T | null;
  error?: ApiError;
  success: boolean;
}

interface UseApiState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
}

type ApiFunction<T> = () => Promise<ApiResponse<T>>;

export function useApi<T>(
  apiFunction: ApiFunction<T>,
  immediate = true,
  dependencies: any[] = []
) {
  const [state, setState] = useState<UseApiState<T>>({
    data: null,
    error: null,
    loading: immediate,
  });

  const execute = async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const response = await apiFunction();
      if (!response.success || response.error) {
        setState({
          data: null,
          error: response.error || {
            message: 'Unknown error occurred',
            code: 'UNKNOWN_ERROR',
          },
          loading: false,
        });
      } else {
        setState({ data: response.data, error: null, loading: false });
      }
    } catch (error) {
      setState({
        data: null,
        error: {
          message:
            error instanceof Error
              ? error.message
              : 'An unknown error occurred',
          code: 'RUNTIME_ERROR',
          status: 500,
        },
        loading: false,
      });
    }
  };

  useEffect(() => {
    if (immediate) {
      execute();
    }
  }, []);

  return {
    ...state,
    execute,
  };
}
