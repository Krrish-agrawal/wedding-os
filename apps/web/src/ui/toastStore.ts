import { create } from 'zustand';

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
}

export const TOAST_LIFETIME_MS = 5000;
const MAX_TOASTS = 3;

interface ToastStore {
  items: ToastItem[];
  push: (t: Omit<ToastItem, 'id'>) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToasts = create<ToastStore>((set) => ({
  items: [],
  push: (t) => set((s) => ({ items: [...s.items, { ...t, id: nextId++ }].slice(-MAX_TOASTS) })),
  dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));

/** Show a short, non-blocking message. Callable from anywhere, including outside React. */
export function toast(title: string, opts: { tone?: ToastTone; body?: string } = {}): void {
  useToasts.getState().push({ title, tone: opts.tone ?? 'info', ...(opts.body ? { body: opts.body } : {}) });
}

