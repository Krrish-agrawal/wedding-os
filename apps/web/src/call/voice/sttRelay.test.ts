import { describe, expect, it } from 'vitest';
import type { TranscriptLine } from '@ave/shared';
import { STT_PARTIAL_INTERVAL_MS, SttRelay, decodeSttPayload, parseSttJson } from './sttRelay';

const BUYER = 2001;
const ADVISOR = 3001;

const encode = (obj: unknown) => new TextEncoder().encode(JSON.stringify(obj));

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const caption = (uid: number, text: string, isFinal: boolean, sentenceId: number | null = 1) => ({
  transcript: { uid, text, isFinal, ...(sentenceId === null ? {} : { sentenceId }), textTs: 1, language: 'en-IN', results: [{ text, isFinal }] },
});

describe('decodeSttPayload', () => {
  it('reads plain and gzip-compressed JSON captions', async () => {
    expect(await decodeSttPayload(encode(caption(BUYER, 'Hello there', true)))).toEqual({
      kind: 'caption',
      caption: { uid: BUYER, sentenceId: '1', text: 'Hello there', isFinal: true },
    });
    const zipped = await gzip(encode(caption(ADVISOR, 'नमस्ते', false, 4)));
    expect(zipped[0]).toBe(0x1f);
    expect(await decodeSttPayload(zipped)).toEqual({ kind: 'caption', caption: { uid: ADVISOR, sentenceId: '4', text: 'नमस्ते', isFinal: false } });
  });

  it('calls protobuf unreadable and ignores translations and empty follow-ups', async () => {
    expect((await decodeSttPayload(new Uint8Array([0x08, 0x01, 0x10, 0x02, 0x22, 0x03]))).kind).toBe('unreadable');
    expect(parseSttJson({ translation: { uid: BUYER, results: [] } })).toEqual({ kind: 'ignore' });
    expect(parseSttJson({ transcript: { uid: BUYER, text: '', results: [] } })).toEqual({ kind: 'ignore' });
  });

  it('falls back to the results when the caption has no text field', () => {
    const parsed = parseSttJson({ transcript: { uid: '2001', results: [{ text: 'Two ', isFinal: true }, { text: 'parts', isFinal: true }] } });
    expect(parsed).toEqual({ kind: 'caption', caption: { uid: BUYER, sentenceId: null, text: 'Two parts', isFinal: true } });
  });
});

describe('SttRelay', () => {
  function relay() {
    let t = 1_000_000;
    const sent: TranscriptLine[] = [];
    const problems: string[] = [];
    const r = new SttRelay({ buyerUid: BUYER, advisorUid: ADVISOR, send: (l) => sent.push(l), onProblem: (p) => problems.push(p), now: () => t });
    return { r, sent, problems, advance: (ms: number) => (t += ms) };
  }

  it('maps speakers to roles and updates one sentence in place', async () => {
    const { r, sent, advance } = relay();
    await r.handle(encode(caption(BUYER, 'Can you', false, 7)));
    advance(STT_PARTIAL_INTERVAL_MS);
    await r.handle(encode(caption(BUYER, 'Can you drop the price?', true, 7)));
    await r.handle(encode(caption(ADVISOR, 'Let me check.', true, 1)));
    await r.handle(encode(caption(1000, 'Agent audio is not relayed', true, 1)));
    expect(sent.map((l) => [l.role, l.text, l.final])).toEqual([
      ['buyer', 'Can you', false],
      ['buyer', 'Can you drop the price?', true],
      ['human', 'Let me check.', true],
    ]);
    expect(sent[0]!.id).toBe(sent[1]!.id);
    expect(sent[1]!.at).toBe(sent[0]!.at);
    expect(sent[2]!.id).not.toBe(sent[1]!.id);
  });

  it('throttles partials, never lets a late partial undo a final, and skips repeats', async () => {
    const { r, sent, advance } = relay();
    await r.handle(encode(caption(BUYER, 'One', false)));
    await r.handle(encode(caption(BUYER, 'One two', false)));
    advance(STT_PARTIAL_INTERVAL_MS);
    await r.handle(encode(caption(BUYER, 'One two three', false)));
    await r.handle(encode(caption(BUYER, 'One two three.', true)));
    await r.handle(encode(caption(BUYER, 'One two three.', true)));
    advance(STT_PARTIAL_INTERVAL_MS);
    await r.handle(encode(caption(BUYER, 'One two', false)));
    expect(sent.map((l) => l.text)).toEqual(['One', 'One two three', 'One two three.']);
  });

  it('numbers sentences itself when the caption has no sentence id', async () => {
    const { r, sent } = relay();
    await r.handle(encode(caption(BUYER, 'First.', true, null)));
    await r.handle(encode(caption(BUYER, 'Second.', true, null)));
    expect(new Set(sent.map((l) => l.id)).size).toBe(2);
  });

  it('reports an unreadable stream once', async () => {
    const { r, problems } = relay();
    await r.handle(new Uint8Array([0x08, 0x01]));
    await r.handle(new Uint8Array([0x08, 0x02]));
    expect(problems).toHaveLength(1);
  });
});
