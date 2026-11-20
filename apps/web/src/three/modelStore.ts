import './quietDeprecations';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Group } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { prepareModel, type PreparedModel } from './prepareModel';

/**
 * Loads property models once per page and shares them between the tour, the studio tools and the
 * call-screen preloader. Download progress is real (bytes received of Content-Length); parsing is
 * reported as its own phase so the loading state never sits at 100% without saying why.
 */

export type ModelState =
  | { status: 'idle' }
  | { status: 'downloading'; progress: number | null }
  | { status: 'preparing' }
  | { status: 'ready'; model: PreparedModel }
  | { status: 'error'; message: string };

interface Entry {
  state: ModelState;
  promise: Promise<PreparedModel> | null;
  listeners: Set<() => void>;
}

const IDLE: ModelState = { status: 'idle' };
const entries = new Map<string, Entry>();
let loader: GLTFLoader | null = null;

function getLoader(): GLTFLoader {
  if (!loader) {
    loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  return loader;
}

function entry(url: string): Entry {
  let e = entries.get(url);
  if (!e) {
    e = { state: IDLE, promise: null, listeners: new Set() };
    entries.set(url, e);
  }
  return e;
}

function set(url: string, state: ModelState) {
  const e = entry(url);
  e.state = state;
  for (const l of e.listeners) l();
}

/** Starts (or joins) the load of a model. Resolves with the prepared scene. */
export function loadModel(url: string): Promise<PreparedModel> {
  const e = entry(url);
  if (e.promise) return e.promise;
  set(url, { status: 'downloading', progress: null });
  e.promise = new Promise<GLTF>((resolve, reject) => {
    getLoader().load(
      url,
      resolve,
      (ev) => {
        if (ev.lengthComputable && ev.total > 0) {
          const progress = Math.min(1, ev.loaded / ev.total);
          set(url, progress >= 1 ? { status: 'preparing' } : { status: 'downloading', progress });
        }
      },
      reject,
    );
  })
    .then((gltf) => {
      set(url, { status: 'preparing' });
      const model = prepareModel(gltf.scene as Group);
      set(url, { status: 'ready', model });
      return model;
    })
    .catch((err: unknown) => {
      e.promise = null;
      const message = err instanceof Error ? err.message : String(err);
      set(url, { status: 'error', message });
      throw err;
    });
  return e.promise;
}

/** Fire-and-forget load; failures surface through the model state, never as a rejection. */
export function warmModel(url: string): void {
  loadModel(url).catch(() => undefined);
}

export function retryModel(url: string): void {
  const e = entry(url);
  if (e.state.status === 'error') {
    e.promise = null;
    warmModel(url);
  }
}

export function getModelState(url: string): ModelState {
  return entries.get(url)?.state ?? IDLE;
}

function subscribe(url: string, listener: () => void): () => void {
  const e = entry(url);
  e.listeners.add(listener);
  return () => e.listeners.delete(listener);
}

/** Current state of a model, starting its load on first use. */
export function useModelState(url: string | null): ModelState {
  const sub = useCallback((l: () => void) => (url ? subscribe(url, l) : () => undefined), [url]);
  const state = useSyncExternalStore(sub, () => (url ? getModelState(url) : IDLE));
  useEffect(() => {
    if (url) warmModel(url);
  }, [url]);
  return state;
}

/** Every model among `urls` that has finished loading, in the same order. Starts loads as needed. */
export function useReadyModels(urls: string[]): PreparedModel[] {
  const key = urls.join('|');
  const sub = useCallback(
    (l: () => void) => {
      const offs = key.split('|').map((u) => subscribe(u, l));
      return () => offs.forEach((off) => off());
    },
    [key],
  );
  const snapshot = useCallback(() => key.split('|').map((u) => (getModelState(u).status === 'ready' ? 'r' : '-')).join(''), [key]);
  const ready = useSyncExternalStore(sub, snapshot);
  useEffect(() => {
    for (const u of key.split('|')) warmModel(u);
  }, [key]);
  return useMemo(() => {
    const out: PreparedModel[] = [];
    key.split('|').forEach((u, i) => {
      const s = getModelState(u);
      if (ready[i] === 'r' && s.status === 'ready') out.push(s.model);
    });
    return out;
  }, [key, ready]);
}
