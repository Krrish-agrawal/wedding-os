import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { MotionConfig, motion } from 'motion/react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { BrandMark, ICON_STROKE, buttonClasses, type MascotState } from '@/ui';
import { useAdvisorName } from '@/call/advisor';
import { HeroScene } from '@/landing/HeroScene';
import { AreasSection, FeaturesSection, Footer, HowSection, ProblemSection, SECTION_IDS, StartSection, TeamsSection } from '@/landing/Sections';

const NAV_LINKS = [
  { id: SECTION_IDS.why, label: 'Why' },
  { id: SECTION_IDS.areas, label: 'Neighbourhoods' },
  { id: SECTION_IDS.features, label: 'Features' },
  { id: SECTION_IDS.how, label: 'How it works' },
  { id: SECTION_IDS.teams, label: 'For teams' },
] as const;

const EASE = [0.2, 0.9, 0.25, 1] as const;

/** Agora's official wordmark, from agora.io (see assets/brand/README.md). */
const AGORA_LOGO_SRC = '/brand/agora-logo.svg';

/**
 * Landing (/): a big brand hero with the mascot sitting on a Bengaluru rooftop, then the problem,
 * the neighbourhoods, everything the call can show, how it works, the sales-team side, and the form
 * that starts a call.
 */
export default function Landing() {
  const advisor = useAdvisorName();
  const [startMood, setStartMood] = useState<MascotState>('wink');

  // In-page links glide to their section while the landing page is open.
  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.scrollBehavior;
    root.style.scrollBehavior = 'smooth';
    return () => {
      root.style.scrollBehavior = before;
    };
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-full bg-canvas">
        <nav className="sticky top-0 z-40 border-b-2 border-ink bg-canvas/90 backdrop-blur-sm">
          <div className="mx-auto flex h-[68px] max-w-[1336px] items-center gap-6 px-12">
            <a href="#top" aria-label="Agora Virtual Estates, back to top">
              <BrandMark size="sm" />
            </a>
            <ul className="ml-auto flex items-center gap-1">
              {NAV_LINKS.map((l) => (
                <li key={l.id}>
                  <a href={`#${l.id}`} className="rounded-[10px] px-3 py-2 text-[15px] font-semibold text-ink-soft transition-colors hover:bg-paper hover:text-ink">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
            <Link to="/desk" className={buttonClasses('ghost', 'sm')}>
              Lead Desk
            </Link>
            <a href={`#${SECTION_IDS.start}`} className={buttonClasses('primary', 'sm')}>
              Start a live tour
            </a>
          </div>
        </nav>

        <header id="top" className="relative overflow-hidden border-b-2 border-ink bg-blue-tint">
          <div className="relative z-10 mx-auto max-w-[1336px] px-12 pt-12">
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: EASE }}
              className="inline-flex items-center gap-2 rounded-[var(--radius-chip)] border-2 border-ink bg-canvas px-3.5 py-1.5 text-sm font-bold shadow-[var(--shadow-pop-sm)]"
            >
              <Sparkles size={16} strokeWidth={ICON_STROKE} aria-hidden className="text-blue-deep" />
              Live AI property tours in Bengaluru
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.05, ease: EASE }}
              className="mt-5 font-display text-[clamp(76px,9.4vw,150px)] font-extrabold leading-[0.88] tracking-[-0.045em] short:text-[clamp(64px,7.6vw,120px)]"
            >
              {/* The logo's "g" hangs well below its baseline, so it gets its own block line. */}
              <img
                src={AGORA_LOGO_SRC}
                alt="Agora"
                draggable={false}
                className="-ml-[0.02em] mb-[0.06em] block h-[1.15em] w-auto select-none"
              />
              Virtual Estates
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.12, ease: EASE }}
              className="mt-6 max-w-[540px] text-[19px] font-medium leading-relaxed text-ink"
            >
              Tour homes and offices across Bengaluru on a live call. {advisor} talks you through them and shows you everything on screen.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.18, ease: EASE }}
              className="mt-7 flex items-center gap-3"
            >
              <a href={`#${SECTION_IDS.start}`} className={buttonClasses('primary', 'lg')}>
                Start a live tour
                <ArrowRight size={20} strokeWidth={ICON_STROKE} aria-hidden />
              </a>
              <a href={`#${SECTION_IDS.features}`} className={buttonClasses('secondary', 'lg')}>
                See what it can do
              </a>
            </motion.div>
          </div>
          {/* The skyline rises behind the end of the copy, so the mascot sits beside the buttons. */}
          <div className="relative -mt-[clamp(110px,13vw,200px)]">
            <HeroScene advisor={advisor} />
          </div>
        </header>

        <ProblemSection advisor={advisor} />
        <AreasSection advisor={advisor} />
        <FeaturesSection advisor={advisor} />
        <HowSection advisor={advisor} />
        <TeamsSection />
        <StartSection advisor={advisor} mascot={startMood} onMood={setStartMood} />
        <Footer />
      </div>
    </MotionConfig>
  );
}
