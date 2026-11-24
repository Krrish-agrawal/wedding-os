import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, Hourglass, Mic, SendHorizontal, Square } from 'lucide-react';
import { Button, ICON_STROKE, Notice, Pill, Spinner } from '@/ui';
import { useWedding } from './useWedding';
import type { ChatStep } from './types';

export const SUGGESTIONS = [
  'Create a traditional South Indian wedding with a gold mandap and yellow flowers',
  'Change the flowers to white and add more arrangements',
  'Move the mandap slightly to the left',
  'Keep the decoration budget below ₹2 lakhs',
  'Undo the last change',
  'Save this design as Plan A',
];

const SPECIALIST: Record<string, string> = { decoration: 'Decoration', budget: 'Budget', venue: 'Venue', vendor: 'Vendors', fashion: 'Outfits' };

/** Push-to-talk: records up to 25 s (Sarvam's REST limit is 30 s) and hands the audio to the server. Shown only when voice is on and configured. */
function MicButton({ disabled, onAudio }: { disabled: boolean; onAudio: (b: Blob, lang: string) => void }) {
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [lang, setLang] = useState('en-IN');
  const [err, setErr] = useState<string | null>(null);
  async function toggle() {
    if (rec) { rec.stop(); return; }
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => chunks.push(e.data);
      const timer = setTimeout(() => r.state === 'recording' && r.stop(), 25_000);
      r.onstop = () => { clearTimeout(timer); stream.getTracks().forEach((t) => t.stop()); setRec(null); onAudio(new Blob(chunks, { type: r.mimeType || 'audio/webm' }), lang); };
      r.start();
      setRec(r);
    } catch { setErr('Microphone not available. Allow access in the browser, or type instead.'); }
  }
  return (
    <div className="flex items-center gap-1.5">
      <select aria-label="Speech language" value={lang} onChange={(e) => setLang(e.target.value)} disabled={Boolean(rec)} className="h-12 rounded-[var(--radius-control)] border-2 border-ink/25 bg-canvas px-2 text-sm font-semibold">
        <option value="en-IN">English</option><option value="kn-IN">ಕನ್ನಡ</option><option value="unknown">Auto</option>
      </select>
      <Button type="button" variant={rec ? 'danger' : 'secondary'} icon={rec ? Square : Mic} disabled={disabled && !rec} onClick={() => void toggle()} aria-pressed={Boolean(rec)}>{rec ? 'Stop' : 'Speak'}</Button>
      {err ? <span role="alert" className="text-[12px] text-coral-deep">{err}</span> : null}
    </div>
  );
}

function Step({ s }: { s: ChatStep }) {
  return (
    <li className="flex flex-col gap-0.5 text-[13px]">
      <span className="flex items-center gap-2">
        {s.status === 'running' ? <Spinner size={14} /> : s.status === 'pending' ? <Hourglass size={14} strokeWidth={ICON_STROKE} className="text-tangerine-deep" aria-label="waiting for you" /> : s.status === 'ok' ? <Check size={14} strokeWidth={ICON_STROKE} className="text-mint-deep" aria-label="done" /> : <CircleAlert size={14} strokeWidth={ICON_STROKE} className="text-coral-deep" aria-label="failed" />}
        <span className={s.status === 'running' ? 'font-semibold' : 'text-ink-soft'}>{s.status === 'running' ? `${s.label}…` : s.label}</span>
        {s.specialist ? <span className="rounded-full bg-paper px-2 py-0.5 text-[11px] font-semibold text-ink-soft">{SPECIALIST[s.specialist] ?? s.specialist}</span> : null}
      </span>
      {s.status === 'pending' ? <span className="ml-6 font-semibold text-tangerine-deep">Waiting for your confirmation: {s.summary}</span> : null}
      {s.status === 'ok' && s.summary ? <span className="ml-6 text-ink-soft">{s.summary}</span> : null}
      {s.status === 'error' ? (
        <span className="ml-6 text-coral-deep">
          {s.error}
          {s.hint ? <span className="block text-ink-soft">What to do: {s.hint}</span> : null}
        </span>
      ) : null}
    </li>
  );
}

/** The planner conversation: your request, each tool the planner runs as it runs, and its reply. Used on the Planner page and inside the studio. */
export default function ChatPanel({ compact = false, suggestions = SUGGESTIONS }: { compact?: boolean; suggestions?: readonly string[] }) {
  const { messages, send, sendVoice, sending, meta, flags, loadFlags, proposals, proposalNotice, confirmProposal, cancelProposal } = useWedding();
  useEffect(() => { void loadFlags(); }, [loadFlags]);
  const voiceOn = Boolean(flags?.flags['voice.sarvam'] && flags.voiceConfigured);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  // Block body on purpose: scrollIntoView can return a Promise, which React would mistake for a cleanup function.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  function submit(t: string) {
    if (!t.trim() || sending) return;
    setText('');
    void send(t);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {meta?.plannerMode === 'demo' ? (
        <Notice tone="waiting" title="Demo mode (no AI key)" body="Simple requests are matched by rules and run through the same validated tools. Anything it cannot do, it says so. Add OPENAI_API_KEY to the server for open-ended conversation." live="off" />
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-[var(--radius-card)] border-2 border-line bg-canvas p-3 scroll-quiet" aria-live="polite" aria-label="Conversation">
        {messages.length === 0 ? (
          <div className="m-auto max-w-sm text-center text-ink-soft">
            <p className="font-semibold text-ink">Tell me about your wedding.</p>
            <p className="mt-1 text-sm">I can design the 3D venue, keep to your decoration budget and track costs. Everything I change appears live.</p>
          </div>
        ) : null}
        {messages.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'self-end' : 'self-start'}>
            {m.role === 'user' ? (
              <div className="max-w-[28rem] whitespace-pre-wrap rounded-[16px] border-2 border-ink bg-blue-tint px-3.5 py-2 text-[15px]">{m.text}</div>
            ) : (
              <div className={`flex max-w-[34rem] flex-col gap-2 rounded-[16px] border-2 px-3.5 py-2.5 text-[15px] ${m.error ? 'border-coral-deep bg-coral-tint' : 'border-line bg-canvas'}`}>
                {m.steps && m.steps.length > 0 ? <ul className="flex flex-col gap-1.5" aria-label="Planner steps">{m.steps.map((s) => <Step key={s.id} s={s} />)}</ul> : null}
                {m.pending && !m.steps?.length ? <span className="flex items-center gap-2 text-sm text-ink-soft"><Spinner size={14} />Thinking…</span> : null}
                {m.text ? <p className="whitespace-pre-wrap">{m.text}</p> : null}
              </div>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>
      {proposalNotice ? <Notice tone="warn" title="That proposal can no longer be applied" body={proposalNotice} live="polite" /> : null}
      {proposals.length > 0 ? (
        <section aria-label="Waiting for your confirmation" className="flex flex-col gap-2">
          {proposals.map((p) => (
            <div key={p.id} className="flex flex-col gap-2 rounded-[16px] border-2 border-ink bg-sun-tint p-3">
              <p className="text-sm font-bold">Waiting for your confirmation</p>
              <p className="text-[15px]">{p.summary}</p>
              <ul className="flex flex-col gap-0.5 text-[13px]">
                {p.changes.map((c) => <li key={c.label}><span className="text-ink-soft">{c.label}:</span> <span className="line-through decoration-ink/40">{c.from}</span> → <strong>{c.to}</strong></li>)}
              </ul>
              <p className="text-xs text-ink-soft">Nothing has changed yet. Expires in about {Math.max(1, Math.round((p.expiresAt - Date.now()) / 60000))} min.</p>
              <div className="flex gap-2">
                <Button variant="confirm" icon={Check} onClick={() => void confirmProposal(p.id)}>Confirm</Button>
                <Button variant="secondary" onClick={() => void cancelProposal(p.id)}>Cancel</Button>
              </div>
            </div>
          ))}
        </section>
      ) : null}
      {!compact || messages.length === 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.slice(0, compact ? 4 : 6).map((s) => (
            <button key={s} type="button" disabled={sending} onClick={() => submit(s)} className="rounded-[var(--radius-chip)] border-2 border-line bg-canvas px-3 py-1.5 text-left text-[13px] font-semibold text-ink-soft transition-colors hover:border-ink hover:text-ink disabled:opacity-50">{s}</button>
          ))}
        </div>
      ) : null}
      <form onSubmit={(e) => { e.preventDefault(); submit(text); }} className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="Ask the planner…" aria-label="Message the planner" className="h-12 min-w-0 flex-1 rounded-[var(--radius-control)] border-2 border-ink/25 bg-canvas px-4 outline-none focus:border-ink" />
        <Button type="submit" busy={sending} disabled={!text.trim()} trailingIcon={SendHorizontal}>Send</Button>
      </form>
      {voiceOn ? <MicButton disabled={sending} onAudio={(b, l) => void sendVoice(b, l)} /> : flags && flags.flags['voice.sarvam'] && !flags.voiceConfigured ? <p className="text-[12px] text-ink-soft">Voice input needs SARVAM_API_KEY on the server.</p> : null}
      {meta ? <p className="hidden"><Pill>{meta.plannerMode}</Pill></p> : null}
    </div>
  );
}
