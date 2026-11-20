import type { ReactNode } from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { C, FONT, OUTLINE, RADIUS } from '../brand';
import { BRAND, CALL, MONTAGE, PROPERTIES, type ViewId } from '../content';
import { Mascot, type Cue } from '../mascot/Mascot';
import { pop, progress, sec, settle, SMOOTH, typedCount, typeFrames, wobble } from '../lib/anim';
import { MONTAGE_STEP_LENGTHS, SCENE_LENGTHS, VIDEO } from '../timeline';
import { Background } from '../ui/Background';
import { Card, Chip, Icon, Waveform } from '../ui/kit';
import { TypeLine } from '../ui/Type';
import { BlueprintView } from '../views/Blueprint';
import { BookingView } from '../views/Booking';
import { LegalView } from '../views/Legal';
import { LocalityView } from '../views/Locality';
import { PickerView } from '../views/Picker';
import { PricingView } from '../views/Pricing';
import { STAGE } from '../views/stage';
import { SunView } from '../views/Sun';
import { TourView } from '../views/Tour';

/**
 * The call and the montage share one continuous app window: the buyer picks a home, then asks seven
 * questions, and the advisor switches the stage to the matching view each time.
 */

const LAYOUT = { bar: 64, pad: 24, rail: 420, dock: 76 };
/** The window wraps the stage (plus its outline), the dock and the rail, inside its own outline. */
const WINDOW = {
  ...LAYOUT,
  w: STAGE.w + 2 * OUTLINE + LAYOUT.rail + 3 * LAYOUT.pad + 2 * OUTLINE,
  h: LAYOUT.bar + STAGE.h + 2 * OUTLINE + LAYOUT.dock + 2 * LAYOUT.pad + 2 * OUTLINE,
};
const VIEW_SWAP_FRAMES = 12;
const CAPTION_RATE = 34;

/** Beats inside the call intro (frames from scene start). */
const CALL_BEATS = { headline: 10, you: 24, select: 48, shivam: 56 };
/** Beats inside each montage step (frames from step start). */
const STEP_BEATS = { you: 2, swap: 14, shivam: 24 };

const VIEWS: Record<ViewId, (p: { t: number }) => ReactNode> = {
  tour: TourView,
  blueprint: BlueprintView,
  locality: LocalityView,
  sun: SunView,
  pricing: PricingView,
  legal: LegalView,
  booking: BookingView,
};

function lengthOf(id: 'call' | 'montage'): number {
  return SCENE_LENGTHS.find(([s]) => s === id)![1];
}

const CALL_FRAMES = sec(lengthOf('call'));
const STEP_STARTS: number[] = [];
{
  let at = CALL_FRAMES;
  for (const len of MONTAGE_STEP_LENGTHS) {
    STEP_STARTS.push(at);
    at += sec(len);
  }
}
const STEP_ENDS = STEP_STARTS.map((s, i) => s + sec(MONTAGE_STEP_LENGTHS[i]!));

interface Exchange {
  you: string;
  youAt: number;
  shivam: string;
  shivamAt: number;
}

function exchangeAt(frame: number): Exchange {
  let ex: Exchange = { you: CALL.buyerLine, youAt: CALL_BEATS.you, shivam: CALL.advisorLine, shivamAt: CALL_BEATS.shivam };
  STEP_STARTS.forEach((start, i) => {
    if (frame >= start) {
      const step = MONTAGE[i]!;
      ex = { you: step.you, youAt: start + STEP_BEATS.you, shivam: step.shivam, shivamAt: start + STEP_BEATS.shivam };
    }
  });
  return ex;
}

/** The advisor listens while the buyer talks, speaks its reply, then rests. It celebrates the booking. */
function advisorCues(): Cue[] {
  const cues: Cue[] = [{ at: 0, state: 'idle' }];
  const add = (youAt: number, shivamAt: number, line: string, after: Cue['state']) => {
    cues.push({ at: youAt, state: 'listening' });
    cues.push({ at: shivamAt, state: 'speaking' });
    cues.push({ at: shivamAt + typeFrames(line, CAPTION_RATE) + 10, state: after });
  };
  add(CALL_BEATS.you, CALL_BEATS.shivam, CALL.advisorLine, 'idle');
  STEP_STARTS.forEach((start, i) => {
    const step = MONTAGE[i]!;
    add(start + STEP_BEATS.you, start + STEP_BEATS.shivam, step.shivam, step.view === 'booking' ? 'happy' : 'idle');
  });
  return cues;
}
const CUES = advisorCues();

function speakingAt(frame: number): boolean {
  const ex = exchangeAt(frame);
  return frame >= ex.shivamAt && frame < ex.shivamAt + typeFrames(ex.shivam, CAPTION_RATE) + 10;
}

function typed(text: string, frame: number, at: number): string {
  const n = typedCount(frame, at, CAPTION_RATE);
  return Array.from(text).slice(0, Math.max(0, n)).join('');
}

function TitleBar({ frame }: { frame: number }) {
  const picked = frame >= CALL_BEATS.select;
  const clock = CALL.clockStartS + Math.floor(frame / VIDEO.fps);
  const mm = String(Math.floor(clock / 60)).padStart(2, '0');
  const ss = String(clock % 60).padStart(2, '0');
  return (
    <div style={{ height: WINDOW.bar, display: 'flex', alignItems: 'center', padding: '0 22px', gap: 12, borderBottom: `${OUTLINE}px solid ${C.ink}`, background: C.paper, borderRadius: `${RADIUS.card - 4}px ${RADIUS.card - 4}px 0 0` }}>
      {[C.coral, C.sun, C.mint].map((c) => (
        <span key={c} style={{ width: 20, height: 20, borderRadius: '50%', background: c, border: `3px solid ${C.ink}` }} />
      ))}
      <div style={{ flex: 1, textAlign: 'center', fontFamily: FONT.sans, fontWeight: 800, fontSize: 24 }}>
        {CALL.windowTitle}
        {picked ? ` · ${PROPERTIES.sale.name}` : ''}
      </div>
      <Chip size={20} shadow={0} bg={C.coralTint} dot={C.coral}>
        {CALL.live} {mm}:{ss}
      </Chip>
    </div>
  );
}

function AdvisorTile({ frame }: { frame: number }) {
  const speaking = speakingAt(frame);
  const levels = Array.from({ length: 7 }, (_, i) => (speaking ? 0.25 + 0.75 * Math.abs(Math.sin(frame / 2.3 + i * 1.7) * Math.cos(frame / 3.1 + i)) : 0.12));
  return (
    <Card bg={C.blueTint} shadow={6} style={{ height: 400, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 28, display: 'flex', justifyContent: 'center' }}>
        <Mascot size={270} cues={CUES} seed={17} />
      </div>
      <div style={{ position: 'absolute', left: 22, right: 22, bottom: 18, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 36, letterSpacing: '-0.02em', lineHeight: 1 }}>{BRAND.advisorName}</div>
          <div style={{ fontFamily: FONT.sans, fontWeight: 700, fontSize: 20, color: C.inkSoft, marginTop: 4 }}>{BRAND.advisorRole}</div>
        </div>
        <Waveform levels={levels} height={48} barWidth={12} gap={5} />
      </div>
    </Card>
  );
}

function Captions({ frame }: { frame: number }) {
  const ex = exchangeAt(frame);
  const you = typed(ex.you, frame, ex.youAt);
  const shivam = typed(ex.shivam, frame, ex.shivamAt);
  const line = (who: string, bg: string, text: string, key: string) => (
    <div key={key} style={{ marginTop: 18, minHeight: 104 }}>
      <Chip size={18} shadow={0} bg={bg}>
        {who}
      </Chip>
      <div style={{ fontFamily: FONT.sans, fontWeight: 700, fontSize: 28, lineHeight: 1.3, marginTop: 8 }}>{text}</div>
    </div>
  );
  return (
    <Card shadow={6} style={{ flex: 1, padding: '18px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: FONT.sans, fontWeight: 800, fontSize: 20, color: C.inkSoft }}>
        <Icon name="mic" size={24} color={C.inkSoft} /> {CALL.captionsTitle}
        <span style={{ flex: 1 }} />
        <Chip size={16} shadow={0}>
          {CALL.language}
        </Chip>
      </div>
      {line(CALL.youLabel, C.grapeTint, you, `you-${ex.youAt}`)}
      {frame >= ex.shivamAt && line(BRAND.advisorName, C.blue, shivam, `sh-${ex.shivamAt}`)}
    </Card>
  );
}

function Dock({ frame }: { frame: number }) {
  const gap = 10;
  const tabW = (STAGE.w - gap * (MONTAGE.length - 1)) / MONTAGE.length;
  let active = -1;
  STEP_STARTS.forEach((s, i) => {
    if (frame >= s + STEP_BEATS.swap) active = i;
  });
  const prev = Math.max(0, active - 1);
  const swapAt = active >= 0 ? STEP_STARTS[active]! + STEP_BEATS.swap : 0;
  const slide = active <= 0 ? 1 : settle(frame, swapAt);
  const x = (prev + (active - prev) * slide) * (tabW + gap);
  return (
    <div style={{ position: 'relative', height: WINDOW.dock - 12, marginTop: 12, display: 'flex', gap }}>
      <div
        style={{
          position: 'absolute',
          left: x,
          top: 0,
          width: tabW,
          height: '100%',
          borderRadius: RADIUS.control,
          background: C.blue,
          border: `${OUTLINE}px solid ${C.ink}`,
          boxShadow: `4px 4px 0 0 ${C.ink}`,
          opacity: active >= 0 ? progress(frame, STEP_STARTS[0]! + STEP_BEATS.swap - 2, STEP_STARTS[0]! + STEP_BEATS.swap + 4) : 0,
        }}
      />
      {MONTAGE.map((step, i) => (
        <div
          key={step.view}
          style={{
            position: 'relative',
            width: tabW,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: RADIUS.control,
            border: `3px solid ${i === active ? 'transparent' : C.line}`,
            fontFamily: FONT.sans,
            fontWeight: 800,
            fontSize: 21,
            color: i === active ? C.canvas : C.inkSoft,
          }}
        >
          {step.tab}
        </div>
      ))}
    </div>
  );
}

/** Which view is on stage, and the one leaving, with frames since each swap. */
function stageState(frame: number): { cur: ViewId | 'picker'; curT: number; prev: ViewId | 'picker' | null; prevT: number } {
  let cur: ViewId | 'picker' = 'picker';
  let curStart = 0;
  let prev: ViewId | 'picker' | null = null;
  let prevStart = 0;
  STEP_STARTS.forEach((s, i) => {
    const swap = s + STEP_BEATS.swap;
    if (frame >= swap) {
      prev = cur;
      prevStart = curStart;
      cur = MONTAGE[i]!.view;
      curStart = swap;
    }
  });
  const sinceSwap = frame - curStart;
  return { cur, curT: sinceSwap, prev: sinceSwap < VIEW_SWAP_FRAMES ? prev : null, prevT: frame - prevStart };
}

function StageView({ id, t }: { id: ViewId | 'picker'; t: number }) {
  if (id === 'picker') return <PickerView t={t} selectAt={CALL_BEATS.select} />;
  const View = VIEWS[id];
  return <View t={t} />;
}

function Stage({ frame }: { frame: number }) {
  const { cur, curT, prev, prevT } = stageState(frame);
  const enter = progress(curT, 0, VIEW_SWAP_FRAMES, SMOOTH);
  return (
    <div style={{ position: 'relative', width: STAGE.w + 2 * OUTLINE, height: STAGE.h + 2 * OUTLINE, borderRadius: RADIUS.card, border: `${OUTLINE}px solid ${C.ink}`, overflow: 'hidden', background: C.paper }}>
      {prev && (
        <div style={{ position: 'absolute', inset: 0, transform: `translateX(${-enter * 90}px)`, opacity: 1 - enter }}>
          <StageView id={prev} t={prevT} />
        </div>
      )}
      <div style={{ position: 'absolute', inset: 0, transform: `translateX(${(1 - enter) * 90}px)`, opacity: prev ? enter : 1 }}>
        <StageView id={cur} t={curT} />
      </div>
    </div>
  );
}

function windowPose(frame: number) {
  const enter = pop(frame, 0, { damping: 17, stiffness: 110 });
  const grow = progress(frame, CALL_FRAMES - 12, CALL_FRAMES + 14, SMOOTH);
  let push = 0;
  STEP_STARTS.forEach((s, i) => {
    if (frame >= s && frame < STEP_ENDS[i]!) push = 0.022 * (1 - Math.cos(((frame - s) / (STEP_ENDS[i]! - s)) * Math.PI * 2)) * 0.5;
  });
  return {
    y: (1 - enter) * 820 + 132 * (1 - grow) - 4 * grow,
    scale: 0.72 + 0.24 * grow + push,
    rotX: 15 - 8 * grow,
    rotY: -9 + 3 * wobble(frame, 9),
    headline: 1 - grow,
  };
}

export function Product() {
  const frame = useCurrentFrame();
  const pose = windowPose(frame);
  return (
    <AbsoluteFill>
      <Background />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 58, display: 'flex', justifyContent: 'center', opacity: pose.headline, transform: `translateY(${-(1 - pose.headline) * 160}px)` }}>
        <TypeLine pieces={CALL.headline} at={CALL_BEATS.headline} size={84} />
      </div>
      <AbsoluteFill style={{ perspective: 2600 }}>
        <div
          style={{
            position: 'absolute',
            left: (VIDEO.width - WINDOW.w) / 2,
            top: (VIDEO.height - WINDOW.h) / 2,
            width: WINDOW.w,
            height: WINDOW.h,
            transform: `translateY(${pose.y}px) scale(${pose.scale}) rotateX(${pose.rotX}deg) rotateY(${pose.rotY}deg)`,
            transformStyle: 'preserve-3d',
          }}
        >
          <Card shadow={14} style={{ width: '100%', height: '100%' }}>
            <TitleBar frame={frame} />
            <div style={{ display: 'flex', gap: WINDOW.pad, padding: WINDOW.pad }}>
              <div>
                <Stage frame={frame} />
                <Dock frame={frame} />
              </div>
              <div style={{ width: WINDOW.rail, display: 'flex', flexDirection: 'column', gap: WINDOW.pad }}>
                <AdvisorTile frame={frame} />
                <Captions frame={frame} />
              </div>
            </div>
          </Card>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
