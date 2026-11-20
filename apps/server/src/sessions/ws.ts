import type { FastifyPluginAsync } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import {
  ClientMessageSchema,
  summarizeSession,
  type ClientRole,
  type DeskMessage,
  type ServerMessage,
  type SessionAction,
} from '@ave/shared';

/** Actions a browser may send over the socket. Agent and system actions only come from the server. */
const CLIENT_ALLOWED: ReadonlySet<SessionAction['type']> = new Set([
  'set_view',
  'set_property',
  'apply_offer',
  'remove_offer',
  'confirm_booking',
  'update_lead',
  'set_status',
  'set_language',
  'add_transcript',
  'note',
  'set_handoff',
  'add_admin_note',
]);
/** Actions only the human advisor's screen may send. */
const ADVISOR_ONLY: ReadonlySet<SessionAction['type']> = new Set(['add_admin_note']);

interface Client {
  socket: WebSocket;
  sessionId: string | null;
  role: ClientRole | null;
}

/**
 * /ws        — one socket per call participant; receives full session state on every change.
 * /ws/desk   — Lead Desk feed of live sessions and handoff requests.
 */
export const wsRoutes: FastifyPluginAsync = async (app) => {
  const { store } = app.ctx;
  const clients = new Set<Client>();
  const deskSockets = new Set<WebSocket>();

  const send = (socket: WebSocket, msg: ServerMessage | DeskMessage) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  };
  const broadcastDesk = (msg: DeskMessage) => {
    for (const s of deskSockets) send(s, msg);
  };

  store.on('change', (state, action) => {
    for (const c of clients) if (c.sessionId === state.id) send(c.socket, { type: 'state', state });
    if (action.type !== 'add_transcript' && action.type !== 'set_activity') {
      broadcastDesk({ type: 'sessions', sessions: store.summaries() });
    }
    if (action.type === 'set_handoff' && action.patch.status === 'requested') {
      broadcastDesk({ type: 'handoff_requested', sessionId: state.id, buyerName: state.buyer.name, reason: state.handoff.reason });
    }
  });
  store.on('created', () => broadcastDesk({ type: 'sessions', sessions: store.summaries() }));

  app.get('/ws', { websocket: true }, (socket) => {
    const client: Client = { socket, sessionId: null, role: null };
    clients.add(client);

    socket.on('message', (raw: Buffer) => {
      let json: unknown;
      try {
        json = JSON.parse(raw.toString());
      } catch {
        return send(socket, { type: 'error', message: 'Malformed message' });
      }
      const parsed = ClientMessageSchema.safeParse(json);
      if (!parsed.success) return send(socket, { type: 'error', message: 'Unknown message' });
      const msg = parsed.data;

      switch (msg.type) {
        case 'ping':
          return send(socket, { type: 'pong' });
        case 'hello': {
          const state = store.get(msg.sessionId);
          if (!state) return send(socket, { type: 'error', message: 'Session not found' });
          client.sessionId = msg.sessionId;
          client.role = msg.role;
          return send(socket, { type: 'state', state });
        }
        case 'action': {
          if (!client.sessionId || !client.role) return send(socket, { type: 'error', message: 'Say hello first' });
          if (!CLIENT_ALLOWED.has(msg.action.type)) return send(socket, { type: 'error', message: 'Action not allowed' });
          if (ADVISOR_ONLY.has(msg.action.type) && client.role !== 'advisor') return send(socket, { type: 'error', message: 'Action not allowed' });
          const source = client.role === 'advisor' ? 'advisor' : client.role === 'studio' ? 'presenter' : 'buyer';
          store.dispatch(client.sessionId, msg.action, source);
          return;
        }
      }
    });
    socket.on('close', () => clients.delete(client));
  });

  app.get('/ws/desk', { websocket: true }, (socket) => {
    deskSockets.add(socket);
    send(socket, { type: 'sessions', sessions: store.list().map(summarizeSession) });
    socket.on('close', () => deskSockets.delete(socket));
  });
};
