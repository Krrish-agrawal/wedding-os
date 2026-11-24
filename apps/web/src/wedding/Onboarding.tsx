import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, ArrowRight, Check, Heart } from 'lucide-react';
import { MAX_GUESTS, formatInr, suggestAllocation } from '@ave/shared';
import { Button, Card, Notice, TextField, cn } from '@/ui';
import { useWedding } from './useWedding';

const STYLES = ['Traditional South Indian', 'North Indian', 'Royal Rajasthani', 'Modern', 'Beach / Outdoor'];
const EVENTS = ['Engagement', 'Haldi', 'Mehendi', 'Sangeet', 'Wedding ceremony', 'Reception'];
const STEPS = ['Couple', 'Date & place', 'Guests & budget', 'Style', 'Events'] as const;

const todayIso = () => new Date().toISOString().slice(0, 10);
const realDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** Welcome questions. Everything is written to the shared WeddingState through validated actions, so every agent can read it. */
export default function Onboarding() {
  const { state, act } = useWedding();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [f, setF] = useState(() => ({
    coupleNames: '', date: '', city: state?.profile.city ?? '', guests: '', budget: '', style: '', events: [] as string[],
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));

  const guests = Number(f.guests);
  const budget = Number(f.budget);
  const problem: (string | null)[] = [
    f.coupleNames.trim().length < 2 ? 'Enter the couple’s names, e.g. Aarav & Meera.' : null,
    f.city.trim() === '' ? 'Enter the city or town.' : f.date !== '' && !realDate(f.date) ? 'Enter a real date.' : null,
    !Number.isInteger(guests) || guests < 1 || guests > MAX_GUESTS ? `Guests must be a whole number from 1 to ${MAX_GUESTS}.` : !Number.isInteger(budget) || budget < 0 ? 'Budget must be a whole number of rupees (0 to skip).' : null,
    f.style.trim() === '' ? 'Pick a style or type your own.' : null,
    null,
  ];
  const past = f.date !== '' && realDate(f.date) && f.date < todayIso();
  const [showProblem, setShowProblem] = useState(false);

  function next() {
    if (problem[step]) { setShowProblem(true); return; }
    setShowProblem(false);
    setStep(step + 1);
  }

  async function finish() {
    setBusy(true); setError(null);
    let err = await act({ type: 'update_profile', patch: { coupleNames: f.coupleNames.trim(), city: f.city.trim(), date: f.date || null, guestCount: guests, style: f.style.trim(), events: f.events, onboarded: true } });
    if (!err && budget > 0) err = await act({ type: 'set_total_budget', total: budget });
    if (!err && budget > 0) err = await act({ type: 'set_allocations', allocations: suggestAllocation(budget) });
    setBusy(false);
    if (err) setError(err); else nav('/');
  }

  const last = step === STEPS.length - 1;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <header className="flex items-center gap-3">
        <span aria-hidden className="grid h-12 w-12 place-items-center rounded-[14px] border-2 border-ink bg-blue text-canvas"><Heart size={22} fill="currentColor" /></span>
        <div><h1 className="font-display text-3xl font-extrabold">Let&rsquo;s plan your wedding</h1><p className="text-ink-soft">A few questions so the planner and every tool start from your details.</p></div>
      </header>
      <ol aria-label="Progress" className="flex gap-1.5">
        {STEPS.map((s, i) => <li key={s} aria-current={i === step ? 'step' : undefined} className={cn('flex-1 rounded-full border-2 px-2 py-1 text-center text-[12px] font-semibold', i < step ? 'border-ink bg-blue-tint' : i === step ? 'border-ink bg-canvas' : 'border-line text-ink-soft')}><span className="sr-only">Step {i + 1}: </span>{s}</li>)}
      </ol>
      <Card className="flex flex-col gap-4 p-5">
        {step === 0 ? <TextField label="Couple" placeholder="Aarav & Meera" value={f.coupleNames} onChange={(e) => set({ coupleNames: e.target.value })} maxLength={80} autoFocus /> : null}
        {step === 1 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="City or town" placeholder="Ramanagara" value={f.city} onChange={(e) => set({ city: e.target.value })} maxLength={80} />
            <TextField label="Wedding date (optional)" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} hint={past ? 'That date is in the past.' : 'You can set it later.'} />
          </div>
        ) : null}
        {step === 2 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Guests" type="number" min={1} max={MAX_GUESTS} value={f.guests} onChange={(e) => set({ guests: e.target.value })} />
            <TextField label="Total budget (₹)" type="number" min={0} value={f.budget} onChange={(e) => set({ budget: e.target.value })} hint={Number.isInteger(budget) && budget > 0 ? `= ${formatInr(budget)}. A guideline split is created; you can change it later.` : 'Enter 0 or leave blank to set it later.'} />
          </div>
        ) : null}
        {step === 3 ? (
          <fieldset className="flex flex-col gap-3"><legend className="mb-1 text-sm font-semibold">Wedding style</legend>
            <div className="flex flex-wrap gap-2">{STYLES.map((s) => <button key={s} type="button" aria-pressed={f.style === s} onClick={() => set({ style: s })} className={cn('rounded-[var(--radius-chip)] border-2 px-3 py-1.5 text-sm font-semibold', f.style === s ? 'border-ink bg-blue-tint' : 'border-line text-ink-soft hover:border-ink')}>{s}</button>)}</div>
            <TextField label="Or describe it" value={STYLES.includes(f.style) ? '' : f.style} onChange={(e) => set({ style: e.target.value })} maxLength={80} />
          </fieldset>
        ) : null}
        {step === 4 ? (
          <fieldset className="flex flex-col gap-2"><legend className="mb-1 text-sm font-semibold">Which events are you planning?</legend>
            {EVENTS.map((e) => <label key={e} className="flex items-center gap-2 text-[15px]"><input type="checkbox" className="h-4 w-4" checked={f.events.includes(e)} onChange={(c) => set({ events: c.target.checked ? [...f.events, e] : f.events.filter((x) => x !== e) })} />{e}</label>)}
          </fieldset>
        ) : null}
        {showProblem && problem[step] ? <p role="alert" className="text-sm font-semibold text-coral-deep">{problem[step]}</p> : null}
        {error ? <Notice tone="error" title="Couldn't save" body={error} live="assertive" /> : null}
        <div className="flex justify-between gap-2">
          <Button variant="ghost" icon={ArrowLeft} disabled={step === 0 || busy} onClick={() => { setShowProblem(false); setStep(step - 1); }}>Back</Button>
          {last ? <Button icon={Check} busy={busy} onClick={() => void finish()}>Finish</Button> : <Button trailingIcon={ArrowRight} onClick={next}>Next</Button>}
        </div>
      </Card>
    </div>
  );
}
