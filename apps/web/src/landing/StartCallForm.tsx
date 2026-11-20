import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, Mic } from 'lucide-react';
import { BuyerSchema, type Buyer } from '@ave/shared';
import { Button, ICON_STROKE, Notice, TextField, type MascotState } from '@/ui';

type FieldName = keyof Buyer;
type Errors = Partial<Record<FieldName, string>>;

/** Indian numbers have 10 digits; allow a country code. */
const PHONE_DIGITS = { min: 10, max: 13 } as const;
const PHONE_CHARS = /^[0-9+\-\s()]+$/;
const FIELDS: FieldName[] = ['name', 'phone', 'email'];

function validate(field: FieldName, raw: string): string | undefined {
  const value = raw.trim();
  switch (field) {
    case 'name':
      if (!value) return 'Please tell us your name.';
      if (!BuyerSchema.shape.name.safeParse(value).success) return 'That name is a little long. Try a shorter version.';
      return undefined;
    case 'phone': {
      if (!value) return 'Add a number for your WhatsApp recap.';
      const digits = value.replace(/\D/g, '').length;
      if (!PHONE_CHARS.test(value) || digits < PHONE_DIGITS.min || digits > PHONE_DIGITS.max) return 'Use a 10-digit mobile number, or add the country code.';
      return undefined;
    }
    case 'email':
      if (!value) return 'Add an email for your recap.';
      if (!BuyerSchema.shape.email.safeParse(value).success) return 'Check this email for a typo.';
      return undefined;
  }
}

/**
 * Name, mobile and email, then a call session is created and the buyer lands on the call screen,
 * where the advisor rings them. `onMood` lets the page's mascot react (thinking while it starts,
 * apologetic if it fails).
 */
export function StartCallForm({ advisor, onMood }: { advisor: string; onMood?: (state: MascotState) => void }) {
  const navigate = useNavigate();
  const [values, setValues] = useState<Record<FieldName, string>>({ name: '', phone: '', email: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const refs = { name: useRef<HTMLInputElement>(null), phone: useRef<HTMLInputElement>(null), email: useRef<HTMLInputElement>(null) };

  const update = (field: FieldName, value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    if (touched[field]) setErrors((e) => ({ ...e, [field]: validate(field, value) }));
  };
  const blur = (field: FieldName) => {
    setTouched((t) => ({ ...t, [field]: true }));
    setErrors((e) => ({ ...e, [field]: validate(field, values[field]) }));
  };

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next: Errors = {};
    for (const f of FIELDS) next[f] = validate(f, values[f]);
    setErrors(next);
    setTouched({ name: true, phone: true, email: true });
    const firstBad = FIELDS.find((f) => next[f]);
    if (firstBad) {
      refs[firstBad].current?.focus();
      return;
    }
    setBusy(true);
    setServerError(null);
    onMood?.('thinking');
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: values.name.trim(), phone: values.phone.trim(), email: values.email.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { sessionId?: string; error?: string };
      if (!res.ok || !body.sessionId) throw new Error(body.error ?? 'The server could not start a call just now.');
      navigate(`/call/${body.sessionId}`);
    } catch (err) {
      const offline = err instanceof TypeError || !navigator.onLine;
      setServerError(offline ? "We can't reach our server. Check your connection and try again." : (err as Error).message);
      onMood?.('apologetic');
      setBusy(false);
    }
  }

  return (
    <form noValidate onSubmit={onSubmit} className="rounded-[24px] border-2 border-ink bg-canvas p-6 shadow-[var(--shadow-pop-lg)]" aria-labelledby="start-title">
      <h3 id="start-title" className="text-xl font-bold">
        Where should {advisor} call you?
      </h3>
      <p className="mt-1 text-sm text-ink-soft">We'll also send your call recap to this email and WhatsApp number.</p>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3.5">
        <TextField
          ref={refs.name}
          className="col-span-2"
          label="Your name"
          name="name"
          autoComplete="name"
          placeholder="Priya Raman"
          value={values.name}
          onChange={(e) => update('name', e.target.value)}
          onBlur={() => blur('name')}
          error={errors.name}
          disabled={busy}
        />
        <TextField
          ref={refs.phone}
          label="Mobile number"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="98450 12345"
          value={values.phone}
          onChange={(e) => update('phone', e.target.value)}
          onBlur={() => blur('phone')}
          error={errors.phone}
          disabled={busy}
        />
        <TextField
          ref={refs.email}
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="priya@example.com"
          value={values.email}
          onChange={(e) => update('email', e.target.value)}
          onBlur={() => blur('email')}
          error={errors.email}
          disabled={busy}
        />
      </div>

      {serverError && <Notice tone="error" className="mt-5" live="assertive" title="Your call didn't start" body={serverError} />}

      <Button type="submit" size="lg" trailingIcon={ArrowRight} busy={busy} className="mt-5 w-full">
        {busy ? 'Setting up your call' : 'Start my tour'}
      </Button>
      <p className="mt-3 flex items-center justify-center gap-1.5 text-[13px] text-ink-soft">
        <Mic size={14} strokeWidth={ICON_STROKE} aria-hidden />
        You'll need a microphone, or you can type your questions.
      </p>
    </form>
  );
}
