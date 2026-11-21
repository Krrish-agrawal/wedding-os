import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeskMessage, SessionSummary } from '@ave/shared';
import { errorText } from './api';
import { socketUrl } from '@/session/socketUrl';

/** Re-renders every `intervalMs` with the current time, for ticking clocks and "2 min ago". */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export interface Resource<T> {
  data: T | null;
  error: string | null;
  /** True only until the first answer arrives; refreshes keep showing the last data. */
  loading: boolean;
  refresh: () => void;
}

/**
 * Loads `load()` now and whenever `key` changes, refreshes on `refresh()` and every `pollMs`
 * (0 = never). Stale answers from an earlier key are dropped.
 */
export function useResource<T>(key: string | null, load: () => Promise<T>, pollMs = 0): Resource<T> {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null }>({ key: null, data: null, error: null });
  const loadRef = useRef(load);
  loadRef.current = load;
  const seq = useRef(0);

  const refresh = useCallback(() => {
    if (key === null) return;
    const mine = ++seq.current;
    loadRef.current().then(
      (data) => {
        if (mine === seq.current) setState({ key, data, error: null });
      },
      (err: unknown) => {
        if (mine === seq.current) setState((s) => ({ key, data: s.key === key ? s.data : null, error: errorText(err) }));
      },
    );
  }, [key]);

  useEffect(() => {
    refresh();
    if (!pollMs || key === null) return;
    const t = setInterval(refresh, pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs, key]);

  const current = state.key === key;
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    loading: key !== null && (!current || (state.data === null && state.error === null)),
    refresh,
  };
}

export type FeedConnection = 'connecting' | 'open' | 'reconnecting';

export interface DeskFeed {
  sessions: SessionSummary[];
  connection: FeedConnection;
  /** Bumps on every feed message, so lists can refresh when something changed. */
  version: number;
}

const FEED_RETRY_MS = [500, 1000, 2000, 4000, 8000];

/**
 * Live calls from /ws/desk, reconnecting with backoff. `onHandoff` fires when a buyer asks
 * for a human advisor.
 */
export function useDeskFeed(onHandoff: (msg: Extract<DeskMessage, { type: 'handoff_requested' }>) => void): DeskFeed {
  const [feed, setFeed] = useState<DeskFeed>({ sessions: [], connection: 'connecting', version: 0 });
  const handoffRef = useRef(onHandoff);
  handoffRef.current = onHandoff;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let attempt = 0;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      socket = new WebSocket(socketUrl('/ws/desk'));
      socket.onopen = () => {
        attempt = 0;
        setFeed((f) => ({ ...f, connection: 'open' }));
      };
      socket.onmessage = (ev) => {
        let msg: DeskMessage;
        try {
          msg = JSON.parse(String(ev.data)) as DeskMessage;
        } catch {
          return;
        }
        if (msg.type === 'sessions') setFeed((f) => ({ ...f, sessions: msg.sessions, version: f.version + 1 }));
        else if (msg.type === 'handoff_requested') {
          handoffRef.current(msg);
          setFeed((f) => ({ ...f, version: f.version + 1 }));
        }
      };
      socket.onclose = () => {
        if (stopped) return;
        setFeed((f) => ({ ...f, connection: 'reconnecting' }));
        retry = setTimeout(connect, FEED_RETRY_MS[Math.min(attempt, FEED_RETRY_MS.length - 1)]);
        attempt += 1;
      };
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      const s = socket;
      // Closing a socket that is still connecting logs a browser warning; close it once open instead.
      if (s?.readyState === WebSocket.CONNECTING) s.onopen = () => s.close();
      else s?.close();
    };
  }, []);

  return feed;
}

/** Calls `fn` at most once per `ms` while `value` keeps changing (trailing call guaranteed). */
export function useThrottledEffect(fn: () => void, value: unknown, ms: number): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const last = useRef(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const wait = Math.max(0, last.current + ms - Date.now());
    const t = setTimeout(() => {
      last.current = Date.now();
      fnRef.current();
    }, wait);
    return () => clearTimeout(t);
  }, [value, ms]);
}

const ADVISOR_NAME_KEY = 'ave.desk.advisorName';

/** The human advisor's name, remembered on this device so they type it once. */
export function useAdvisorName(): [string, (name: string) => void] {
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(ADVISOR_NAME_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const save = useCallback((next: string) => {
    setName(next);
    try {
      localStorage.setItem(ADVISOR_NAME_KEY, next.trim());
    } catch {
      // Private windows may block storage; the name still works for this visit.
    }
  }, []);
  return [name, save];
}
