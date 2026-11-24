import { afterEach, describe, expect, it, vi } from 'vitest';
import { weddingApi } from './api';

/** The server rejects a body-less request that claims to be JSON (400 FST_ERR_CTP_EMPTY_JSON_BODY); the client must not send that. */
describe('weddingApi requests', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stub() {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ state: {}, proposal: {}, proposals: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    return calls;
  }
  const header = (c: { init: RequestInit }, name: string) => new Headers(c.init.headers).get(name);

  it('sends no JSON content-type on POSTs without a body: confirm, cancel and reset', async () => {
    const calls = stub();
    await weddingApi.confirm('w1', 'p1');
    await weddingApi.cancel('w1', 'p1');
    await weddingApi.reset('w1');
    expect(calls.map((c) => c.url)).toEqual(['/api/wedding/w1/proposals/p1/confirm', '/api/wedding/w1/proposals/p1/cancel', '/api/wedding/w1/reset']);
    for (const c of calls) {
      expect(c.init.method).toBe('POST');
      expect(c.init.body).toBeUndefined();
      expect(header(c, 'content-type')).toBeNull();
    }
  });

  it('sends a JSON content-type on requests that do have a body', async () => {
    const calls = stub();
    await weddingApi.act('w1', { type: 'set_total_budget', total: 5 });
    expect(header(calls[0]!, 'content-type')).toBe('application/json');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ type: 'set_total_budget', total: 5 });
  });

  it('surfaces the server error message, and a clear one when the server is unreachable', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'This proposal has already been used.' }), { status: 409 }));
    await expect(weddingApi.confirm('w', 'p')).rejects.toThrow('already been used');
    vi.stubGlobal('fetch', async () => { throw new TypeError('network'); });
    await expect(weddingApi.get('w')).rejects.toThrow(/Cannot reach the server/);
  });
});
