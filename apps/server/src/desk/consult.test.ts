import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConsultNotes, SessionAction } from '@ave/shared';
import { SessionStore } from '../sessions/store.js';
import { BUYER, fixtureContent } from '../voice/testkit.js';
import { ConsultScribe, SCRIBE_JSON_SCHEMA, SCRIBE_MESSAGES, SCRIBE_MIN_GAP_MS, buildScribePrompt, normaliseNotes, type ScribeInput } from './consult.js';
import { silentLog } from './testkit.js';

const content = fixtureContent();

/** What a model might answer: one ask, one promise needing approval, one step with a WhatsApp action. */
function answer(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    summary: 'Rahul is checking a discount on parking.',
    buyerAsks: [{ id: null, text: 'A lower parking charge', quote: 'Can you drop the parking?' }],
    promises: [{ id: null, text: 'Check a 2% discount with the manager', quote: null, needsApproval: true }],
    objections: ['Parking is too expensive'],
    nextSteps: [{ id: null, text: 'Send the price sheet', action: { kind: 'whatsapp', text: 'Hi Priya, here is the price sheet.' } }],
    ...overrides,
  };
}

describe('normaliseNotes', () => {
  let n = 0;
  const newId = () => `id-${++n}`;
  beforeEach(() => {
    n = 0;
  });

  it('gives new items fresh ids and keeps ids the model reused', () => {
    const first = normaliseNotes(answer(), null, newId);
    expect(first.buyerAsks[0]!.id).toBe('id-1');
    expect(first.promises[0]).toMatchObject({ id: 'id-2', needsApproval: true });
    expect(first.nextSteps[0]).toMatchObject({ id: 'id-3', action: { kind: 'whatsapp' }, doneRef: null });

    const second = normaliseNotes(
      answer({
        buyerAsks: [
          { id: 'id-1', text: 'A lower parking charge, reworded', quote: null },
          { id: 'made-up', text: 'Floor plan for the second tower', quote: null },
        ],
      }),
      first,
      newId,
    );
    expect(second.buyerAsks.map((a) => a.id)).toEqual(['id-1', 'id-4']);
  });

  it('keeps doneRef for steps the admin already ran, even if the model drops them', () => {
    const first = normaliseNotes(answer(), null, newId);
    const done: ConsultNotes = { ...first, nextSteps: [{ ...first.nextSteps[0]!, doneRef: 'delivery-1' }] };
    const kept = normaliseNotes(answer({ nextSteps: [{ id: 'id-3', text: 'Send the price sheet again', action: null }] }), done, newId);
    expect(kept.nextSteps[0]).toMatchObject({ id: 'id-3', doneRef: 'delivery-1', action: { kind: 'whatsapp' } });
    const dropped = normaliseNotes(answer({ nextSteps: [] }), done, newId);
    expect(dropped.nextSteps).toEqual(done.nextSteps);
  });

  it('turns nullable model fields into the shared action contract and drops broken actions', () => {
    const notes = normaliseNotes(
      answer({
        nextSteps: [
          { id: null, text: 'Approval task', action: { kind: 'jira', summary: 'Approve 2% discount', description: null, dueInDays: null } },
          { id: null, text: 'Show EMI', action: { kind: 'view', command: 'show the EMI with 1.5 crore down' } },
          { id: null, text: 'Broken', action: { kind: 'fax', text: 'x' } },
        ],
      }),
      null,
      newId,
    );
    expect(notes.nextSteps.map((s) => s.action)).toEqual([{ kind: 'jira', summary: 'Approve 2% discount' }, { kind: 'view', command: 'show the EMI with 1.5 crore down' }, null]);
  });

  it('rejects an answer that is not notes', () => {
    expect(() => normaliseNotes({ summary: 3 }, null, newId)).toThrow();
  });

  it('offers a strict schema whose objects allow no extra fields', () => {
    expect(SCRIBE_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(SCRIBE_JSON_SCHEMA.required).toEqual(['summary', 'buyerAsks', 'promises', 'objections', 'nextSteps']);
  });
});

describe('ConsultScribe', () => {
  let store: SessionStore;
  let sessionId: string;
  let calls: ScribeInput[];
  let reply: () => Promise<unknown>;
  let scribe: ConsultScribe;
  let clock: number;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    clock = 1_000_000;
    store = new SessionStore(() => clock);
    calls = [];
    reply = async () => answer();
    scribe = new ConsultScribe({
      store,
      content,
      log: silentLog,
      now: () => clock,
      model: (input) => {
        calls.push(input);
        return reply();
      },
    });
    store.on('change', (state, action) => scribe.onChange(state, action));
    sessionId = store.create(BUYER).id;
    store.dispatch(sessionId, { type: 'add_transcript', line: { id: 'a1', role: 'buyer', text: 'Is parking included?', final: true, at: clock } }, 'buyer');
    clock += 1000;
    store.dispatch(sessionId, { type: 'set_handoff', patch: { status: 'joined', humanName: 'Rahul' } }, 'advisor');
    store.dispatch(sessionId, { type: 'set_consult', patch: { status: 'listening', transcriptSource: 'agora_stt' } }, 'system');
  });
  afterEach(() => {
    scribe.dispose();
    vi.useRealTimers();
  });

  let seq = 0;
  const say = (role: 'buyer' | 'human', text: string, final = true) => {
    clock += 500;
    const action: SessionAction = { type: 'add_transcript', line: { id: `l${++seq}`, role, text, final, at: clock } };
    store.dispatch(sessionId, action, 'advisor');
  };
  const consult = () => store.get(sessionId)!.consult;

  it('waits for the gap, then writes notes from the consult lines and goes back to listening', async () => {
    say('buyer', 'Can you drop the parking?');
    say('human', 'Let me check a 2% discount with my manager.');
    await vi.advanceTimersByTimeAsync(SCRIBE_MIN_GAP_MS - 1);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.user).toContain('Rahul (human advisor): Let me check a 2% discount');
    expect(calls[0]!.user).toContain('Buyer: Is parking included?'); // the AI part, before the join
    expect(consult()).toMatchObject({ status: 'listening', error: null, updatedAt: clock });
    expect(consult().notes?.promises[0]).toMatchObject({ text: 'Check a 2% discount with the manager', needsApproval: true });
  });

  it('ignores partial lines, AI lines and anything before the human joins', async () => {
    say('buyer', 'Can you', false);
    store.dispatch(sessionId, { type: 'add_transcript', line: { id: 'ag', role: 'agent', text: 'Sure', final: true, at: clock } }, 'system');
    await vi.advanceTimersByTimeAsync(SCRIBE_MIN_GAP_MS * 2);
    expect(calls).toHaveLength(0);
  });

  it('never runs two updates at once and keeps runs at least the gap apart', async () => {
    let resolve!: (v: unknown) => void;
    reply = () => new Promise((r) => (resolve = r));
    say('buyer', 'First');
    await vi.advanceTimersByTimeAsync(SCRIBE_MIN_GAP_MS);
    expect(calls).toHaveLength(1);
    expect(consult().status).toBe('updating');
    say('human', 'Second');
    say('buyer', 'Third');
    await vi.advanceTimersByTimeAsync(SCRIBE_MIN_GAP_MS * 3);
    expect(calls).toHaveLength(1);
    resolve(answer());
    await vi.advanceTimersByTimeAsync(0);
    expect(consult().status).toBe('listening');
    await vi.advanceTimersByTimeAsync(SCRIBE_MIN_GAP_MS - 1);
    expect(calls).toHaveLength(1);
    reply = async () => answer();
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.user).toContain('Buyer: Third');
    expect(calls[1]!.user).toContain('PREVIOUS NOTES:\n{');
  });

  it('keeps the last notes and shows a short error when the model fails, then clears it', async () => {
    store.dispatch(sessionId, { type: 'set_consult', patch: { error: 'Agora Real-Time STT did not start. Transcribing with OpenAI instead.' } }, 'system');
    say('buyer', 'First');
    await vi.advanceTimersByTimeAsync(SCRIBE_MIN_GAP_MS);
    const notes = consult().notes;
    expect(notes).not.toBeNull();

    reply = async () => {
      throw new Error('timeout');
    };
    say('buyer', 'Second');
    await vi.advanceTimersByTimeAsync(SCRIBE_MIN_GAP_MS);
    expect(consult()).toMatchObject({ status: 'listening', error: SCRIBE_MESSAGES.failed, notes });

    reply = async () => ({ summary: 3 }); // malformed answers count as failures too
    say('buyer', 'Third');
    await vi.advanceTimersByTimeAsync(SCRIBE_MIN_GAP_MS);
    expect(consult()).toMatchObject({ error: SCRIBE_MESSAGES.failed, notes });

    reply = async () => answer({ summary: 'Recovered.' });
    say('buyer', 'Fourth');
    await vi.advanceTimersByTimeAsync(SCRIBE_MIN_GAP_MS);
    expect(consult().notes?.summary).toBe('Recovered.');
    expect(consult().error).toBe('Agora Real-Time STT did not start. Transcribing with OpenAI instead.');
  });

  it('runs once more right away for the last words when the advisor hands back', async () => {
    say('buyer', 'One more thing');
    store.dispatch(sessionId, { type: 'set_handoff', patch: { status: 'returned' } }, 'advisor');
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    expect(consult().status).not.toBe('updating');
    await vi.advanceTimersByTimeAsync(SCRIBE_MIN_GAP_MS * 2);
    expect(calls).toHaveLength(1);
  });

  it('includes admin notes and updates when the admin adds one', async () => {
    store.dispatch(sessionId, { type: 'add_admin_note', note: { id: 'n1', text: 'Buyer is price sensitive', at: clock, by: 'Rahul' } }, 'advisor');
    await vi.advanceTimersByTimeAsync(SCRIBE_MIN_GAP_MS);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.user).toContain('Rahul: Buyer is price sensitive');
  });

  it('says once that notes need a model when none is configured', async () => {
    scribe.dispose();
    store.removeAllListeners('change');
    const none = new ConsultScribe({ store, content, log: silentLog, model: null });
    store.on('change', (state, action) => none.onChange(state, action));
    say('buyer', 'Hello');
    await vi.advanceTimersByTimeAsync(SCRIBE_MIN_GAP_MS);
    say('buyer', 'Again');
    await vi.advanceTimersByTimeAsync(SCRIBE_MIN_GAP_MS);
    expect(consult().error).toBe(SCRIBE_MESSAGES.noModel);
    none.dispose();
  });
});

describe('buildScribePrompt', () => {
  it('sends previous notes with their ids so the model can keep them', () => {
    const store = new SessionStore();
    const s = store.create(BUYER);
    const notes = normaliseNotes(answer(), null, () => 'keep-me');
    store.dispatch(s.id, { type: 'set_consult', patch: { notes } }, 'system');
    expect(buildScribePrompt(store.get(s.id)!, content).user).toContain('"id":"keep-me"');
  });
});
