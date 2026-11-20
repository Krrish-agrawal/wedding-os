import { isScreenEventText, type TranscriptLine } from '@ave/shared';
import type { HistoryItem } from './gateway.js';
import { RESUME_CONTEXT_HEADER } from './lines.js';

const ROLE_FOR: Record<HistoryItem['role'], TranscriptLine['role']> = { user: 'buyer', assistant: 'agent' };
const CLOCK_SKEW_ALLOWANCE_MS = 5 * 60_000;

/** Final lines given to a replacement agent so it can pick up the thread. */
const RESUME_LINES = 12;
const RESUME_LINE_CHARS = 200;
const RESUME_SPEAKERS: Record<TranscriptLine['role'], string> = { buyer: 'Buyer', agent: 'You', human: 'Human advisor' };

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Same utterance, allowing for an interrupted line that holds only the start of the reply. */
function sameUtterance(a: string, b: string): boolean {
  const x = normalise(a);
  const y = normalise(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(y) || y.startsWith(x);
}

/**
 * Lines in the agent's own history that the browser never relayed (tab closed mid-turn, socket
 * dropped). Walks history and transcript in order; anything unmatched becomes a final line placed
 * just after the last matched one, so the Desk sees the whole conversation in order. Ids are
 * stable per agent and history index, so running this twice adds nothing new.
 */
export function missingHistoryLines(
  transcript: readonly TranscriptLine[],
  history: readonly HistoryItem[],
  opts: {
    agentId: string;
    startedAt: number;
    now: number;
    /**
     * During the call: only lines that finished before this time are filled in, so the browser's own
     * captions (normally a second behind speech) arrive first; and captions still in progress count
     * as relayed. Without it (the agent is leaving) every missing line is added.
     */
    settledBefore?: number;
  },
): TranscriptLine[] {
  const known = new Set(transcript.map((l) => l.id));
  const live = opts.settledBefore !== undefined;
  // Relayed lines carry the browser's clock; allow for skew against the server's start time.
  const since = opts.startedAt - CLOCK_SKEW_ALLOWANCE_MS;
  // Chronological, not array order: lines added by an earlier reconciliation sit at the end of the array.
  const candidates = transcript.filter((l) => (l.final || live) && l.role !== 'human' && l.at >= since).sort((a, b) => a.at - b.at);
  const settled = (item: HistoryItem, index: number) =>
    !live || (item.endedAt !== undefined ? item.endedAt <= (opts.settledBefore as number) : index < history.length - 1);
  let cursor = 0;
  let anchorAt = opts.startedAt;
  const out: TranscriptLine[] = [];

  history.forEach((item, index) => {
    const text = item.content.trim();
    if (!text || isScreenEventText(text)) return;
    const role = ROLE_FOR[item.role];
    const match = candidates.findIndex((l, i) => i >= cursor && l.role === role && sameUtterance(l.text, text));
    if (match >= 0) {
      cursor = match + 1;
      anchorAt = candidates[match]?.at ?? anchorAt;
      return;
    }
    const id = `hist-${opts.agentId}-${index}`;
    if (known.has(id) || !settled(item, index)) return;
    anchorAt = Math.min(anchorAt + 1, opts.now);
    out.push({ id, role, text, final: true, at: anchorAt });
  });
  return out;
}

/** A compact recap of the last few final lines, for an agent that replaces one that failed. */
export function resumeContext(transcript: readonly TranscriptLine[]): string | null {
  const recent = transcript.filter((l) => l.final && l.text.trim() && !isScreenEventText(l.text)).slice(-RESUME_LINES);
  if (!recent.length) return null;
  const clip = (s: string) => {
    const one = s.replace(/\s+/g, ' ').trim();
    return one.length > RESUME_LINE_CHARS ? `${one.slice(0, RESUME_LINE_CHARS - 1)}…` : one;
  };
  return [RESUME_CONTEXT_HEADER, ...recent.map((l) => `- ${RESUME_SPEAKERS[l.role]}: ${clip(l.text)}`)].join('\n');
}
