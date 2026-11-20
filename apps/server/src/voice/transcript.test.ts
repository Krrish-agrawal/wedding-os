import { describe, expect, it } from 'vitest';
import type { TranscriptLine } from '@ave/shared';
import { missingHistoryLines, resumeContext } from './transcript.js';

const T0 = 1_000_000;
const line = (id: string, role: TranscriptLine['role'], text: string, at: number, final = true): TranscriptLine => ({ id, role, text, final, at });

describe('missingHistoryLines', () => {
  it('adds nothing when every history item was relayed', () => {
    const transcript = [line('1', 'agent', 'Hi Priya!', T0 + 10), line('2', 'buyer', 'show me the flat', T0 + 20)];
    const history = [
      { role: 'assistant' as const, content: 'Hi Priya!' },
      { role: 'user' as const, content: 'Show me the flat.' },
    ];
    expect(missingHistoryLines(transcript, history, { agentId: 'a', startedAt: T0, now: T0 + 100 })).toEqual([]);
  });

  it('treats an interrupted caption as the same reply', () => {
    const transcript = [line('1', 'agent', 'The kitchen faces east and gets', T0 + 10)];
    const history = [{ role: 'assistant' as const, content: 'The kitchen faces east and gets morning light.' }];
    expect(missingHistoryLines(transcript, history, { agentId: 'a', startedAt: T0, now: T0 + 100 })).toEqual([]);
  });

  it('places missing lines right after the last matched one, with stable ids', () => {
    const transcript = [line('1', 'agent', 'Hello', T0 + 10), line('2', 'buyer', 'Bye', T0 + 50)];
    const history = [
      { role: 'assistant' as const, content: 'Hello' },
      { role: 'user' as const, content: 'What is the price?' },
      { role: 'user' as const, content: 'Bye' },
    ];
    const out = missingHistoryLines(transcript, history, { agentId: 'agent-7', startedAt: T0, now: T0 + 100 });
    expect(out).toEqual([{ id: 'hist-agent-7-1', role: 'buyer', text: 'What is the price?', final: true, at: T0 + 11 }]);
    // Idempotent: once added, the same history adds nothing.
    expect(missingHistoryLines([...transcript, ...out], history, { agentId: 'agent-7', startedAt: T0, now: T0 + 100 })).toEqual([]);
  });

  it('skips screen events, empty tool-call turns and partial captions', () => {
    const transcript = [line('1', 'buyer', 'What is the EMI', T0 + 10, false)];
    const history = [
      { role: 'user' as const, content: '[screen] The buyer clicked to open the Pricing view.' },
      { role: 'assistant' as const, content: '' },
      { role: 'user' as const, content: 'What is the EMI' },
    ];
    const out = missingHistoryLines(transcript, history, { agentId: 'a', startedAt: T0, now: T0 + 100 });
    expect(out.map((l) => l.text)).toEqual(['What is the EMI']);
  });

  it('ignores lines from before this agent (an earlier agent said the same thing)', () => {
    const transcript = [line('old', 'agent', 'Welcome back.', T0 - 10 * 60_000)];
    const history = [{ role: 'assistant' as const, content: 'Welcome back.' }];
    const out = missingHistoryLines(transcript, history, { agentId: 'b', startedAt: T0, now: T0 + 100 });
    expect(out).toHaveLength(1);
  });
});

describe('missingHistoryLines during the call', () => {
  const opts = (now: number) => ({ agentId: 'a', startedAt: T0, now, settledBefore: now - 4000 });

  it('fills in settled lines the browser never relayed, and waits on fresh ones', () => {
    const history = [
      { role: 'assistant' as const, content: 'Hi Priya!', endedAt: T0 + 1000 },
      { role: 'user' as const, content: 'Show me the office.', endedAt: T0 + 6000 },
      { role: 'assistant' as const, content: 'Here is the lounge.', endedAt: T0 + 9000 },
    ];
    const out = missingHistoryLines([], history, opts(T0 + 10_000));
    expect(out.map((l) => [l.id, l.role, l.text])).toEqual([
      ['hist-a-0', 'agent', 'Hi Priya!'],
      ['hist-a-1', 'buyer', 'Show me the office.'],
    ]);
  });

  it('treats a caption still in progress as relayed', () => {
    const transcript = [line('1', 'agent', 'Hi Priya! I can show', T0 + 10, false)];
    const history = [{ role: 'assistant' as const, content: 'Hi Priya! I can show you both homes.', endedAt: T0 + 1000 }];
    expect(missingHistoryLines(transcript, history, opts(T0 + 20_000))).toEqual([]);
  });

  it('without timings, holds back the newest item', () => {
    const history = [
      { role: 'assistant' as const, content: 'Hi Priya!' },
      { role: 'user' as const, content: 'Hello' },
    ];
    expect(missingHistoryLines([], history, opts(T0 + 20_000)).map((l) => l.text)).toEqual(['Hi Priya!']);
  });
});

describe('resumeContext', () => {
  it('summarises recent final lines for a replacement agent', () => {
    const ctx = resumeContext([
      line('1', 'buyer', 'Show me the apartment', T0),
      line('2', 'agent', 'Here it is.', T0 + 1),
      line('3', 'buyer', 'partial', T0 + 2, false),
    ]);
    expect(ctx).toMatch(/- Buyer: Show me the apartment\n- You: Here it is\.$/);
  });

  it('is null for an empty conversation', () => {
    expect(resumeContext([])).toBeNull();
  });
});
