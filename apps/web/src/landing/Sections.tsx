import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { ArrowRight, Info, MapPin, Play } from 'lucide-react';
import { formatINRShort, type PropertyBundle } from '@ave/shared';
import { ACCENT_BG, ACCENT_TEXT, ACCENT_TINT, BrandMark, ICON_STROKE, Mascot, buttonClasses, cn, type MascotState } from '@/ui';
import { content } from '@/content';
import { keyFigures } from '@/views/shortlist/figures';
import { CALL_FEATURES, COMING_SOON, INTEGRATIONS, PAINS, SCREEN_FEATURES, STEPS, TEAM_FEATURES, withAdvisor, type Feature } from './copy';
import { StartCallForm } from './StartCallForm';

export const SECTION_IDS = { why: 'why', areas: 'neighbourhoods', features: 'features', how: 'how-it-works', teams: 'for-teams', start: 'start' } as const;

const REVEAL = {
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-80px' },
  transition: { duration: 0.45, ease: [0.2, 0.9, 0.25, 1] as const },
};
const STAGGER_S = 0.06;

function SectionHead({
  eyebrow,
  title,
  body,
  center = false,
  onBlue = false,
}: {
  eyebrow: string;
  title: ReactNode;
  body?: ReactNode;
  center?: boolean;
  /** On a blue section the eyebrow switches to ink so it stays legible. */
  onBlue?: boolean;
}) {
  return (
    <motion.header {...REVEAL} className={cn('max-w-[760px]', center && 'mx-auto text-center')}>
      <p className={cn('text-xs font-extrabold uppercase tracking-[0.14em]', onBlue ? 'text-ink' : 'text-blue-deep')}>{eyebrow}</p>
      <h2 className="mt-3 font-display text-[clamp(34px,3.6vw,54px)] font-extrabold leading-[1.04] tracking-[-0.03em]">{title}</h2>
      {body ? <p className="mt-4 text-lg leading-relaxed text-ink-soft">{body}</p> : null}
    </motion.header>
  );
}

function Shell({ id, className, children }: { id?: string; className?: string; children: ReactNode }) {
  return (
    <section id={id} className={cn('scroll-mt-20 border-b-2 border-ink px-12 py-24 xl:px-16', className)}>
      <div className="mx-auto max-w-[1240px]">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Problem                                                              */
/* ------------------------------------------------------------------ */

export function ProblemSection({ advisor }: { advisor: string }) {
  return (
    <Shell id={SECTION_IDS.why} className="bg-canvas">
      <SectionHead
        eyebrow="Why this exists"
        title={
          <>
            House hunting in Bengaluru eats <span className="text-coral-deep">every weekend.</span>
          </>
        }
        body="Most of a site visit is asking questions and looking at things: the rooms, the plan, the street, the numbers. Very little of it needs you to sit in traffic."
      />
      <div className="mt-12 grid grid-cols-4 gap-5">
        {PAINS.map((p, i) => (
          <motion.article
            key={p.title}
            {...REVEAL}
            transition={{ ...REVEAL.transition, delay: i * STAGGER_S }}
            className="flex flex-col rounded-[var(--radius-tile)] border-2 border-ink bg-canvas p-5 shadow-[var(--shadow-pop)]"
          >
            <div className={cn('grid h-[120px] place-items-center rounded-[18px] border-2 border-ink', ACCENT_TINT[p.accent])}>
              <Mascot state={p.mascot} size={104} shadow={false} />
            </div>
            <h3 className="mt-4 font-display text-xl font-bold leading-tight">{p.title}</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{p.body}</p>
          </motion.article>
        ))}
      </div>

      <motion.div
        {...REVEAL}
        className="mt-12 flex items-center gap-6 rounded-[28px] border-2 border-ink bg-blue p-7 shadow-[var(--shadow-pop-lg)]"
      >
        <div className="grid shrink-0 place-items-center rounded-full border-2 border-ink bg-sun p-2">
          <Mascot state="happy" size={110} shadow={false} />
        </div>
        <div className="min-w-0">
          <p className="font-display text-[clamp(24px,2.2vw,32px)] font-extrabold leading-tight">So we put the whole site visit on one call.</p>
          <p className="mt-2 max-w-[760px] text-[17px] font-medium leading-relaxed">
            {advisor} rings you in the browser, listens, and moves the screen to the right home, room, map or number while you talk. Want a
            person? A human advisor joins the same call.
          </p>
        </div>
        <a href={`#${SECTION_IDS.start}`} className={buttonClasses('secondary', 'lg', 'ml-auto shrink-0')}>
          Try it now
          <ArrowRight size={20} strokeWidth={ICON_STROKE} aria-hidden />
        </a>
      </motion.div>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Neighbourhoods                                                       */
/* ------------------------------------------------------------------ */

function LiveHome({ bundle, index }: { bundle: PropertyBundle; index: number }) {
  const { property } = bundle;
  const price = keyFigures(bundle, []).price;
  return (
    <motion.a
      href={`#${SECTION_IDS.start}`}
      {...REVEAL}
      transition={{ ...REVEAL.transition, delay: index * STAGGER_S }}
      className="group col-span-2 flex overflow-hidden rounded-[var(--radius-tile)] border-2 border-ink bg-canvas shadow-[var(--shadow-pop)] transition-transform duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop-lg)]"
    >
      <div className="relative w-[46%] shrink-0 border-r-2 border-ink">
        <img src={property.heroImage} alt="" className="h-full w-full object-cover" loading="lazy" />
        <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-[var(--radius-chip)] border-2 border-ink bg-mint px-2.5 py-1 text-xs font-extrabold uppercase tracking-[0.06em]">
          <span className="h-2 w-2 rounded-full bg-ink" aria-hidden />
          Live tour
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col p-5">
        <p className="inline-flex items-center gap-1.5 text-sm font-bold text-blue-deep">
          <MapPin size={15} strokeWidth={ICON_STROKE} aria-hidden />
          {property.localityName}
        </p>
        <h3 className="mt-1 font-display text-2xl font-extrabold leading-tight">{property.name}</h3>
        <p className="mt-1 text-[15px] text-ink-soft">
          {property.configuration} · {property.kind === 'sale' ? 'For sale' : 'For lease'}
        </p>
        {price ? (
          <p className="mt-3 font-display text-[26px] font-extrabold leading-none tabular">
            {formatINRShort(price.value)}
            {price.suffix ? <span className="text-base font-bold text-ink-soft">{price.suffix}</span> : null}
            <span className="ml-2 align-middle text-xs font-bold uppercase tracking-[0.06em] text-ink-soft">{price.label}</span>
          </p>
        ) : null}
        <ul className="mt-3 grid gap-1 text-sm">
          {property.highlights.slice(0, 2).map((h) => (
            <li key={h} className="flex gap-2">
              <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue" />
              {h}
            </li>
          ))}
        </ul>
        <span className="mt-auto inline-flex items-center gap-1.5 pt-4 text-sm font-extrabold text-ink">
          <Play size={15} strokeWidth={ICON_STROKE} aria-hidden />
          Tour it on a live call
          <ArrowRight size={15} strokeWidth={ICON_STROKE} aria-hidden className="transition-transform group-hover:translate-x-1" />
        </span>
      </div>
    </motion.a>
  );
}

export function AreasSection({ advisor }: { advisor: string }) {
  return (
    <Shell id={SECTION_IDS.areas} className="bg-paper">
      <div className="flex items-end justify-between gap-8">
        <SectionHead
          eyebrow="Neighbourhoods"
          title="Explore Bengaluru, one neighbourhood at a time."
          body="Homes and offices with everything you would check on a visit: the plan, the light, the street and the paperwork."
        />
        <motion.div {...REVEAL} className="hidden shrink-0 xl:block">
          <Mascot state="love" size={150} />
        </motion.div>
      </div>

      <div className="mt-12 grid grid-cols-4 gap-5">
        {content.properties.map((b, i) => (
          <LiveHome key={b.property.id} bundle={b} index={i} />
        ))}
        {COMING_SOON.map((n, i) => (
          <motion.article
            key={n.name}
            {...REVEAL}
            transition={{ ...REVEAL.transition, delay: (i + 2) * STAGGER_S }}
            className="relative flex min-h-[148px] flex-col overflow-hidden rounded-[var(--radius-tile)] border-2 border-ink bg-canvas p-5"
          >
            <span aria-hidden className={cn('absolute -right-6 -top-6 h-20 w-20 rounded-full border-2 border-ink', ACCENT_BG[n.accent])} />
            <p className={cn('inline-flex items-center gap-1.5 text-sm font-bold', ACCENT_TEXT[n.accent])}>
              <MapPin size={15} strokeWidth={ICON_STROKE} aria-hidden />
              Bengaluru
            </p>
            <h3 className="mt-1 font-display text-[22px] font-extrabold leading-tight">{n.name}</h3>
            <p className="mt-1 text-sm leading-snug text-ink-soft">{n.vibe}</p>
            <span className="mt-auto self-start rounded-[var(--radius-chip)] border-2 border-ink bg-paper px-2.5 py-0.5 text-xs font-bold">Coming soon</span>
          </motion.article>
        ))}
        <motion.a
          href={`#${SECTION_IDS.start}`}
          {...REVEAL}
          className="col-span-2 flex items-center gap-5 rounded-[var(--radius-tile)] border-2 border-dashed border-ink bg-blue-tint p-5 transition-colors hover:bg-canvas"
        >
          <Mascot state="wink" size={104} shadow={false} />
          <div className="min-w-0">
            <h3 className="font-display text-[22px] font-extrabold leading-tight">Don't see your area?</h3>
            <p className="mt-1 text-[15px] leading-snug text-ink-soft">
              Tell {advisor} where you work and what you need. It goes on your lead, so the team can follow up.
            </p>
          </div>
          <ArrowRight size={22} strokeWidth={ICON_STROKE} aria-hidden className="ml-auto shrink-0" />
        </motion.a>
      </div>
      <p className="mt-6 flex items-center gap-2 text-sm text-ink-soft">
        <Info size={15} strokeWidth={ICON_STROKE} aria-hidden />
        Two sample homes are open for live tours today. The other neighbourhoods are on the way.
      </p>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Features                                                             */
/* ------------------------------------------------------------------ */

function FeatureCard({ feature, advisor, index, size = 'md' }: { feature: Feature; advisor: string; index: number; size?: 'md' | 'lg' }) {
  const Icon = feature.icon;
  return (
    <motion.article
      {...REVEAL}
      transition={{ ...REVEAL.transition, delay: (index % 4) * STAGGER_S }}
      className={cn('flex gap-4 rounded-[var(--radius-tile)] border-2 border-ink bg-canvas p-5', size === 'lg' && 'shadow-[var(--shadow-pop)]')}
    >
      <span className={cn('grid h-12 w-12 shrink-0 place-items-center rounded-[14px] border-2 border-ink', ACCENT_BG[feature.accent])}>
        <Icon size={22} strokeWidth={ICON_STROKE} aria-hidden />
      </span>
      <div className="min-w-0">
        <h3 className="font-display text-lg font-bold leading-tight">{withAdvisor(feature.title, advisor)}</h3>
        <p className="mt-1 text-[15px] leading-relaxed text-ink-soft">{withAdvisor(feature.body, advisor)}</p>
      </div>
    </motion.article>
  );
}

export function FeaturesSection({ advisor }: { advisor: string }) {
  return (
    <Shell id={SECTION_IDS.features} className="bg-canvas">
      <SectionHead
        eyebrow="Features"
        title={
          <>
            Everything you'd ask on a site visit, <span className="text-blue-deep">on one call.</span>
          </>
        }
        body={`Say it out loud and ${advisor} puts it on your screen. Nine views, one conversation.`}
      />
      <div className="mt-12 grid grid-cols-3 gap-4">
        {SCREEN_FEATURES.map((f, i) => (
          <FeatureCard key={f.title} feature={f} advisor={advisor} index={i} />
        ))}
      </div>

      <div className="mt-16 grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-10">
        <motion.div {...REVEAL} className="relative grid place-items-center rounded-[32px] border-2 border-ink bg-grape-tint py-10 shadow-[var(--shadow-pop-lg)]">
          <div className="flex items-end gap-2">
            <Mascot state="speaking" size={170} />
            <Mascot state="cool" size={120} />
          </div>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {['English', 'हिन्दी', 'ಕನ್ನಡ'].map((l) => (
              <span key={l} className="rounded-[var(--radius-chip)] border-2 border-ink bg-canvas px-3.5 py-1 text-[15px] font-bold shadow-[var(--shadow-pop-sm)]">
                {l}
              </span>
            ))}
          </div>
        </motion.div>
        <div>
          <SectionHead eyebrow="The call" title="A real conversation, not a chatbot form." />
          <div className="mt-8 grid grid-cols-2 gap-4">
            {CALL_FEATURES.map((f, i) => (
              <FeatureCard key={f.title} feature={f} advisor={advisor} index={i} size="lg" />
            ))}
          </div>
        </div>
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* How it works                                                         */
/* ------------------------------------------------------------------ */

export function HowSection({ advisor }: { advisor: string }) {
  return (
    <Shell id={SECTION_IDS.how} className="bg-blue">
      <SectionHead eyebrow="How it works" title="Three steps, about ten minutes." center onBlue />
      <ol className="mt-14 grid grid-cols-3 gap-6">
        {STEPS.map((s, i) => (
          <motion.li
            key={s.title}
            {...REVEAL}
            transition={{ ...REVEAL.transition, delay: i * STAGGER_S * 2 }}
            className="relative flex flex-col items-center rounded-[28px] border-2 border-ink bg-canvas px-6 pb-7 pt-6 text-center shadow-[var(--shadow-pop-lg)]"
          >
            <span className="absolute -top-5 left-6 grid h-11 w-11 place-items-center rounded-full border-2 border-ink bg-sun font-display text-xl font-extrabold">
              {i + 1}
            </span>
            <Mascot state={s.mascot as MascotState} size={130} />
            <h3 className="mt-3 font-display text-2xl font-extrabold leading-tight">{withAdvisor(s.title, advisor)}</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{s.body}</p>
          </motion.li>
        ))}
      </ol>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* For teams                                                            */
/* ------------------------------------------------------------------ */

export function TeamsSection() {
  return (
    <Shell id={SECTION_IDS.teams} className="bg-paper">
      <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-center gap-14">
        <div>
          <SectionHead
            eyebrow="For sales teams"
            title="Your team sees every call, live."
            body="The Lead Desk shows live calls, scores every lead, and keeps your tools in sync without anyone copying notes."
          />
          <div className="mt-8 grid grid-cols-2 gap-4">
            {TEAM_FEATURES.map((f, i) => (
              <FeatureCard key={f.title} feature={f} advisor="" index={i} />
            ))}
          </div>
          <motion.div {...REVEAL} className="mt-8 flex flex-wrap items-center gap-2">
            <span className="mr-1 text-sm font-bold text-ink-soft">Sends to</span>
            {INTEGRATIONS.map((n) => (
              <span key={n} className="rounded-[var(--radius-chip)] border-2 border-ink bg-canvas px-3 py-1 text-sm font-bold">
                {n}
              </span>
            ))}
            <Link to="/desk" className={buttonClasses('secondary', 'md', 'ml-auto')}>
              Open the Lead Desk
              <ArrowRight size={18} strokeWidth={ICON_STROKE} aria-hidden />
            </Link>
          </motion.div>
        </div>

        <motion.div {...REVEAL} className="relative" aria-hidden>
          {/* A sketch of the Desk's incoming-call alert, not a live screen. */}
          <div className="rounded-[28px] border-2 border-ink bg-canvas p-6 shadow-[var(--shadow-pop-lg)]">
            <p className="inline-flex items-center gap-2 rounded-[var(--radius-chip)] border-2 border-ink bg-coral-tint px-3 py-1 text-xs font-extrabold uppercase tracking-[0.08em]">
              <span className="h-2 w-2 animate-pulse rounded-full bg-coral" />
              Incoming call for a person
            </p>
            <div className="mt-4 flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-full border-2 border-ink bg-grape font-display text-lg font-extrabold">AR</span>
              <div>
                <p className="font-display text-xl font-extrabold leading-tight">Ananya wants to talk to you</p>
                <p className="text-sm text-ink-soft">Larkspur Court · Indiranagar</p>
              </div>
            </div>
            <p className="mt-4 rounded-[14px] border-2 border-ink bg-sun-tint px-4 py-3 text-[15px] font-semibold">“Can we talk about the price with a person?”</p>
            <div className="mt-4 rounded-[14px] border-2 border-line p-4">
              <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-blue-deep">Live notes</p>
              <ul className="mt-2 grid gap-1.5 text-sm">
                <li>• Budget 5.5 crore, moving in 6 months</li>
                <li>
                  • Wants the clubhouse fee waived <span className="ml-1 rounded-[6px] bg-coral-tint px-1.5 py-0.5 text-xs font-bold text-coral-deep">Needs approval</span>
                </li>
                <li>• Send the price breakup on WhatsApp</li>
              </ul>
            </div>
          </div>
          <div className="absolute -bottom-10 -right-6">
            <Mascot state="cool" size={130} />
          </div>
        </motion.div>
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Start a call                                                         */
/* ------------------------------------------------------------------ */

export function StartSection({ advisor, mascot, onMood }: { advisor: string; mascot: MascotState; onMood: (state: MascotState) => void }) {
  return (
    <Shell id={SECTION_IDS.start} className="bg-sun-tint">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-14">
        <div>
          <SectionHead
            eyebrow="Start your tour"
            title={
              <>
                {advisor} is ready when <span className="text-blue-deep">you are.</span>
              </>
            }
            body="Leave your details and you'll get a call right here in your browser. Talk in English, Hindi or Kannada."
          />
          <motion.div {...REVEAL} className="mt-10 flex items-end gap-4">
            <div className="grid shrink-0 place-items-center rounded-full border-2 border-ink bg-blue p-3 shadow-[var(--shadow-pop)]">
              <Mascot state={mascot} size={170} alive title={`${advisor}, your advisor`} />
            </div>
            <p className="mb-6 rounded-[18px] border-2 border-ink bg-canvas px-4 py-3 text-[15px] font-bold leading-snug shadow-[var(--shadow-pop)]">
              Ask me anything: the rooms, the EMI, the commute, even which way the kitchen faces.
            </p>
          </motion.div>
        </div>
        <motion.div {...REVEAL}>
          <StartCallForm advisor={advisor} onMood={onMood} />
          <p className="mt-5 flex items-start gap-2 text-[13px] leading-relaxed text-ink-soft">
            <Info size={15} strokeWidth={ICON_STROKE} aria-hidden className="mt-0.5 shrink-0" />
            This is a demo with sample properties and fictional listings. Your details are used to send your call recap and are visible to our
            advisors.
          </p>
        </motion.div>
      </div>
    </Shell>
  );
}

export function Footer() {
  return (
    <footer className="bg-canvas px-12 py-10 xl:px-16">
      <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-8">
        <BrandMark size="md" />
        <p className="text-right text-sm leading-relaxed text-ink-soft">
          Voice by Agora Conversational AI and Murf Falcon.
          <br />
          Made in Bengaluru for the Build with Agora hackathon.
        </p>
      </div>
    </footer>
  );
}
