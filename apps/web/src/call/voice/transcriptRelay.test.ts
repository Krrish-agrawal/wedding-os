import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptLine } from '@ave/shared';
import { PARTIAL_RELAY_INTERVAL_MS, TranscriptRelay, type ToolkitItem } from './transcriptRelay';

const agent = (turn: number, text: string, status: 0 | 1 | 2): ToolkitItem => ({
  uid: '1000',
  stream_id: 0,
  turn_id: turn,
  _time: 0,
  text,
  status,
  metadata: { object: 'assistant.transcription' } as ToolkitItem['metadata'],
});

const buyer = (turn: number, text: string, final: boolean): ToolkitItem => ({
  uid: '0',
  stream_id: 0,
  turn_id: turn,
  _time: 0,
  text,
  status: 1,
  metadata: { object: 'user.transcription', final } as ToolkitItem['metadata'],
});

let sent: TranscriptLine[];
let relay: TranscriptRelay;

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  relay = new TranscriptRelay({ send: (l) => sent.push(l) });
});
afterEach(() => vi.useRealTimers());

describe('TranscriptRelay', () => {
  it('keeps one id per turn so partial captions update in place', () => {
    relay.update([buyer(1, 'show me', false)]);
    vi.advanceTimersByTime(PARTIAL_RELAY_INTERVAL_MS);
    relay.update([buyer(1, 'show me the flat', true)]);
    expect(sent.map((l) => [l.role, l.text, l.final])).toEqual([
      ['buyer', 'show me', false],
      ['buyer', 'show me the flat', true],
    ]);
    expect(new Set(sent.map((l) => l.id)).size).toBe(1);
    expect(sent[0]!.at).toBe(sent[1]!.at);
  });

  it('throttles partials but always sends the final line at once', () => {
    relay.update([agent(2, 'The', 0)]);
    relay.update([agent(2, 'The kitchen', 0)]);
    relay.update([agent(2, 'The kitchen faces', 0)]);
    expect(sent.map((l) => l.text)).toEqual(['The']);
    vi.advanceTimersByTime(PARTIAL_RELAY_INTERVAL_MS);
    expect(sent.map((l) => l.text)).toEqual(['The', 'The kitchen faces']);
    relay.update([agent(2, 'The kitchen faces east.', 1)]);
    expect(sent.at(-1)).toMatchObject({ role: 'agent', text: 'The kitchen faces east.', final: true });
  });

  it('keeps a WORD-mode line partial until every word of the ended turn is revealed', () => {
    const full = 'Hi Priya, I am Asha. Are you looking for a home?';
    const word = (text: string): ToolkitItem => ({ ...agent(0, text, 1), metadata: { text: full } as ToolkitItem['metadata'] });
    relay.update([word('Hi Priya,')]);
    vi.advanceTimersByTime(PARTIAL_RELAY_INTERVAL_MS);
    relay.update([word('Hi Priya, I am Asha.')]);
    relay.update([word(full)]);
    expect(sent.map((l) => [l.text, l.final])).toEqual([
      ['Hi Priya,', false],
      ['Hi Priya, I am Asha.', false],
      [full, true],
    ]);
  });

  it('treats an interrupted agent turn as final and ignores later repeats', () => {
    relay.update([agent(3, 'Let me', 2)]);
    relay.update([agent(3, 'Let me', 2)]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ final: true, text: 'Let me' });
  });

  it('only sends lines that changed when the toolkit sends the whole list', () => {
    relay.update([buyer(1, 'hello', true)]);
    relay.update([buyer(1, 'hello', true), agent(1, 'Hi Priya!', 1)]);
    expect(sent.map((l) => l.text)).toEqual(['hello', 'Hi Priya!']);
  });

  it('skips screen events and echoes of typed input', () => {
    relay.noteTyped('What is the EMI?');
    relay.update([buyer(1, '[screen] The buyer clicked to open Pricing.', true), buyer(2, 'what is the emi', true)]);
    expect(sent).toEqual([]);
  });

  it('gives a new agent fresh ids after reset', () => {
    relay.update([agent(1, 'Hello', 1)]);
    vi.advanceTimersByTime(1);
    relay.reset();
    relay.update([agent(1, 'Welcome back', 1)]);
    expect(sent).toHaveLength(2);
    expect(sent[0]!.id).not.toBe(sent[1]!.id);
  });
});
