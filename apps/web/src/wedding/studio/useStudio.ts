import { create } from 'zustand';
import type { DecorObject } from '@ave/shared';

/** Studio-only UI state. The wedding itself (objects, designs, history) lives in the shared state, not here. */
export interface DragPreview {
  id: string;
  /** The whole scene as it would look if released now (a stage drags what stands on it). */
  objects: DecorObject[];
  /** False when the spot is not allowed; the object is drawn where the pointer is, in red. */
  ok: boolean;
}

export type CameraPreset = 'overview' | 'stage' | 'aisle' | 'top' | 'entrance' | 'guest';
export const CAMERA_PRESETS: { id: CameraPreset; label: string }[] = [{ id: 'overview', label: 'Overview' }, { id: 'stage', label: 'Stage view' }, { id: 'aisle', label: 'Aisle view' }, { id: 'top', label: 'Top-down' }];
/** The presentation views offered on the design result page. */
export const SHOWCASE_PRESETS: { id: CameraPreset; label: string }[] = [{ id: 'overview', label: 'Overview' }, { id: 'entrance', label: 'From the entrance' }, { id: 'stage', label: 'Stage close-up' }, { id: 'guest', label: 'Guest view' }];

export type Quality = 'high' | 'fast';
const QUALITY_KEY = 'wedding-os:studio-quality';
/** High on desktop, Fast on narrow screens, unless the customer chose. */
const readQuality = (): Quality => { try { const v = localStorage.getItem(QUALITY_KEY); if (v === 'high' || v === 'fast') return v; } catch { /* default */ } return typeof window !== 'undefined' && window.innerWidth < 820 ? 'fast' : 'high'; };

const HELP_KEY = 'wedding-os:studio-help-dismissed';
const readHelp = () => { try { return localStorage.getItem(HELP_KEY) === '1'; } catch { return false; } };

interface StudioUi {
  /** Latest camera preset request; `nonce` changes on every click so choosing the same preset again re-aims the camera. */
  camera: { preset: CameraPreset; nonce: number };
  helpDismissed: boolean;
  quality: Quality;
  setQuality: (q: Quality) => void;
  /** Slow presentation orbit; any camera interaction or preset turns it off. */
  autoRotate: boolean;
  setAutoRotate: (on: boolean) => void;
  setCamera: (p: CameraPreset) => void;
  dismissHelp: () => void;
  selectedId: string | null;
  drag: DragPreview | null;
  note: { tone: 'error' | 'info'; text: string } | null;
  select: (id: string | null) => void;
  setDrag: (d: DragPreview | null) => void;
  setNote: (n: StudioUi['note']) => void;
}

export const useStudio = create<StudioUi>((set) => ({
  camera: { preset: 'overview', nonce: 0 },
  helpDismissed: readHelp(),
  quality: readQuality(),
  setQuality: (quality) => { try { localStorage.setItem(QUALITY_KEY, quality); } catch { /* ignore */ } set({ quality }); },
  autoRotate: true,
  setAutoRotate: (autoRotate) => set({ autoRotate }),
  setCamera: (preset) => set((s) => ({ autoRotate: false, camera: { preset, nonce: s.camera.nonce + 1 } })),
  dismissHelp: () => { try { localStorage.setItem(HELP_KEY, '1'); } catch { /* ignore */ } set({ helpDismissed: true }); },
  selectedId: null,
  drag: null,
  note: null,
  select: (selectedId) => set({ selectedId }),
  setDrag: (drag) => set({ drag }),
  setNote: (note) => set({ note }),
}));
