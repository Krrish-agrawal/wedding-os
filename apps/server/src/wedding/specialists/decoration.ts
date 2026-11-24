import { z } from 'zod';
import { DECOR_CATALOG, COLOR_NAMES, PRICE_NOTE, bounds, findEntry, formatInr, resolveColor, sceneCost, studioRoom, type DecorCategory, type DecorObject } from '@ave/shared';
import { apply, defineTool, effectiveColors, entryName, fail, ok, propose, resolveAsset, resolvePart, shortId, state, toFail, type Specialist, type ToolContext, type ToolResult } from '../toolkit.js';

/**
 * Decoration specialist: the tools that change the 3D wedding scene. Each one dispatches validated actions
 * (add_decors, move_decor, set_decor_colors, undo_scene, ...) through the shared reducer, so placement,
 * collision, stage support and the customer's decoration limit are enforced there, not here.
 */

const Id = z.string().min(1).max(40);
const Category = z.enum(['mandap', 'stage', 'arch', 'floral', 'seating', 'lighting']);
const ColorName = z.string().trim().min(1).max(40).describe(`A colour name (${COLOR_NAMES.slice(0, 14).join(', ')}, …) or a #rrggbb hex. "default" restores the original colour.`);

function sceneObject(ctx: ToolContext, id: string): { obj: DecorObject } | { result: ToolResult } {
  const s = state(ctx);
  const obj = s.scene.objects.find((o) => o.id === id);
  if (obj) return { obj };
  return { result: fail(`There is no decoration with id "${id}" in the scene.`, s.scene.objects.length ? `Call listSceneDecorations and use one of these ids: ${s.scene.objects.map((o) => o.id).join(', ')}.` : 'The scene is empty. Add something with addDecoration first.') };
}

/** Colour name to hex, or an error result the model can act on. */
function color(input: string): { hex: string | null } | { result: ToolResult } {
  if (/^(default|reset|original)$/i.test(input.trim())) return { hex: null };
  const hex = resolveColor(input);
  return hex ? { hex } : { result: fail(`I don't know the colour "${input}".`, `Use a hex value like #ec7aa3 or one of: ${COLOR_NAMES.join(', ')}.`) };
}

const where = (o: DecorObject) => `(${o.position.x.toFixed(1)}, ${o.position.z.toFixed(1)}) m${o.position.y > 0 ? `, ${o.position.y.toFixed(1)} m up` : ''}`;

export const decorationSpecialist: Specialist = {
  id: 'decoration',
  title: 'Decoration',
  summary: 'Adds, moves, recolours and removes decorations in the 3D venue; saves and loads designs; undoes changes.',
  tools: [
    defineTool({
      name: 'listDecorationAssets',
      description: 'List the decoration catalogue: what can be added, where each can be mounted (floor, stage, wall, ceiling), its colour parts, size, and SAMPLE price. Call before adding something you are unsure about.',
      input: z.object({ category: Category.optional() }),
      label: () => 'Looking through the decoration catalogue',
      run: ({ category }) => {
        const assets = DECOR_CATALOG.filter((e) => !category || e.category === (category as DecorCategory)).map((e) => ({
          assetId: e.id, name: e.name, category: e.category, mounts: e.mounts, sizeMetres: e.size,
          colorParts: e.parts.map((p) => ({ part: p.id, label: p.label, defaultColor: p.color })), samplePriceInr: e.samplePrice, priceIsSample: true,
        }));
        return ok(`${assets.length} decoration assets available.`, { assets, note: PRICE_NOTE });
      },
    }),

    defineTool({
      name: 'listSceneDecorations',
      description: 'List what is in the 3D scene right now: ids, names, mounts, positions, rotation, size, current colours per part, which one is selected in the studio, and which were just changed. Call this to find ids before moving, recolouring or removing, and to verify a change.',
      input: z.object({}),
      label: () => 'Checking the scene',
      run: (_i, ctx) => {
        const s = state(ctx);
        const room = studioRoom(s);
        const b = bounds(room);
        const objects = s.scene.objects.map((o) => {
          const e = findEntry(DECOR_CATALOG, o.catalogId)!;
          return {
            id: o.id, assetId: o.catalogId, name: e.name, category: e.category, mount: o.mount,
            xMetres: o.position.x, zMetres: o.position.z, heightAboveFloorMetres: o.position.y,
            rotationDegrees: Math.round((o.rotationY * 180) / Math.PI), scale: o.scale,
            colors: effectiveColors(o, e), colorParts: e.parts.map((p) => p.id),
            selectedInStudio: o.id === ctx.session.selectedId, recentlyChanged: ctx.session.lastTouched.includes(o.id),
          };
        });
        return ok(`${objects.length} decorations in the scene.`, {
          venue: { name: room.name, widthMetres: b.width, depthMetres: b.depth, heightMetres: room.height },
          directions: 'x grows to the right, z grows toward the viewer (the near side); "left" is smaller x, "forward" is smaller z.',
          hasStage: objects.some((o) => o.category === 'stage'),
          objects, estimatedCostInr: sceneCost(s.scene.objects), priceIsSample: true,
        });
      },
    }),

    defineTool({
      name: 'addDecoration',
      description: 'Add one or more copies of a catalogue decoration to the scene. Use mount "stage" to place it on top of a wedding stage (the scene must already contain one). Floor, wall and ceiling pieces find the nearest free spot automatically unless x and z are given. Optionally set starting colours per part. All copies are added together or not at all. If it would take the decoration estimate past the customer\'s own limit, nothing is added: it creates a proposal the customer must confirm in the chat.',
      input: z.object({
        assetId: z.string().min(1).max(80).describe('Catalogue id or name, e.g. "mandap-traditional".'),
        mount: z.enum(['floor', 'stage', 'wall', 'ceiling']).optional().describe('Defaults to the asset\'s first mount.'),
        quantity: z.number().int().min(1).max(12).default(1),
        x: z.number().finite().min(-1000).max(1000).optional(),
        z: z.number().finite().min(-1000).max(1000).optional(),
        colors: z.record(z.string().max(30), ColorName).optional().describe('Part id to colour, e.g. {"flowers":"yellow"}.'),
      }),
      label: (i) => { const f = resolveAsset(i.assetId); return `Adding ${i.quantity > 1 ? `${i.quantity} × ` : ''}${'entry' in f ? f.entry.name : i.assetId}${i.mount === 'stage' ? ' on the stage' : ''}`; },
      run: (i, ctx) => {
        const found = resolveAsset(i.assetId);
        if ('error' in found) return fail(found.error, found.hint);
        const colors: Record<string, string> = {};
        for (const [partInput, c] of Object.entries(i.colors ?? {})) {
          const part = resolvePart(found.entry, partInput);
          if (!part) return fail(`${found.entry.name} has no "${partInput}" part.`, `Its parts are: ${found.entry.parts.map((p) => p.id).join(', ')}.`);
          const hex = color(c);
          if ('result' in hex) return hex.result;
          if (hex.hex) colors[part.id] = hex.hex;
        }
        const mount = i.mount ?? found.entry.mounts[0]!;
        if (mount === 'stage' && !state(ctx).scene.objects.some((o) => findEntry(DECOR_CATALOG, o.catalogId)?.category === 'stage')) {
          return fail('There is no wedding stage in the scene to place it on.', 'Add the wedding stage first (assetId "stage-wedding"), then add this with mount "stage".');
        }
        const items = Array.from({ length: i.quantity }, () => ({ id: shortId(), catalogId: found.entry.id, mount, ...(i.x !== undefined && i.z !== undefined ? { x: i.x, z: i.z } : {}), ...(Object.keys(colors).length ? { colors } : {}) }));
        const r = apply(ctx, { type: 'add_decors', items });
        if (!r.ok) {
          if (r.code !== 'over_limit') return toFail(r);
          const s = state(ctx);
          const after = sceneCost([...s.scene.objects, ...items]);
          return propose(ctx, {
            tool: 'addDecoration', kind: 'scene', summary: `Add ${i.quantity > 1 ? `${i.quantity} × ` : ''}${found.entry.name}, taking decoration past your limit`,
            changes: [{ label: 'Decoration estimate (sample prices)', from: formatInr(sceneCost(s.scene.objects)), to: formatInr(after) }, { label: 'Your decoration limit', from: formatInr(s.budget.limits.decoration ?? 0), to: 'exceeded' }],
            action: { type: 'add_decors', items, acceptOverBudget: true },
          });
        }
        const added = items.map((it) => r.state.scene.objects.find((o) => o.id === it.id)!);
        return ok(`Added ${i.quantity > 1 ? `${i.quantity} × ` : ''}${found.entry.name}${mount === 'stage' ? ' on the stage' : ''}.`, {
          added: added.map((o) => ({ id: o.id, name: found.entry.name, mount: o.mount, xMetres: o.position.x, zMetres: o.position.z, heightAboveFloorMetres: o.position.y })),
          sceneEstimateInr: sceneCost(r.state.scene.objects), priceIsSample: true,
        });
      },
    }),

    defineTool({
      name: 'moveDecoration',
      description: 'Move one decoration. Either give absolute x and z in metres, or a direction (left, right, forward, back) and a distance in metres (default 0.5, about "slightly"). left = smaller x, right = larger x, forward = away from the viewer (smaller z), back = toward the viewer. Wall pieces slide along walls; y raises or lowers a wall piece. Refused if it would collide, leave the venue or leave its stage.',
      input: z.object({
        id: Id,
        x: z.number().finite().min(-1000).max(1000).optional(),
        z: z.number().finite().min(-1000).max(1000).optional(),
        direction: z.enum(['left', 'right', 'forward', 'back']).optional(),
        distance: z.number().finite().min(0.05).max(50).default(0.5),
        y: z.number().finite().min(0).max(30).optional(),
      }),
      label: (i) => (i.direction ? `Moving it ${i.direction}` : 'Moving the decoration'),
      run: (i, ctx) => {
        const f = sceneObject(ctx, i.id);
        if ('result' in f) return f.result;
        const usingAbsolute = i.x !== undefined || i.z !== undefined;
        if (usingAbsolute && i.direction) return fail('Give either x and z, or a direction, not both.', 'Pick one way to describe the move.');
        if (!usingAbsolute && !i.direction && i.y === undefined) return fail('No destination given.', 'Provide x and z, or a direction with a distance.');
        let x = i.x ?? f.obj.position.x;
        let z = i.z ?? f.obj.position.z;
        if (i.direction) {
          if (i.direction === 'left') x -= i.distance;
          else if (i.direction === 'right') x += i.distance;
          else if (i.direction === 'forward') z -= i.distance;
          else z += i.distance;
        }
        const r = apply(ctx, { type: 'move_decor', id: i.id, x, z, ...(i.y !== undefined ? { y: i.y } : {}) });
        if (!r.ok) return toFail(r);
        const o = r.state.scene.objects.find((q) => q.id === i.id)!;
        return ok(`Moved the ${entryName(o.catalogId)} to ${where(o)}.`, { id: o.id, xMetres: o.position.x, zMetres: o.position.z, heightAboveFloorMetres: o.position.y, rotationDegrees: Math.round((o.rotationY * 180) / Math.PI) });
      },
    }),

    defineTool({
      name: 'rotateDecoration',
      description: 'Turn one decoration. Positive degrees turn it left (counter-clockwise seen from above). mode "by" (default) adds to its current rotation; "to" sets it. Wall pieces cannot be turned, and a stage with things on it cannot be turned.',
      input: z.object({ id: Id, degrees: z.number().finite().min(-360).max(360), mode: z.enum(['by', 'to']).default('by') }),
      label: () => 'Turning the decoration',
      run: (i, ctx) => {
        const f = sceneObject(ctx, i.id);
        if ('result' in f) return f.result;
        const rotationY = i.mode === 'to' ? (i.degrees * Math.PI) / 180 : f.obj.rotationY + (i.degrees * Math.PI) / 180;
        const r = apply(ctx, { type: 'rotate_decor', id: i.id, rotationY });
        if (!r.ok) return toFail(r);
        const o = r.state.scene.objects.find((q) => q.id === i.id)!;
        return ok(`Turned the ${entryName(o.catalogId)} to ${Math.round((o.rotationY * 180) / Math.PI)}°.`, { id: o.id, rotationDegrees: Math.round((o.rotationY * 180) / Math.PI) });
      },
    }),

    defineTool({
      name: 'scaleDecoration',
      description: 'Resize one decoration. Give either an absolute scale (0.5 to 2.5, where 1 is normal size) or a factor to multiply the current scale by (e.g. 1.2 for 20% bigger).',
      input: z.object({ id: Id, scale: z.number().finite().optional(), factor: z.number().finite().positive().optional() }),
      label: () => 'Resizing the decoration',
      run: (i, ctx) => {
        const f = sceneObject(ctx, i.id);
        if ('result' in f) return f.result;
        if ((i.scale === undefined) === (i.factor === undefined)) return fail('Give exactly one of scale or factor.', 'For example scale: 1.5, or factor: 1.2.');
        const scale = Math.round((i.scale ?? f.obj.scale * (i.factor as number)) * 1000) / 1000;
        const r = apply(ctx, { type: 'scale_decor', id: i.id, scale });
        if (!r.ok) return toFail(r);
        return ok(`Resized the ${entryName(f.obj.catalogId)} to ×${scale}.`, { id: i.id, scale });
      },
    }),

    defineTool({
      name: 'changeDecorationMaterial',
      description: 'Change the colour of one named part (for example "flowers", "pillars", "canopy", "frame") on specific decorations, or on every decoration that has that part (allWithPart: true). Only that part changes; every other part keeps its colour. Use colour "default" to restore the original.',
      input: z.object({ ids: z.array(Id).min(1).max(100).optional(), allWithPart: z.boolean().optional(), part: z.string().min(1).max(30), color: ColorName }),
      label: (i) => `Updating ${i.part} to ${i.color}`,
      run: (i, ctx) => {
        const s = state(ctx);
        if ((i.ids === undefined) === (i.allWithPart === undefined)) return fail('Give either ids or allWithPart, not both and not neither.', 'Use allWithPart: true for "make the flowers pink"; use ids to change specific objects.');
        const c = color(i.color);
        if ('result' in c) return c.result;
        let ids: string[];
        let partId = i.part.trim().toLowerCase();
        if (i.allWithPart) {
          const matching = s.scene.objects.filter((o) => { const e = findEntry(DECOR_CATALOG, o.catalogId); return e && resolvePart(e, i.part); });
          if (matching.length === 0) return fail(`Nothing in the scene has a "${i.part}" part.`, 'Call listSceneDecorations to see each object\'s colorParts, or add decorations first.');
          partId = resolvePart(findEntry(DECOR_CATALOG, matching[0]!.catalogId)!, i.part)!.id;
          ids = matching.map((o) => o.id);
        } else {
          ids = i.ids!;
          for (const id of ids) {
            const f = sceneObject(ctx, id);
            if ('result' in f) return f.result;
            const e = findEntry(DECOR_CATALOG, f.obj.catalogId)!;
            if (!resolvePart(e, i.part)) return fail(`The ${e.name} has no "${i.part}" part.`, `Its parts are: ${e.parts.map((p) => p.id).join(', ')}.`);
          }
          partId = resolvePart(findEntry(DECOR_CATALOG, s.scene.objects.find((o) => o.id === ids[0])!.catalogId)!, i.part)!.id;
        }
        const r = apply(ctx, { type: 'set_decor_colors', ids, part: partId, color: c.hex });
        if (!r.ok) return toFail(r);
        return ok(`Set the ${partId} colour to ${c.hex ?? 'default'} on ${ids.length} decoration${ids.length === 1 ? '' : 's'}.`, {
          changed: ids.map((id) => ({ id, name: entryName(s.scene.objects.find((o) => o.id === id)!.catalogId) })), part: partId, colorHex: c.hex, otherPartsUnchanged: true,
        });
      },
    }),

    defineTool({
      name: 'duplicateDecoration',
      description: 'Make a copy of one decoration (same colours, same mount) at the nearest free spot. If it would take the decoration estimate past the customer\'s own limit, it creates a proposal the customer must confirm in the chat.',
      input: z.object({ id: Id }),
      label: () => 'Duplicating the decoration',
      run: (i, ctx) => {
        const f = sceneObject(ctx, i.id);
        if ('result' in f) return f.result;
        const newId = shortId();
        const r = apply(ctx, { type: 'duplicate_decor', id: i.id, newId });
        if (!r.ok) {
          if (r.code !== 'over_limit') return toFail(r);
          const s = state(ctx);
          const after = sceneCost([...s.scene.objects, { catalogId: f.obj.catalogId }]);
          return propose(ctx, {
            tool: 'duplicateDecoration', kind: 'scene', summary: `Duplicate the ${entryName(f.obj.catalogId)}, taking decoration past your limit`,
            changes: [{ label: 'Decoration estimate (sample prices)', from: formatInr(sceneCost(s.scene.objects)), to: formatInr(after) }, { label: 'Your decoration limit', from: formatInr(s.budget.limits.decoration ?? 0), to: 'exceeded' }],
            action: { type: 'duplicate_decor', id: i.id, newId, acceptOverBudget: true },
          });
        }
        const o = r.state.scene.objects.find((q) => q.id === newId)!;
        return ok(`Duplicated the ${entryName(o.catalogId)}.`, { id: newId, xMetres: o.position.x, zMetres: o.position.z });
      },
    }),

    defineTool({
      name: 'removeDecoration',
      description: 'Remove one or more decorations by id, together as a single change. A wedding stage can only be removed together with everything standing on it.',
      input: z.object({ ids: z.array(Id).min(1).max(50) }),
      label: (i) => `Removing ${i.ids.length} decoration${i.ids.length === 1 ? '' : 's'}`,
      run: (i, ctx) => {
        const s = state(ctx);
        for (const id of i.ids) {
          const f = sceneObject(ctx, id);
          if ('result' in f) return f.result;
        }
        const names = i.ids.map((id) => entryName(s.scene.objects.find((o) => o.id === id)!.catalogId));
        const r = apply(ctx, { type: 'remove_decors', ids: i.ids });
        if (!r.ok) return toFail(r);
        return ok(`Removed ${names.join(', ')}.`, { removed: i.ids.map((id, k) => ({ id, name: names[k] })), sceneEstimateInr: sceneCost(r.state.scene.objects), priceIsSample: true });
      },
    }),

    defineTool({
      name: 'undoDecorationAction',
      description: 'Undo scene changes using the shared history. By default undoes one change. Use lastRequest: true to undo everything the previous customer request changed in the scene (e.g. "undo that"); use steps for an exact number. Changes made in the studio by hand are in the same history.',
      input: z.object({ steps: z.number().int().min(1).max(30).optional(), lastRequest: z.boolean().optional() }),
      label: () => 'Undoing the last change',
      run: (i, ctx) => {
        const s = state(ctx);
        const available = s.sceneHistory.past.length;
        if (available === 0) return fail('There is nothing to undo.', 'No earlier scene change is recorded.');
        let steps = i.steps ?? 1;
        let note: string | undefined;
        if (i.lastRequest) {
          const lr = ctx.session.lastRequest;
          if (lr && lr.after === JSON.stringify(s.scene.objects)) steps = lr.steps;
          else note = 'The scene was changed after the last request, so only the most recent change was undone.';
        }
        steps = Math.min(steps, available);
        let undone = 0;
        for (let k = 0; k < steps; k++) {
          const r = apply(ctx, { type: 'undo_scene' });
          if (!r.ok) return undone ? ok(`Undid ${undone} change(s), then stopped: ${r.error}`, { undone }) : toFail(r);
          undone++;
        }
        ctx.session.lastRequest = null;
        const after = state(ctx);
        return ok(`Undid ${undone} change${undone === 1 ? '' : 's'}.`, { undone, note, objectsNow: after.scene.objects.length, sceneEstimateInr: sceneCost(after.scene.objects), priceIsSample: true, canUndoMore: after.sceneHistory.past.length });
      },
    }),

    defineTool({
      name: 'saveWeddingDesign',
      description: 'Save the current 3D decoration layout under a name so it can be loaded later. Saving with an existing name replaces that design.',
      input: z.object({ name: z.string().trim().min(1).max(60) }),
      label: (i) => `Saving the design "${i.name}"`,
      run: (i, ctx) => {
        const s = state(ctx);
        const existing = s.designs.find((d) => d.name.toLowerCase() === i.name.toLowerCase());
        const id = existing?.id ?? shortId();
        const r = apply(ctx, { type: 'save_design', id, name: i.name });
        if (!r.ok) return toFail(r);
        return ok(`Saved the design "${i.name}" (${r.state.scene.objects.length} decorations).`, { designId: id, name: i.name, decorations: r.state.scene.objects.length, replaced: !!existing });
      },
    }),

    defineTool({
      name: 'loadWeddingDesign',
      description: 'Replace the current scene with a saved design, by designId or by name. The load itself can be undone.',
      input: z.object({ designId: Id.optional(), name: z.string().trim().min(1).max(60).optional() }),
      label: () => 'Loading a saved design',
      run: (i, ctx) => {
        const s = state(ctx);
        if (!i.designId && !i.name) return fail('Say which design to load.', `Saved designs: ${s.designs.map((d) => `${d.name} (${d.id})`).join(', ') || 'none yet'}.`);
        const needle = i.name?.toLowerCase();
        const d = s.designs.find((x) => x.id === i.designId) ?? s.designs.find((x) => x.name.toLowerCase() === needle) ?? (() => { const m = s.designs.filter((x) => needle && x.name.toLowerCase().includes(needle)); return m.length === 1 ? m[0] : undefined; })();
        if (!d) return fail(`No saved design matches "${i.name ?? i.designId}".`, `Saved designs: ${s.designs.map((x) => `${x.name} (${x.id})`).join(', ') || 'none yet'}.`);
        const r = apply(ctx, { type: 'load_design', id: d.id });
        if (!r.ok) return toFail(r);
        return ok(`Loaded the design "${d.name}" (${d.objects.length} decorations).`, { designId: d.id, name: d.name, decorations: d.objects.length, sceneEstimateInr: sceneCost(r.state.scene.objects), priceIsSample: true });
      },
    }),
  ],
};

