import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AdvisorAudioSnapshot, AdvisorAudioStatus, AdvisorCall } from './advisorCall';

/**
 * Live audio for the human advisor's call screen (/desk/call/:sessionId).
 *
 * The Desk calls `useAdvisorAudio(sessionId, humanName)`. `humanName` is set once the server has
 * accepted the human advisor's join (handoff `joined`) and becomes null after the hand-back or when
 * the screen closes. While it is set, this joins the buyer's Agora channel with the advisor uid (the
 * agent only ever subscribes to the buyer), publishes the microphone, and plays the buyer's voice.
 * The Agora SDK loads only at that moment, so the Desk itself stays light.
 */

export type { AdvisorAudioStatus };

export interface AdvisorAudio {
  status: AdvisorAudioStatus;
  /** Plain-language reason when the status is failed or unavailable. */
  detail: string | null;
  muted: boolean;
  toggleMute: () => void;
  /** Optional camera for the advisor; the buyer sees it in the human-advisor tile. */
  camera?: AdvisorAudioSnapshot['camera'];
  toggleCamera?: () => void;
  /** The advisor's own camera, for a self-view. */
  localVideoTrack?: MediaStreamTrack | null;
  /** The buyer's voice (already playing) and camera, when the buyer shares it. */
  buyerAudioTrack?: MediaStreamTrack | null;
  buyerVideoTrack?: MediaStreamTrack | null;
}

const LOAD_FAILED = 'The call audio could not load. Check your connection and join again.';

const IDLE: AdvisorAudioSnapshot = {
  status: 'idle',
  detail: null,
  muted: false,
  camera: 'off',
  localVideoTrack: null,
  buyerAudioTrack: null,
  buyerVideoTrack: null,
};

export function useAdvisorAudio(sessionId: string | undefined, humanName: string | null): AdvisorAudio {
  const [snapshot, setSnapshot] = useState<AdvisorAudioSnapshot>(IDLE);
  const call = useRef<AdvisorCall | null>(null);

  useEffect(() => {
    if (!sessionId || !humanName) {
      setSnapshot(IDLE);
      return;
    }
    let cancelled = false;
    let active: AdvisorCall | null = null;
    setSnapshot({ ...IDLE, status: 'connecting' });
    import('./advisorCall')
      .then(({ AdvisorCall }) => {
        if (cancelled) return;
        active = new AdvisorCall(sessionId, (patch) => {
          if (!cancelled) setSnapshot((s) => ({ ...s, ...patch }));
        });
        call.current = active;
        void active.start();
      })
      .catch(() => {
        if (!cancelled) setSnapshot({ ...IDLE, status: 'failed', detail: LOAD_FAILED });
      });
    return () => {
      cancelled = true;
      call.current = null;
      void active?.stop();
    };
  }, [sessionId, humanName]);

  const toggleMute = useCallback(() => call.current?.toggleMute(), []);
  const toggleCamera = useCallback(() => void call.current?.toggleCamera(), []);

  return useMemo(() => ({ ...snapshot, toggleMute, toggleCamera }), [snapshot, toggleMute, toggleCamera]);
}
