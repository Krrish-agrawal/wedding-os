import { afterEach, describe, expect, it, vi } from 'vitest';
import { runTool } from './runner.js';
import { PARALLEL_VIEW_WINDOW_MS } from './kit.js';
import { newSession, offlineDeps, saleBundle, toolTestContext } from './testkit.js';

describe('parallel view switches', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps the blueprint when the model also moves the tour in the same breath', async () => {
    const ctx = await toolTestContext();
    const id = newSession(ctx);
    const propertyId = saleBundle(ctx).property.id;
    await runTool(ctx, id, 'openProperty', { propertyId }, { deps: offlineDeps });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 5_000);
    await runTool(ctx, id, 'showBlueprint', { layer: 'electrical', room: 'kitchen' }, { deps: offlineDeps });
    await runTool(ctx, id, 'tourGoTo', { stop: 'kitchen' }, { deps: offlineDeps });
    expect(ctx.store.get(id)?.view).toBe('blueprint');
  });

  it('lets a later, separate request move back to the tour', async () => {
    const ctx = await toolTestContext();
    const id = newSession(ctx);
    const propertyId = saleBundle(ctx).property.id;
    await runTool(ctx, id, 'openProperty', { propertyId }, { deps: offlineDeps });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 5_000);
    await runTool(ctx, id, 'showBlueprint', { layer: 'electrical' }, { deps: offlineDeps });
    vi.setSystemTime(Date.now() + PARALLEL_VIEW_WINDOW_MS + 50);
    await runTool(ctx, id, 'tourGoTo', { stop: 'kitchen' }, { deps: offlineDeps });
    expect(ctx.store.get(id)?.view).toBe('tour');
  });
});
