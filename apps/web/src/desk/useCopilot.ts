import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConsultNextStep, CopilotStep, Delivery, OutboundDraft, OutboundPreview } from '@ave/shared';
import { toast } from '@/ui';
import { errorText } from './api';
import { copilotApi, type PreviewEdits } from './copilotApi';
import { draftFromNextStep } from './quickDrafts';

/** Entries kept in the copilot's activity log. */
const LOG_LIMIT = 30;
/** A sent card stays this long so the admin sees the result, then folds away. */
export const SENT_CARD_LINGER_MS = 8000;

export type LogEntry =
  | { id: string; kind: 'command'; text: string; at: number }
  | { id: string; kind: 'reply'; text: string; steps: CopilotStep[]; at: number }
  | { id: string; kind: 'error'; text: string; at: number }
  | { id: string; kind: 'delivery'; delivery: Delivery; at: number };

export interface PreviewCardState {
  preview: OutboundPreview;
  phase: 'draft' | 'sending' | 'done';
  /** The last send attempt, when there was one. */
  delivery: Delivery | null;
  error: string | null;
}

export interface Copilot {
  log: LogEntry[];
  cards: PreviewCardState[];
  /** An instruction is running. */
  busy: boolean;
  run: (command: string, nextStepId?: string) => Promise<void>;
  /** Creates a preview card from a draft. Resolves true when the card appeared. */
  draft: (draft: OutboundDraft) => Promise<boolean>;
  /** One-click action from a live-notes next step: messages become previews, screen commands run now. */
  runAction: (step: ConsultNextStep) => void;
  send: (previewId: string, edits: PreviewEdits) => Promise<void>;
  /** Removes a card; an unsent preview is discarded on the server too. */
  dismiss: (previewId: string) => void;
}

let seq = 0;
const nextId = () => `cp${Date.now().toString(36)}${(seq++).toString(36)}`;

/** State for the copilot bar of one call: the log, the preview cards, and the calls behind them. */
export function useCopilot(sessionId: string | undefined): Copilot {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [cards, setCards] = useState<PreviewCardState[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending.values()) clearTimeout(t);
      pending.clear();
    };
  }, []);

  // A different call starts with a clean bar.
  useEffect(() => {
    setLog([]);
    setCards([]);
  }, [sessionId]);

  const append = useCallback((entry: LogEntry) => setLog((l) => [...l, entry].slice(-LOG_LIMIT)), []);
  const addPreviews = useCallback((previews: OutboundPreview[]) => {
    if (!previews.length) return;
    setCards((c) => [...c.filter((x) => !previews.some((p) => p.id === x.preview.id)), ...previews.map((preview) => ({ preview, phase: 'draft' as const, delivery: null, error: null }))]);
  }, []);
  const patchCard = useCallback((id: string, patch: Partial<PreviewCardState>) => setCards((c) => c.map((x) => (x.preview.id === id ? { ...x, ...patch } : x))), []);
  const removeCard = useCallback((id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setCards((c) => c.filter((x) => x.preview.id !== id));
  }, []);

  const run = useCallback(
    async (command: string, nextStepId?: string) => {
      const text = command.trim();
      if (!sessionId || !text) return;
      if (busyRef.current) {
        toast('The copilot is still on the last instruction', { tone: 'error', body: 'Wait for it to finish, then try again.' });
        return;
      }
      busyRef.current = true;
      setBusy(true);
      append({ id: nextId(), kind: 'command', text, at: Date.now() });
      try {
        const result = await copilotApi.run(sessionId, text, nextStepId);
        append({ id: nextId(), kind: 'reply', text: result.reply, steps: result.steps, at: Date.now() });
        addPreviews(result.previews);
      } catch (err) {
        append({ id: nextId(), kind: 'error', text: errorText(err), at: Date.now() });
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [sessionId, append, addPreviews],
  );

  const draft = useCallback(
    async (d: OutboundDraft) => {
      if (!sessionId) return false;
      try {
        addPreviews([await copilotApi.preview(sessionId, d)]);
        return true;
      } catch (err) {
        toast('Could not prepare that message', { tone: 'error', body: errorText(err) });
        return false;
      }
    },
    [sessionId, addPreviews],
  );

  const runAction = useCallback(
    (step: ConsultNextStep) => {
      if (step.action?.kind === 'view') {
        void run(step.action.command, step.id);
        return;
      }
      const d = draftFromNextStep(step);
      if (d) void draft(d);
    },
    [run, draft],
  );

  const send = useCallback(
    async (previewId: string, edits: PreviewEdits) => {
      if (!sessionId) return;
      patchCard(previewId, { phase: 'sending', error: null });
      try {
        const delivery = await copilotApi.send(sessionId, previewId, edits);
        patchCard(previewId, { phase: delivery.status === 'sent' ? 'done' : 'draft', delivery });
        append({ id: nextId(), kind: 'delivery', delivery, at: Date.now() });
        if (delivery.status === 'sent') timers.current.set(previewId, setTimeout(() => removeCard(previewId), SENT_CARD_LINGER_MS));
      } catch (err) {
        patchCard(previewId, { phase: 'draft', error: errorText(err) });
      }
    },
    [sessionId, patchCard, append, removeCard],
  );

  const dismiss = useCallback(
    (previewId: string) => {
      const card = cards.find((c) => c.preview.id === previewId);
      if (sessionId && card && card.phase !== 'done') void copilotApi.discard(sessionId, previewId);
      removeCard(previewId);
    },
    [cards, sessionId, removeCard],
  );

  return { log, cards, busy, run, draft, runAction, send, dismiss };
}
