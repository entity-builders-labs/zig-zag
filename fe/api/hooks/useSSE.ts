import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { API_CONFIG } from '../config/constants';
import { getAccessToken } from '../config/token-storage';
import { SSEFrameParser } from '../sse-parser';

export { ParsedSSEFrame, SSEFrameParser } from '../sse-parser';

export type SSEConnectionState =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed';

export interface UseSSEOptions {
  enabled?: boolean;
  onOpen?: () => void;
  onEvent?: (eventName: string, data: any) => void;
  onError?: (error: unknown) => void;
  reconnectInterval?: number;
  maxReconnectInterval?: number;
  connectTimeout?: number;
}

/** Authenticated cross-platform SSE with foreground lifecycle and reconnect. */
export function useSSE(
  pathOrUrl: string | null,
  options: UseSSEOptions = {},
) {
  const {
    enabled = true,
    onOpen,
    onEvent,
    onError,
    reconnectInterval = 1000,
    maxReconnectInterval = 15_000,
    connectTimeout = 10_000,
  } = options;
  const [connectionState, setConnectionState] =
    useState<SSEConnectionState>('disconnected');
  const [isForeground, setIsForeground] = useState(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      return document.visibilityState !== 'hidden';
    }
    return AppState.currentState === 'active';
  });

  const onOpenRef = useRef(onOpen);
  const onEventRef = useRef(onEvent);
  const onErrorRef = useRef(onError);
  onOpenRef.current = onOpen;
  onEventRef.current = onEvent;
  onErrorRef.current = onError;

  const reconnectDelayRef = useRef(reconnectInterval);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeConnectionRef = useRef<{ close: () => void } | null>(null);

  const getFullUrl = useCallback((path: string) => {
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    return `${API_CONFIG.BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const onVisibilityChange = () =>
        setIsForeground(document.visibilityState !== 'hidden');
      document.addEventListener('visibilitychange', onVisibilityChange);
      return () =>
        document.removeEventListener('visibilitychange', onVisibilityChange);
    }

    const subscription = AppState.addEventListener('change', (nextState) => {
      setIsForeground(nextState === 'active');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!enabled || !pathOrUrl || !isForeground) {
      activeConnectionRef.current?.close();
      activeConnectionRef.current = null;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      setConnectionState('disconnected');
      return;
    }

    const fullUrl = getFullUrl(pathOrUrl);
    let cancelled = false;

    const scheduleReconnect = () => {
      if (cancelled || reconnectTimeoutRef.current) return;
      setConnectionState('failed');
      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(
        reconnectDelayRef.current * 1.5,
        maxReconnectInterval,
      );
      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectTimeoutRef.current = null;
        void connect();
      }, delay);
    };

    const connect = async () => {
      if (cancelled) return;
      setConnectionState('connecting');
      activeConnectionRef.current?.close();

      const token = await getAccessToken();
      if (cancelled) return;
      if (!token) {
        onErrorRef.current?.(new Error('SSE requires an authenticated session'));
        scheduleReconnect();
        return;
      }

      const xhr = new XMLHttpRequest();
      const parser = new SSEFrameParser();
      let processedIndex = 0;
      let opened = false;
      let completed = false;
      let openingTimeout: ReturnType<typeof setTimeout> | null = null;

      const consumeResponse = () => {
        const responseText = xhr.responseText || '';
        if (responseText.length <= processedIndex) return;
        const chunk = responseText.slice(processedIndex);
        processedIndex = responseText.length;

        for (const frame of parser.push(chunk)) {
          let parsedData: any = frame.data;
          try {
            parsedData = JSON.parse(frame.data);
          } catch {
            // Plain strings are valid SSE data.
          }
          if (frame.event === 'connected' || frame.event === 'heartbeat') {
            setConnectionState('connected');
          }
          onEventRef.current?.(frame.event, parsedData);
        }
      };

      const finish = (error?: unknown) => {
        if (completed) return;
        completed = true;
        if (openingTimeout) {
          clearTimeout(openingTimeout);
          openingTimeout = null;
        }
        if (error) onErrorRef.current?.(error);
        if (!cancelled) scheduleReconnect();
      };

      xhr.open('GET', fullUrl, true);
      xhr.setRequestHeader('Accept', 'text/event-stream');
      xhr.setRequestHeader('Cache-Control', 'no-cache');
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.onreadystatechange = () => {
        if (cancelled) return;
        if (xhr.readyState === 2) {
          if (xhr.status >= 200 && xhr.status < 300) {
            opened = true;
            if (openingTimeout) {
              clearTimeout(openingTimeout);
              openingTimeout = null;
            }
            reconnectDelayRef.current = reconnectInterval;
            setConnectionState('connected');
            onOpenRef.current?.();
          } else {
            finish(new Error(`SSE connection failed with status ${xhr.status}`));
          }
        }
        if (xhr.readyState >= 3) consumeResponse();
        if (xhr.readyState === 4) {
          consumeResponse();
          finish(
            opened
              ? undefined
              : new Error(`SSE connection closed with status ${xhr.status}`),
          );
        }
      };
      xhr.onprogress = consumeResponse;
      xhr.onerror = (error) => finish(error);
      xhr.ontimeout = () => finish(new Error('SSE connection timed out'));
      xhr.send();

      openingTimeout = setTimeout(() => {
        if (opened || completed) return;
        xhr.abort();
        finish(new Error('SSE connection did not open in time'));
      }, connectTimeout);

      activeConnectionRef.current = {
        close: () => {
          completed = true;
          if (openingTimeout) clearTimeout(openingTimeout);
          parser.reset();
          xhr.abort();
        },
      };
    };

    void connect();
    return () => {
      cancelled = true;
      activeConnectionRef.current?.close();
      activeConnectionRef.current = null;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [
    enabled,
    connectTimeout,
    getFullUrl,
    isForeground,
    maxReconnectInterval,
    pathOrUrl,
    reconnectInterval,
  ]);

  return { connectionState, isForeground };
}
