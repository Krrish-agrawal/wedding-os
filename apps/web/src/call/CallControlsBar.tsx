import { useEffect, useRef, useState, type ComponentType } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Headset, Keyboard, Mic, MicOff, PhoneOff, Video, VideoOff, type LucideProps } from 'lucide-react';
import type { SessionAction, SessionState } from '@ave/shared';
import { Button, ICON_STROKE, cn, toast } from '@/ui';
import { useCallControls, type MicState } from './controls';
import { useCallUi } from './callUi';

type Tone = 'idle' | 'on' | 'off' | 'blocked' | 'danger';

const TONE: Record<Tone, string> = {
  idle: 'border-line bg-canvas hover:border-ink',
  on: 'border-ink bg-blue-tint',
  off: 'border-ink bg-coral-tint',
  blocked: 'border-line bg-paper text-ink-soft',
  danger: 'border-ink bg-coral shadow-[var(--shadow-pop-sm)] hover:-translate-y-px hover:shadow-[var(--shadow-pop)] active:translate-y-0.5 active:shadow-none',
};

interface ControlButtonProps {
  icon: ComponentType<LucideProps>;
  label: string;
  /** Longer accessible description, e.g. why the control is blocked. */
  hint?: string;
  tone: Tone;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

function ControlButton({ icon: Icon, label, hint, tone, pressed, disabled, onClick }: ControlButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      title={hint ?? label}
      className={cn(
        'flex h-[62px] min-w-0 flex-col items-center justify-center gap-1 rounded-[16px] border-2 px-1 text-[11.5px] font-bold text-ink',
        'transition-[transform,box-shadow,border-color,background-color] duration-100 ease-[var(--ease-snap)] active:translate-y-px',
        'disabled:cursor-not-allowed disabled:opacity-50',
        TONE[tone],
      )}
    >
      <Icon size={20} strokeWidth={ICON_STROKE} aria-hidden />
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
}

function micControl(mic: MicState): { icon: ComponentType<LucideProps>; label: string; hint?: string; tone: Tone } {
  switch (mic) {
    case 'on':
      return { icon: Mic, label: 'Mute', tone: 'idle' };
    case 'muted':
      return { icon: MicOff, label: 'Unmute', tone: 'off' };
    case 'requesting':
      return { icon: Mic, label: 'Allow mic', hint: 'Waiting for microphone permission', tone: 'idle' };
    case 'denied':
      return { icon: MicOff, label: 'Blocked', hint: 'Microphone is blocked in your browser settings', tone: 'blocked' };
    case 'off':
      return { icon: MicOff, label: 'Mic off', hint: 'Microphone is not connected', tone: 'blocked' };
  }
}

interface CallControlsBarProps {
  state: SessionState;
  dispatch: (action: SessionAction) => void;
  /** Ends the call for everyone and moves to the summary. */
  onEnd: () => Promise<void>;
}

/** Mute, camera, type, human, end. Lives at the bottom of the presence rail. */
export function CallControlsBar({ state, dispatch, onEnd }: CallControlsBarProps) {
  const mic = useCallControls((s) => s.mic);
  const camera = useCallControls((s) => s.camera);
  const typing = useCallUi((s) => s.typing);
  const setTyping = useCallUi((s) => s.setTyping);
  const [asking, setAsking] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const micUi = micControl(mic);
  const handoff = state.handoff.status;
  const humanBusy = handoff === 'requested' || handoff === 'joined';

  const onMic = () => {
    if (mic === 'denied' || mic === 'off') {
      setTyping(true);
      if (mic === 'denied') toast('Your microphone is blocked', { body: 'Allow it from the address bar, or keep typing.' });
      return;
    }
    useCallControls.getState().toggleMute();
  };

  const onCamera = () => {
    if (camera === 'denied') {
      toast('Your camera is blocked', { body: 'Allow it from the address bar to show your video. The call works without it.' });
      return;
    }
    useCallControls.getState().toggleCamera();
  };

  const onHuman = async () => {
    if (humanBusy || asking) return;
    setAsking(true);
    try {
      await useCallControls.getState().requestHuman();
    } catch {
      // Voice is not up: ring the Lead Desk through the session so the request is never lost.
      dispatch({ type: 'set_handoff', patch: { status: 'requested', reason: 'Buyer asked to talk to a human advisor', requestedAt: Date.now() } });
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="relative">
      <div className="grid grid-cols-5 gap-2" role="toolbar" aria-label="Call controls">
        <ControlButton {...micUi} pressed={mic === 'muted'} onClick={onMic} />
        <ControlButton
          icon={camera === 'on' ? Video : VideoOff}
          label={camera === 'denied' ? 'Blocked' : 'Camera'}
          hint={camera === 'on' ? 'Turn your camera off' : camera === 'denied' ? 'Camera is blocked in your browser settings' : 'Turn your camera on'}
          tone={camera === 'on' ? 'on' : camera === 'denied' ? 'blocked' : 'idle'}
          pressed={camera === 'on'}
          onClick={onCamera}
        />
        <ControlButton icon={Keyboard} label="Type" hint="Type instead of talking" tone={typing ? 'on' : 'idle'} pressed={typing} onClick={() => setTyping(!typing)} />
        <ControlButton
          icon={Headset}
          label={handoff === 'joined' ? 'Joined' : handoff === 'requested' ? 'Calling…' : 'Human'}
          hint="Talk to a human advisor"
          tone={humanBusy ? 'on' : 'idle'}
          disabled={humanBusy || asking}
          onClick={() => void onHuman()}
        />
        <ControlButton icon={PhoneOff} label="End" hint="End the call" tone="danger" onClick={() => setConfirmEnd(true)} />
      </div>
      <AnimatePresence>{confirmEnd && <EndConfirm onCancel={() => setConfirmEnd(false)} onEnd={onEnd} />}</AnimatePresence>
    </div>
  );
}

function EndConfirm({ onCancel, onEnd }: { onCancel: () => void; onEnd: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    keep.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <motion.div
      role="alertdialog"
      aria-labelledby="end-call-title"
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.1 } }}
      transition={{ type: 'spring', stiffness: 520, damping: 34 }}
      className="absolute inset-x-0 bottom-[calc(100%+10px)] z-30 rounded-[18px] border-2 border-ink bg-canvas p-4 shadow-[var(--shadow-pop)]"
    >
      <p id="end-call-title" className="font-display text-lg font-bold leading-tight">
        End the call?
      </p>
      <p className="mt-1 text-sm text-ink-soft">You'll see a recap of what you looked at.</p>
      <div className="mt-3 flex gap-2">
        <Button
          variant="danger"
          size="sm"
          icon={PhoneOff}
          busy={busy}
          onClick={async () => {
            setBusy(true);
            await onEnd();
          }}
        >
          End call
        </Button>
        <Button ref={keep} variant="secondary" size="sm" onClick={onCancel}>
          Keep talking
        </Button>
      </div>
    </motion.div>
  );
}
