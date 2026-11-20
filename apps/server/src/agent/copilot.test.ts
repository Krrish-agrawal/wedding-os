import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type OpenAI from 'openai';
import type { CopilotResult } from '@ave/shared';
import type { AppContext } from '../context.js';
import '../context.js';
import { previewsFor } from '../desk/outbound.js';
import { registerDesk, unregisterDesk, type DeskRuntime } from '../desk/runtime.js';
import { Clock, FakeWhatsApp, firstProperty, testContext, testRuntime } from '../desk/testkit.js';
import { offlineDeps } from '../tools/testkit.js';
import { COPILOT_MAX_TOOL_ROUNDS, Copilot, copilotRoutes, DRAFT_TOOL_NAMES } from './copilot.js';
import type { ChatCreate } from './sim.js';

type Completion = OpenAI.Chat.Completions.ChatCompletion;
type Message = Completion['choices'][number]['message'];

const PUBLIC_BASE = 'https://demo.example.com';

let ctx: AppContext;
let desk: DeskRuntime;
let whatsapp: FakeWhatsApp;
let sid: string;

beforeEach(async () => {
  const clock = new Clock();
  ctx = await testContext({ PUBLIC_BASE_URL: PUBLIC_BASE, AUTOMATIONS: 'none' }, clock);
  whatsapp = new FakeWhatsApp();
  desk = testRuntime(ctx, clock, { whatsapp });
  registerDesk(ctx, desk);
  const s = ctx.store.create({ name: 'Priya Sharma', phone: '98765 43210', email: 'priya@example.com' });
  ctx.store.dispatch(s.id, { type: 'set_status', status: 'live' }, 'system');
  ctx.store.dispatch(s.id, { type: 'set_handoff', patch: { status: 'joined', humanName: 'Rahul Mehta' } }, 'advisor');
  sid = s.id;
});

afterEach(() => unregisterDesk(ctx));

/** A scripted model: each call returns the next canned message and the request is kept. */
function scripted(messages: Message[]): { create: ChatCreate; bodies: { messages: { role: string; content: string | null }[]; tools: { function: { name: string; parameters: { properties: Record<string, unknown> } } }[] }[] } {
  const bodies: ReturnType<typeof scripted>['bodies'] = [];
  let i = 0;
  const create: ChatCreate = async (body) => {
    bodies.push(structuredClone(body) as unknown as (typeof bodies)[number]);
    const message = messages[Math.min(i++, messages.length - 1)]!;
    return { id: `c${i}`, object: 'chat.completion', created: 0, model: body.model, choices: [{ index: 0, finish_reason: 'stop', logprobs: null, message }] } as Completion;
  };
  return { create, bodies };
}

const call = (id: string, name: string, args: unknown) => ({ id, type: 'function' as const, function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } });
const toolTurn = (...calls: ReturnType<typeof call>[]): Message => ({ role: 'assistant', content: null, refusal: null, tool_calls: calls });
const say = (content: string): Message => ({ role: 'assistant', content, refusal: null });

describe('copilot', () => {
  it('changes the screen as the advisor and drafts a WhatsApp photo without sending it', async () => {
    const apt = firstProperty(ctx, 'sale');
    ctx.store.dispatch(sid, { type: 'set_property', propertyId: apt.property.id }, 'agent');
    const photo = `${PUBLIC_BASE}${apt.property.planImage.replace(/\.webp$/, '.jpg')}`;
    const { create, bodies } = scripted([
      toolTurn(call('t1', 'showBlueprint', { layer: 'plumbing', room: 'bathroom', tone: 'warm' }), call('t2', 'draftWhatsApp', { text: 'Hi Priya, the floor plan. Rahul', mediaUrl: photo })),
      say('Plumbing is on screen; the floor plan is ready to review.'),
    ]);
    const result = await new Copilot(ctx, { create, deps: offlineDeps }).run(sid, 'show the bathroom plumbing and send her the floor plan on WhatsApp');

    expect(result.reply).toBe('Plumbing is on screen; the floor plan is ready to review.');
    expect(result.steps.map((s) => [s.name, s.ok])).toEqual([
      ['showBlueprint', true],
      ['draftWhatsApp', true],
    ]);
    expect(result.steps[0]!.summary).toMatch(/^Showed the plan: .*Plumbing/);
    const state = ctx.store.get(sid)!;
    expect(state.view).toBe('blueprint');
    expect(state.params.blueprint.layer).toBe('plumbing');
    expect(state.timeline.filter((e) => e.kind === 'view').at(-1)?.source).toBe('advisor');

    expect(result.previews).toEqual([expect.objectContaining({ channel: 'whatsapp', to: '+919876543210', mediaUrl: photo, purpose: 'manual', sessionId: sid })]);
    expect(previewsFor(desk).get(sid, result.previews[0]!.id)).toBeDefined();
    expect(whatsapp.sent).toHaveLength(0);
    expect(state.deliveries).toHaveLength(0);

    // Brief and screen line on every call; admin-only tools; no face to set.
    const first = bodies[0]!;
    expect(first.messages[0]!.content).toContain('You never talk to Priya');
    expect(first.messages[0]!.content).toContain('signed by Rahul');
    expect(first.messages[0]!.content).toContain(photo);
    expect(first.messages[1]!.content).toMatch(/^SCREEN: /);
    const names = first.tools.map((t) => t.function.name);
    expect(names).not.toContain('requestHuman');
    expect(names).not.toContain('sendReport');
    for (const d of DRAFT_TOOL_NAMES) expect(names).toContain(d);
    expect(first.tools.find((t) => t.function.name === 'showBlueprint')!.function.parameters.properties).not.toHaveProperty('tone');
  });

  it('refuses photo URLs that are not ours, tools it does not offer, and bad arguments', async () => {
    const { create } = scripted([
      toolTurn(
        call('t1', 'draftWhatsApp', { text: 'Look', mediaUrl: 'https://evil.example.com/x.jpg' }),
        call('t2', 'requestHuman', { reason: 'x' }),
        call('t3', 'draftJiraTask', { summary: '' }),
        call('t4', 'tourGoTo', '{"stop": '),
      ),
      say('I could not do that.'),
    ]);
    const result = await new Copilot(ctx, { create, deps: offlineDeps }).run(sid, 'do odd things');
    expect(result.steps.map((s) => s.ok)).toEqual([false, false, false, false]);
    expect(result.steps[0]!.summary).toMatch(/not one of the listed photos/);
    expect(result.steps[1]!.summary).toMatch(/no tool called "requestHuman"/);
    expect(result.previews).toEqual([]);
    expect(ctx.store.get(sid)!.handoff.status).toBe('joined');
  });

  it('drafts Jira, Slack, email and the recap as previews with the right recipients', async () => {
    const { create } = scripted([
      toolTurn(
        call('t1', 'draftJiraTask', { summary: 'Manager approval: 2% discount for Priya Sharma', description: 'Asked during the consult.', dueInDays: 1 }),
        call('t2', 'draftSlackPost', { text: 'Priya Sharma wants 2% off Larkspur Court.' }),
        call('t3', 'draftEmail', { subject: 'Your price sheet', text: 'Hi Priya,\n\nAttached.' }),
        call('t4', 'draftRecap', { channel: 'email' }),
      ),
      say(''),
    ]);
    const result = await new Copilot(ctx, { create, deps: offlineDeps }).run(sid, 'jira: manager approval for 2% discount, tell the team, email her, and the recap');
    expect(result.previews.map((p) => [p.channel, p.to, p.purpose])).toEqual([
      ['jira', 'Jira AVE', 'manual'],
      ['slack', '#sales-pipeline', 'manual'],
      ['email', 'priya@example.com', 'manual'],
      ['email', 'priya@example.com', 'recap'],
    ]);
    expect(result.previews[0]).toMatchObject({ subject: 'Manager approval: 2% discount for Priya Sharma', dueInDays: 1 });
    expect(result.previews[3]!.subject).toBeTruthy();
    // The model answered with tool calls only; the admin still gets a line.
    expect(result.reply).toBe('Ready to review: 4 messages.');
  });

  it('runs one instruction at a time per call', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const create: ChatCreate = async (body) => {
      await gate;
      return { id: 'c', object: 'chat.completion', created: 0, model: body.model, choices: [{ index: 0, finish_reason: 'stop', logprobs: null, message: say('Done.') }] } as Completion;
    };
    const copilot = new Copilot(ctx, { create, deps: offlineDeps });
    const first = copilot.run(sid, 'show the shortlist');
    await expect(copilot.run(sid, 'show pricing')).rejects.toMatchObject({ status: 409 });
    release();
    await expect(first).resolves.toMatchObject({ reply: 'Done.' });
    expect(copilot.isBusy(sid)).toBe(false);
  });

  it('needs a key, a running call, and stops a runaway loop', async () => {
    await expect(new Copilot(ctx, { create: null }).run(sid, 'x')).rejects.toMatchObject({ status: 503 });
    await expect(new Copilot(ctx, { create: scripted([say('x')]).create }).run('nope', 'x')).rejects.toMatchObject({ status: 404 });

    const loop = scripted([toolTurn(call('t', 'showShortlist', {}))]);
    const result = await new Copilot(ctx, { create: loop.create, deps: offlineDeps }).run(sid, 'loop');
    expect(result.steps).toHaveLength(COPILOT_MAX_TOOL_ROUNDS);
    expect(result.reply).toMatch(/too many steps/);

    ctx.store.dispatch(sid, { type: 'set_status', status: 'ended' }, 'system');
    await expect(new Copilot(ctx, { create: scripted([say('x')]).create }).run(sid, 'x')).rejects.toMatchObject({ status: 409 });
  });
});

describe('copilot route', () => {
  async function server(create: ChatCreate | null) {
    const app = Fastify({ logger: false });
    app.decorate('ctx', ctx);
    await app.register(copilotRoutes, { create, deps: offlineDeps });
    await app.ready();
    return app;
  }

  it('answers with the result and marks a view next step done', async () => {
    ctx.store.dispatch(
      sid,
      { type: 'set_consult', patch: { notes: { summary: '', buyerAsks: [], promises: [], objections: [], nextSteps: [{ id: 'v1', text: 'Show EMI', action: { kind: 'view', command: 'show the EMI' }, doneRef: null }] } } },
      'system',
    );
    const { create } = scripted([toolTurn(call('t1', 'showMoney', { tab: 'emi', downPaymentSpoken: '1.5 crore', tenureYears: 15 })), say('EMI is on screen.')]);
    const app = await server(create);
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${sid}/copilot`, payload: { command: 'EMI with 1.5 crore down over 15 years', nextStepId: 'v1' } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as CopilotResult).reply).toBe('EMI is on screen.');
    expect(ctx.store.get(sid)!.view).toBe('money');
    expect(ctx.store.get(sid)!.consult.notes!.nextSteps[0]!.doneRef).toBe('done');
    expect((await app.inject({ method: 'POST', url: `/api/sessions/${sid}/copilot`, payload: { command: '  ' } })).statusCode).toBe(400);
    await app.close();
  });

  it('says plainly when OpenAI is not configured', async () => {
    const app = await server(null);
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${sid}/copilot`, payload: { command: 'show pricing' } });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: expect.stringMatching(/OPENAI_API_KEY/) });
    await app.close();
  });
});
