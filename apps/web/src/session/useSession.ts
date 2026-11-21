import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import type { ClientMessage, ClientRole, ServerMessage, SessionAction, SessionState } from '@ave/shared';
import { socketUrl } from './socketUrl';

type Connection = 'connecting' | 'open' | 'reconnecting' | 'closed';

interface SessionStore {
  state: SessionState | null;
  connection: Connection;
  error: string | null;
  /** Sends an action to the server; the reducer there is the source of truth. */
  dispatch: (action: SessionAction) => void;
}

/** Shared session store for the active call (one call per tab). */
export const useSessionStore = create<SessionStore>(() => ({
  state: null,
  connection: 'connecting',
  error: null,
  dispatch: () => {},
}));

const RECONNECT_DELAYS_MS = [250, 500, 1000, 2000, 4000];
const PING_INTERVAL_MS = 20_000;


/**
 * Connects this tab to a session over WebSocket and keeps the store in sync.
 * Reconnects with backoff and replays the hello so the latest state arrives again.
 */
export function useSessionConnection(sessionId: string | undefined, role: ClientRole): void {
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let attempt = 0;
    let closedByUs = false;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const outbox: ClientMessage[] = [];

    const send = (msg: ClientMessage) => {
      const s = socketRef.current;
      if (s && s.readyState === WebSocket.OPEN) s.send(JSON.stringify(msg));
      else outbox.push(msg);
    };

    useSessionStore.setState({
      dispatch: (action) => send({ type: 'action', action }),
    });

    const connect = () => {
      const socket = new WebSocket(socketUrl('/ws'));
      socketRef.current = socket;
      useSessionStore.setState({ connection: attempt === 0 ? 'connecting' : 'reconnecting' });

      socket.onopen = () => {
        attempt = 0;
        socket.send(JSON.stringify({ type: 'hello', sessionId, role } satisfies ClientMessage));
        while (outbox.length) socket.send(JSON.stringify(outbox.shift()));
        useSessionStore.setState({ connection: 'open', error: null });
        pingTimer = setInterval(() => send({ type: 'ping' }), PING_INTERVAL_MS);
      };
      socket.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data)) as ServerMessage;
        if (msg.type === 'state') {
          const current = useSessionStore.getState().state;
          if (!current || current.id !== msg.state.id || msg.state.rev >= current.rev) {
            useSessionStore.setState({ state: msg.state });
          }
        } else if (msg.type === 'error') {
          useSessionStore.setState({ error: msg.message });
        }
      };
      socket.onclose = () => {
        clearInterval(pingTimer);
        if (closedByUs) return useSessionStore.setState({ connection: 'closed' });
        const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
        attempt += 1;
        useSessionStore.setState({ connection: 'reconnecting' });
        retryTimer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      closedByUs = true;
      clearInterval(pingTimer);
      clearTimeout(retryTimer);
      socketRef.current?.close();
      useSessionStore.setState({ state: null, connection: 'closed', error: null, dispatch: () => {} });
    };
  }, [sessionId, role]);
}

export const useSessionState = () => useSessionStore((s) => s.state);
export const useDispatch = () => useSessionStore((s) => s.dispatch);
