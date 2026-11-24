import { create } from 'zustand';
import type { WeddingAction, WeddingState } from '@ave/shared';
import { ApiError, claimWorkspace, weddingApi } from './api';
import { useStudio } from './studio/useStudio';
import type { ChatMessage, ChatStep, FlagsInfo, Proposal, WeddingMeta } from './types';

const ID_KEY = 'wedding-os:id';

/** A random, unguessable workspace id kept in this browser. Demo-grade identity; there is no login yet. */
export function workspaceId(): string {
  try {
    const saved = localStorage.getItem(ID_KEY);
    if (saved && /^[A-Za-z0-9_-]{1,64}$/.test(saved)) return saved;
    const fresh = `w-${crypto.randomUUID().replace(/-/g, '')}`;
    localStorage.setItem(ID_KEY, fresh);
    return fresh;
  } catch {
    return 'w-session';
  }
}

interface WeddingStore {
  id: string;
  state: WeddingState | null;
  meta: WeddingMeta | null;
  loading: boolean;
  /** Set when the server cannot be reached or rejected a change. */
  error: string | null;
  messages: ChatMessage[];
  sending: boolean;
  /** Changes the planner proposed that are waiting for the customer. */
  proposals: Proposal[];
  proposalNotice: string | null;
  load: () => Promise<void>;
  flags: FlagsInfo | null;
  loadFlags: () => Promise<void>;
  /** Sends a recording; the server transcribes it and runs it through the same planner and tools as typed chat. */
  sendVoice: (audio: Blob, lang: string) => Promise<void>;
  /** Adopts a state snapshot returned by a non-action endpoint (e.g. shortlist). Ignored if older than the current one. */
  adopt: (next: WeddingState) => void;
  /** Sends a validated action. Returns an error message when the server refused it, otherwise null. */
  act: (action: WeddingAction) => Promise<string | null>;
  send: (text: string) => Promise<void>;
  confirmProposal: (id: string) => Promise<void>;
  cancelProposal: (id: string) => Promise<void>;
  reset: () => Promise<void>;
}

/** Ignore a snapshot older than the one we already show, so a slow response cannot undo a newer change. */
const newer = (cur: WeddingState | null, next: WeddingState) => (!cur || next.rev >= cur.rev ? next : cur);

let seq = 0;

export const useWedding = create<WeddingStore>((set, get) => ({
  flags: null,
  async loadFlags() {
    try { set({ flags: await weddingApi.flags() }); } catch { /* keep the last known flags; pages stay usable */ }
  },
  async sendVoice(audio, lang) {
    if (get().sending) return;
    const placeholder: ChatMessage = { id: ++seq, role: 'planner', text: '', steps: [], pending: true };
    set((s) => ({ messages: [...s.messages, placeholder], sending: true }));
    try {
      const r = await weddingApi.voice(get().id, audio, lang, useStudio.getState().selectedId);
      const steps: ChatStep[] = r.turn.toolCalls.map((c) => ({ id: c.id, label: c.label, specialist: c.specialist, status: c.result.ok ? 'ok' : c.result.proposal ? 'pending' : 'error', summary: c.result.ok ? c.result.summary : c.result.proposal?.summary, error: c.result.error, hint: c.result.hint }));
      const proposals = r.turn.toolCalls.map((c) => c.result.proposal).filter((p): p is Proposal => Boolean(p));
      set((s) => ({
        messages: s.messages.flatMap((m) => (m.id === placeholder.id ? [{ id: ++seq, role: 'user' as const, text: `🎤 ${r.transcript}` }, { ...m, text: r.turn.reply, steps, pending: false }] : [m])),
        state: newer(s.state, r.turn.state),
        proposals: [...proposals.filter((p) => !s.proposals.some((q) => q.id === p.id)), ...s.proposals],
      }));
    } catch (e) {
      set((s) => ({ messages: s.messages.map((m) => (m.id === placeholder.id ? { ...m, pending: false, error: true, text: (e as Error).message } : m)) }));
    } finally {
      set({ sending: false });
    }
  },
  adopt: (next) => set((st) => ({ state: newer(st.state, next) })),
  id: workspaceId(),
  state: null,
  meta: null,
  loading: false,
  error: null,
  messages: [],
  sending: false,
  proposals: [],
  proposalNotice: null,

  async load() {
    set({ loading: true, error: null });
    if (!(await claimWorkspace(get().id))) {
      set({ loading: false, error: 'This wedding is locked to another browser session. Clear this site\'s data to start a new wedding.' });
      return;
    }
    try {
      const [{ state }, meta, pending] = await Promise.all([weddingApi.get(get().id), weddingApi.meta(), weddingApi.proposals(get().id)]);
      set({ state: newer(get().state, state), meta, proposals: pending.proposals, loading: false });
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  async act(action) {
    try {
      const { state } = await weddingApi.act(get().id, action);
      set({ state: newer(get().state, state), error: null });
      return null;
    } catch (e) {
      const err = e as ApiError;
      return err.hint ? `${err.message} ${err.hint}` : err.message;
    }
  },

  async send(text) {
    const t = text.trim();
    if (!t || get().sending) return;
    const user: ChatMessage = { id: ++seq, role: 'user', text: t };
    const placeholder: ChatMessage = { id: ++seq, role: 'planner', text: '', steps: [], pending: true };
    set((s) => ({ messages: [...s.messages, user, placeholder], sending: true }));
    const patch = (fn: (m: ChatMessage) => ChatMessage) => set((s) => ({ messages: s.messages.map((m) => (m.id === placeholder.id ? fn(m) : m)) }));
    const step = (id: number, p: Partial<ChatStep>) => patch((m) => ({ ...m, steps: (m.steps ?? []).map((x) => (x.id === id ? { ...x, ...p } : x)) }));
    try {
      await weddingApi.chatStream(get().id, t, useStudio.getState().selectedId, (e) => {
        if (e.type === 'tool_start') patch((m) => ({ ...m, steps: [...(m.steps ?? []), { id: e.id, label: e.label, specialist: e.specialist, status: 'running' }] }));
        else if (e.type === 'tool_end') {
          step(e.id, e.ok ? { status: 'ok', summary: e.summary } : e.proposal ? { status: 'pending', summary: e.proposal.summary } : { status: 'error', error: e.error, hint: e.hint });
          if (e.proposal) set((s) => ({ proposals: s.proposals.some((p) => p.id === e.proposal!.id) ? s.proposals : [e.proposal!, ...s.proposals] }));
          set((s) => ({ state: newer(s.state, e.state) })); // the scene updates as each action is accepted
        } else if (e.type === 'done') {
          patch((m) => ({ ...m, text: e.turn.reply, pending: false }));
          set((s) => ({ state: newer(s.state, e.turn.state) }));
        } else if (e.type === 'error') patch((m) => ({ ...m, text: e.message, pending: false, error: true }));
      });
      patch((m) => (m.pending ? { ...m, pending: false, text: m.text || 'The planner stopped without an answer.', error: !m.text } : m));
    } catch (e) {
      patch((m) => ({ ...m, pending: false, error: true, text: (e as Error).message }));
    } finally {
      set({ sending: false });
    }
  },

  async confirmProposal(proposalId) {
    const done = (note: string | null) => set((s) => ({ proposals: s.proposals.filter((p) => p.id !== proposalId), proposalNotice: note }));
    try {
      const { state, proposal } = await weddingApi.confirm(get().id, proposalId);
      set((s) => ({ state: newer(s.state, state), messages: [...s.messages, { id: ++seq, role: 'planner', text: `✓ Confirmed and applied: ${proposal.summary}.` }] }));
      done(null);
    } catch (e) {
      // A used, cancelled, expired or stale proposal is dead; drop it and say why.
      done((e as Error).message);
    }
  },

  async cancelProposal(proposalId) {
    try {
      const { proposal } = await weddingApi.cancel(get().id, proposalId);
      set((s) => ({ proposals: s.proposals.filter((p) => p.id !== proposalId), proposalNotice: null, messages: [...s.messages, { id: ++seq, role: 'planner', text: `Cancelled: ${proposal.summary}. Nothing was changed.` }] }));
    } catch (e) {
      set((s) => ({ proposals: s.proposals.filter((p) => p.id !== proposalId), proposalNotice: (e as Error).message }));
    }
  },

  async reset() {
    try {
      const { state } = await weddingApi.reset(get().id);
      set({ state, messages: [], proposals: [], proposalNotice: null, error: null });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },
}));
