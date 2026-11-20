import { beforeEach, describe, expect, it } from 'vitest';
import { TOOL_NAMES } from '@ave/shared';
import type OpenAI from 'openai';
import type { AppContext } from '../context.js';
import { newSession, offlineDeps, saleBundle, toolTestContext } from '../tools/testkit.js';
import { buildFailureMessage, buildGreeting, buildScreenLine, buildSystemMessages, buildSystemPrompt } from './prompt.js';
import { SimAdvisor, SimError, openAiTools, type ChatCreate } from './sim.js';

type Completion = OpenAI.Chat.Completions.ChatCompletion;

/** The brief is sent on every model call; keep it compact. */
const MAX_PROMPT_CHARS = 4500;

let ctx: AppContext;
let sid: string;

beforeEach(async () => {
  ctx = await toolTestContext({ ADVISOR_NAME: 'Asha' });
  sid = newSession(ctx, 'Priya Sharma');
});

describe('system prompt', () => {
  it('names the advisor and the buyer, lists the shortlist by id, and stays compact', () => {
    const prompt = buildSystemPrompt(ctx, ctx.store.get(sid)!);
    expect(prompt).toContain('You are Asha');
    expect(prompt).toContain('Priya');
    expect(prompt).not.toContain('Sharma');
    for (const b of ctx.content.properties) {
      expect(prompt).toContain(b.property.id);
      expect(prompt).toContain(b.property.name);
    }
    expect(prompt.length).toBeLessThan(MAX_PROMPT_CHARS);
  });

  it('only mentions tools that exist, by their exact names', () => {
    const prompt = buildSystemPrompt(ctx, ctx.store.get(sid)!);
    const mentioned = [...prompt.matchAll(/\b(show|open|tour|apply|request|get|book|update|send)[A-Z][A-Za-z]+\b/g)].map((m) => m[0]);
    expect(mentioned.length).toBeGreaterThan(0);
    for (const name of mentioned) expect(TOOL_NAMES).toContain(name);
    expect(prompt).not.toMatch(/\b[a-z]+_[a-z]+\b/);
  });

  it('asks for speech-friendly output: digits, rupee sign, no markdown', () => {
    const prompt = buildSystemPrompt(ctx, ctx.store.get(sid)!);
    expect(prompt).toMatch(/digits/);
    expect(prompt).toContain('₹');
    expect(prompt).toMatch(/no markdown/i);
    expect(prompt).toMatch(/confirmed true/);
    expect(prompt).toMatch(/The call language is English/);
  });

  it('keeps the whole call in the chosen language', () => {
    ctx.store.dispatch(sid, { type: 'set_language', language: 'hi' }, 'buyer');
    const hindi = ctx.store.get(sid)!;
    expect(buildSystemPrompt(ctx, hindi)).toMatch(/The call language is Hindi\. Reply only in Hindi, written in Devanagari/);
    expect(buildGreeting(ctx, hindi)).toMatch(/^नमस्ते Priya/);
    expect(buildFailureMessage(hindi)).toMatch(/माफ़ कीजिए/);
    ctx.store.dispatch(sid, { type: 'set_language', language: 'kn' }, 'buyer');
    const kannada = ctx.store.get(sid)!;
    expect(buildSystemPrompt(ctx, kannada)).toMatch(/The call language is Kannada\. Reply only in Kannada/);
    expect(buildGreeting(ctx, kannada)).toMatch(/^ನಮಸ್ಕಾರ Priya/);
  });
});

describe('screen line and greeting', () => {
  it('describes the screen and what the buyer clicked', () => {
    expect(buildScreenLine(ctx, ctx.store.get(sid)!)).toMatch(/^SCREEN: .*No property is open yet\.$/);
    const sale = saleBundle(ctx);
    ctx.store.dispatch(sid, { type: 'set_property', propertyId: sale.property.id }, 'agent');
    ctx.store.dispatch(sid, { type: 'set_view', view: 'money', params: { tab: 'emi', emi: { downPayment: 3_000_000, ratePct: 8.5, tenureYears: 20 } } }, 'agent');
    const line = buildScreenLine(ctx, ctx.store.get(sid)!);
    expect(line).toContain(sale.property.name);
    expect(line).toContain('Pricing');
    expect(line).toContain('₹30 lakh down');
    expect(line).not.toMatch(/clicking/);

    ctx.store.dispatch(sid, { type: 'set_view', view: 'legal' }, 'buyer');
    expect(buildScreenLine(ctx, ctx.store.get(sid)!)).toMatch(/Priya just opened Legal by clicking\.$/);
    ctx.store.dispatch(sid, { type: 'set_handoff', patch: { status: 'requested', reason: 'x', requestedAt: 1 } }, 'agent');
    expect(buildScreenLine(ctx, ctx.store.get(sid)!)).toMatch(/senior advisor has been requested/);
  });

  it('greets the buyer by first name and sends both system messages', () => {
    const state = ctx.store.get(sid)!;
    expect(buildGreeting(ctx, state)).toMatch(/^Hi Priya, I'm Asha/);
    expect(buildFailureMessage().length).toBeGreaterThan(0);
    const msgs = buildSystemMessages(ctx, state);
    expect(msgs.map((m) => m.role)).toEqual(['system', 'system']);
    expect(msgs[1]!.content.startsWith('SCREEN:')).toBe(true);
  });
});

/** A scripted model: each call returns the next canned message. */
function scripted(messages: Completion['choices'][number]['message'][]): { create: ChatCreate; bodies: unknown[] } {
  const bodies: unknown[] = [];
  let i = 0;
  const create: ChatCreate = async (body) => {
    bodies.push(structuredClone(body));
    const message = messages[Math.min(i++, messages.length - 1)]!;
    return { id: `c${i}`, object: 'chat.completion', created: 0, model: body.model, choices: [{ index: 0, finish_reason: 'stop', logprobs: null, message }] } as Completion;
  };
  return { create, bodies };
}

const toolCall = (id: string, name: string, args: string) => ({ id, type: 'function' as const, function: { name, arguments: args } });

describe('simulated advisor', () => {
  it('needs an OpenAI key', async () => {
    const sim = new SimAdvisor(ctx);
    expect(sim.available).toBe(false);
    await expect(sim.chat(sid, 'hi')).rejects.toMatchObject({ status: 503 });
    await expect(sim.chat(sid, 'hi')).rejects.toBeInstanceOf(SimError);
  });

  it('offers the same tools the MCP server lists', () => {
    expect(openAiTools().map((t) => (t.type === 'function' ? t.function.name : '')).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it('runs tool calls against the session until the model answers, and keeps the transcript', async () => {
    const { create, bodies } = scripted([
      { role: 'assistant', content: null, refusal: null, tool_calls: [toolCall('t1', 'showShortlist', '{}'), toolCall('t2', 'updateLead', '{"purpose":"Relocating"}')] },
      { role: 'assistant', content: 'Here are the two that match what you told me.', refusal: null },
    ]);
    const sim = new SimAdvisor(ctx, { create, deps: offlineDeps, recordTranscript: true });
    const turn = await sim.chat(sid, 'Show me what is available');
    expect(turn.reply).toBe('Here are the two that match what you told me.');
    expect(turn.toolCalls.map((c) => [c.name, c.result.ok])).toEqual([
      ['showShortlist', true],
      ['updateLead', true],
    ]);
    const state = ctx.store.get(sid)!;
    expect(state.view).toBe('shortlist');
    expect(state.lead.purpose).toBe('Relocating');
    expect(state.transcript.map((l) => l.role)).toEqual(['agent', 'buyer', 'agent']);

    // Each model call starts with the brief and the live screen line, then the conversation.
    const second = bodies[1] as { messages: { role: string; content: string | null }[] };
    expect(second.messages[0]!.content).toContain('You are Asha');
    expect(second.messages[1]!.content).toMatch(/^SCREEN: /);
    expect(second.messages.filter((m) => m.role === 'tool')).toHaveLength(2);
  });

  it('turns malformed arguments into a refusal the model can correct', async () => {
    const { create } = scripted([
      { role: 'assistant', content: null, refusal: null, tool_calls: [toolCall('t1', 'tourGoTo', '{"stop": ')] },
      { role: 'assistant', content: 'Which room would you like to see?', refusal: null },
    ]);
    const turn = await new SimAdvisor(ctx, { create, deps: offlineDeps }).chat(sid, 'go');
    expect(turn.toolCalls[0]!.result.ok).toBe(false);
    expect(turn.reply).toMatch(/room/);
  });

  it('stops a runaway tool loop with a short apology', async () => {
    const { create } = scripted([{ role: 'assistant', content: null, refusal: null, tool_calls: [toolCall('t', 'showShortlist', '{}')] }]);
    const turn = await new SimAdvisor(ctx, { create, deps: offlineDeps }).chat(sid, 'loop');
    expect(turn.toolCalls.length).toBeGreaterThan(1);
    expect(turn.reply).toMatch(/Sorry/);
  });
});
