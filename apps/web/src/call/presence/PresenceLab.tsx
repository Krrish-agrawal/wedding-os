import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AudioWaveform, Box, FileAudio, FileBox, Hand, Mic, PersonStanding, ScanFace, Smile, Unplug, Volume2, VolumeX } from 'lucide-react';
import { EXPRESSIONS } from '@ave/shared';
import { Button, Chip, Panel, Pill, cn, type PillTone } from '@/ui';
import { useSessionState } from '@/session/useSession';
import { useAdvisorName } from '../advisor';
import { useAudioLevel } from '../useAudioLevel';
import { useAdvisorPresenceDriver } from './useAdvisorPresenceDriver';
import type { AvatarSource } from './human3d/avatars';
import { PresenceHost, type PresenceHandle, type PresenceStatus } from './PresenceHost';
import { startAudioFile, startMicrophone, startTestVoice, type LabSource } from './lab/signals';
import { PRESENCE_STATES, type PresenceMode, type PresenceState } from './types';

type LabMode = PresenceMode | 'unoptimised' | 'stand-in' | 'missing';
type SourceKind = 'off' | 'voice' | 'mic' | 'file';
type PreviewSize = 'tile' | 'large';

/** The call screen's advisor tile at 1440×900 (rail clamp(340px, 26vw, 400px), tile min(34vh, 300px)), and a close-up. */
const PREVIEW_SIZES: Record<PreviewSize, { width: number; height: number; label: string }> = {
  tile: { width: 374, height: 300, label: 'Call tile' },
  large: { width: 560, height: 450, label: 'Close-up' },
};
/**
 * Avatar files per lab mode. The default (`human3d`) is the call's own order: the Avaturn advisor,
 * then the MPFB stand-in. The others compare the unoptimised files, pin the stand-in, or point at a
 * file that does not exist to watch the fallback.
 */
const LAB_AVATAR_SOURCES: Partial<Record<LabMode, AvatarSource[]>> = {
  unoptimised: [
    { kind: 'avaturn', url: '/avatar/advisor.glb' },
    { kind: 'mpfb', url: '/avatar/mpfb.glb' },
  ],
  'stand-in': [{ kind: 'mpfb', url: '/avatar/mpfb.opt.glb' }],
  missing: [{ kind: 'avaturn', url: '/avatar/missing-on-purpose.glb' }],
};

const MODE_CHIPS: Array<{ id: LabMode; label: string; icon: typeof Box }> = [
  { id: 'human3d', label: '3D avatar', icon: Box },
  { id: 'unoptimised', label: '3D, unoptimised file', icon: FileBox },
  { id: 'stand-in', label: '3D, MPFB stand-in', icon: PersonStanding },
  { id: 'mascot', label: 'Mascot', icon: Smile },
  { id: 'missing', label: '3D, file missing', icon: Unplug },
];

const SOURCE_CHIPS: Array<{ id: Exclude<SourceKind, 'file'>; label: string; icon: typeof Box }> = [
  { id: 'off', label: 'Silent', icon: VolumeX },
  { id: 'voice', label: 'Test voice', icon: AudioWaveform },
  { id: 'mic', label: 'Microphone', icon: Mic },
];

const STATE_LABELS: Record<PresenceState, string> = {
  idle: 'Idle',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  standby: 'Standing by',
};

const BODY_SOURCE_LABELS: Record<'env' | 'file' | 'default', string> = {
  env: 'VITE_AVATAR_BODY',
  file: 'from the file',
  default: 'default',
};

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function statusPill(status: PresenceStatus): { tone: PillTone; label: string; busy?: boolean } {
  switch (status.phase) {
    case 'loading':
      return { tone: 'waiting', label: 'Loading 3D avatar', busy: true };
    case 'ready':
      return { tone: 'live', label: '3D avatar ready' };
    case 'fallback':
      return status.reason === 'mode' ? { tone: 'blue', label: 'Mascot mode' } : { tone: 'warn', label: `Mascot fallback: ${status.reason}` };
  }
}

function Group({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-ink-soft">{label}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
      {hint ? <p className="text-[13px] text-ink-soft">{hint}</p> : null}
    </fieldset>
  );
}

function LevelBar({ level }: { level: number }) {
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full border-2 border-ink bg-canvas" role="meter" aria-label="Input level" aria-valuemin={0} aria-valuemax={1} aria-valuenow={Number(level.toFixed(2))}>
      <div className="h-full bg-blue transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
    </div>
  );
}

/**
 * Studio panel for the advisor's presence: test lip-sync without a live call (test voice,
 * microphone or a local audio file), switch modes, force the fallback, set the agent state,
 * fire every expression, or follow the Director's session.
 */
export function PresenceLab() {
  const handle = useRef<PresenceHandle>(null);
  const name = useAdvisorName();
  const session = useSessionState();
  const [mode, setMode] = useState<LabMode>('human3d');
  const [size, setSize] = useState<PreviewSize>('tile');
  const [manualState, setManualState] = useState<PresenceState>('idle');
  const [follow, setFollow] = useState(false);
  const [status, setStatus] = useState<PresenceStatus>({ phase: 'loading' });
  const [sourceKind, setSourceKind] = useState<SourceKind>('off');
  const [source, setSource] = useState<LabSource | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [audible, setAudible] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const sessionState = useAdvisorPresenceDriver(handle, follow);
  const state = follow ? sessionState : manualState;
  const track = source?.track ?? null;
  const level = useAudioLevel(track);

  useEffect(() => () => source?.stop(), [source]);
  useEffect(() => source?.setAudible(audible), [source, audible]);

  const switchSource = async (kind: SourceKind, file?: File) => {
    setSourceError(null);
    setSource(null);
    setSourceKind(kind);
    try {
      if (kind === 'voice') setSource(await startTestVoice());
      else if (kind === 'mic') setSource(await startMicrophone());
      else if (kind === 'file' && file) setSource(await startAudioFile(file));
    } catch (err) {
      setSourceKind('off');
      const denied = err instanceof DOMException && err.name === 'NotAllowedError';
      setSourceError(denied ? 'Microphone permission was declined.' : err instanceof Error ? err.message : 'That source could not start.');
    }
  };

  const pill = statusPill(status);
  const preview = PREVIEW_SIZES[size];
  const standingBy = state === 'standby';
  const diagnostics = status.phase === 'ready' ? status.diagnostics : null;

  return (
    <Panel
      title="Presence lab"
      subtitle="Avatar, lip-sync and expressions without a live call"
      icon={ScanFace}
      accent="blue"
      actions={
        <Pill tone={pill.tone} busy={pill.busy} dot={!pill.busy} size="sm">
          {pill.label}
        </Pill>
      }
    >
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex flex-col gap-3">
          <div
            className={cn('relative overflow-hidden rounded-[var(--radius-tile)] border-2 border-ink', standingBy ? 'bg-paper' : 'bg-blue-tint')}
            style={{ width: preview.width, height: preview.height }}
          >
            <div className={cn('absolute inset-0 pb-10 transition-opacity', standingBy && 'opacity-60')}>
              <PresenceHost
                ref={handle}
                mode={mode === 'mascot' ? 'mascot' : 'human3d'}
                avatarSources={LAB_AVATAR_SOURCES[mode]}
                track={track}
                state={state}
                title={`${name}, your advisor`}
                onStatus={setStatus}
              />
            </div>
            <div className="absolute inset-x-3 bottom-3 flex items-center gap-2">
              <span className="truncate rounded-[10px] border-2 border-ink bg-canvas px-2.5 py-1 text-sm font-bold">{name}</span>
              <Pill tone="neutral" size="sm">
                {STATE_LABELS[state]}
              </Pill>
            </div>
          </div>
          <div className="flex gap-2">
            {(Object.keys(PREVIEW_SIZES) as PreviewSize[]).map((id) => (
              <Chip key={id} size="sm" label={PREVIEW_SIZES[id].label} selected={size === id} onClick={() => setSize(id)} />
            ))}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
            <dt className="text-ink-soft">Avatar file</dt>
            <dd className="truncate font-mono">{diagnostics?.avatarUrl ?? '—'}</dd>
            <dt className="text-ink-soft">Model</dt>
            <dd>{diagnostics ? `${diagnostics.avatarKind === 'avaturn' ? 'Avaturn' : 'MPFB'} · body ${diagnostics.body} (${BODY_SOURCE_LABELS[diagnostics.bodySource ?? 'default']})` : '—'}</dd>
            {diagnostics?.skipped.length ? (
              <>
                <dt className="text-ink-soft">Skipped</dt>
                <dd className="max-w-[300px] text-[12px]">{diagnostics.skipped.join(' · ')}</dd>
              </>
            ) : null}
            <dt className="text-ink-soft">Load time</dt>
            <dd className="tabular">{diagnostics?.loadMs != null ? `${diagnostics.loadMs} ms` : '—'}</dd>
            {status.phase === 'fallback' && status.reason !== 'mode' ? (
              <>
                <dt className="text-ink-soft">Fallback</dt>
                <dd>{status.detail}</dd>
              </>
            ) : null}
          </dl>
        </div>

        <div className="flex min-w-[300px] flex-1 flex-col gap-5">
          <Group label="Mode">
            {MODE_CHIPS.map((m) => (
              <Chip key={m.id} label={m.label} icon={m.icon} selected={mode === m.id} onClick={() => setMode(m.id)} />
            ))}
          </Group>

          <Group
            label="Advisor's voice"
            hint={sourceError ?? 'The avatar hears this as if it were the advisor’s call audio. The microphone is never played back.'}
          >
            {SOURCE_CHIPS.map((s) => (
              <Chip key={s.id} label={s.label} icon={s.icon} selected={sourceKind === s.id} onClick={() => void switchSource(s.id)} />
            ))}
            <Chip label="Audio file" icon={FileAudio} selected={sourceKind === 'file'} onClick={() => fileInput.current?.click()} />
            <input
              ref={fileInput}
              type="file"
              accept="audio/*"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void switchSource('file', file);
              }}
            />
          </Group>
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              variant="secondary"
              icon={audible ? Volume2 : VolumeX}
              disabled={!source || sourceKind === 'mic'}
              onClick={() => setAudible((a) => !a)}
              aria-pressed={audible}
            >
              {audible ? 'Hearing it' : 'Hear it'}
            </Button>
            <div className="flex-1">
              <LevelBar level={level} />
            </div>
          </div>

          <Group label="Agent state" hint={follow ? 'Following the Director’s session.' : undefined}>
            {PRESENCE_STATES.map((s) => (
              <Chip key={s} size="sm" label={STATE_LABELS[s]} selected={state === s} disabled={follow} onClick={() => setManualState(s)} />
            ))}
          </Group>

          <Group label="Expressions">
            {EXPRESSIONS.map((e) => (
              <Chip key={e} size="sm" label={capitalise(e)} accent="sun" onClick={() => handle.current?.express(e)} />
            ))}
            <Button size="sm" variant="danger" icon={Hand} onClick={() => handle.current?.interrupt()}>
              Interrupt
            </Button>
          </Group>

          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--color-blue)]"
              checked={follow}
              onChange={(e) => setFollow(e.target.checked)}
            />
            Follow the Director&rsquo;s session
            <span className="font-normal text-ink-soft">
              {session ? `(${session.id}, agent ${session.agent.status} / ${session.agent.state})` : '(no session selected)'}
            </span>
          </label>
        </div>
      </div>
      <span className="sr-only" aria-live="polite">
        {pill.label}
      </span>
    </Panel>
  );
}
