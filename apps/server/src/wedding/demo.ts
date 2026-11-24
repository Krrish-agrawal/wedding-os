import { COLOR_NAMES, DECOR_CATALOG, findEntry, formatInr, resolveColor, type DecorObject } from '@ave/shared';
import { BUDGET_CATEGORIES, type BudgetCategory } from '@ave/shared';
import { CATEGORY_INFO, CATEGORY_LABELS, GARMENTS, findGarment, type Garment, type GarmentCategory } from '@ave/shared';
import { tryOnRequestsFor } from './tryon-requests.js';
import { VENDOR_CATEGORIES, VENDOR_CATEGORY_LABELS, type VendorCategory } from '@ave/shared';
import { metresIn, parseAmount, parseDate, quantityBefore } from './parse.js';
import { state, type PlannerSession, type ToolContext, type ToolResult } from './toolkit.js';

/**
 * Demo mode: no language model. A small rule-based router turns plain requests into the SAME tool calls the live
 * model would make, through the same executor, validators and reducer. It adds no business logic of its own: it
 * decides which tools to call and in what order, and reports what the tools returned. A request it cannot
 * understand gets an explicit "not supported" reply; it never claims an action it did not run.
 */

export type Exec = (name: string, args: Record<string, unknown>) => ToolResult;

interface Env {
  exec: Exec;
  ctx: ToolContext;
  notes: string[];
}

const report = (r: ToolResult) => (r.ok ? `✓ ${r.summary}` : r.proposal ? `⏸ Proposed: ${r.proposal.summary}. Nothing has changed yet. Press Confirm below to apply it, or Cancel.` : `✗ ${r.error} ${r.hint}`);
const data = <T,>(r: ToolResult) => (r.ok ? (r.data as T) : undefined);
const scene = (env: Env) => state(env.ctx).scene.objects;

// ---- vocabulary ----------------------------------------------------------------------------------------------

interface AssetWord {
  re: RegExp;
  assetId: string;
}
const ASSET_WORDS: AssetWord[] = [
  { re: /\b(?:floral|flower)\s+(?:wall\s+)?panels?\b|\bflower wall\b/, assetId: 'flowers-wall-panel' },
  { re: /\bflower\s+arch(?:es)?\b|\barch(?:es)?\b|\bgate\b/, assetId: 'arch-flower' },
  { re: /\b(?:flower\s+)?arrangements?\b|\bcentre ?pieces?\b|\bcenter ?pieces?\b|\bbouquets?\b|\bvases?\b/, assetId: 'flowers-centrepiece' },
  { re: /\bmandap(?:am|s)?\b/, assetId: 'mandap-traditional' },
  { re: /\bwedding stages?\b|\bstages?\b/, assetId: 'stage-wedding' },
  { re: /\bchairs?\b|\bseats?\b/, assetId: 'chair-banquet' },
  { re: /\bsofas?\b|\bcouch(?:es)?\b|\bloveseats?\b/, assetId: 'sofa-loveseat' },
  { re: /\bchandeliers?\b/, assetId: 'chandelier-crystal' },
  { re: /\bfairy[- ]lights?(?:\s+curtains?)?\b|\blight curtains?\b/, assetId: 'lights-fairy-curtain' },
  { re: /\blanterns?\b/, assetId: 'lantern-floor' },
];

const PART_WORDS: [RegExp, string][] = [
  [/\b(?:flowers?|blooms?|florals?|jasmine|marigolds?|petals?)\b/, 'flowers'], [/\bpillars?\b|\bposts?\b/, 'pillars'], [/\bcanop(?:y|ies)\b|\broof\b/, 'canopy'],
  [/\bframes?\b/, 'frame'], [/\bdrapes?\b|\bcurtains?\b(?!.*fairy)/, 'drapes'], [/\bfabric\b|\bupholstery\b/, 'fabric'], [/\bcarpet\b/, 'carpet'], [/\bplatform\b/, 'platform'],
  [/\bvases?\b/, 'vase'], [/\bleaves\b|\bfoliage\b/, 'leaves'], [/\bmetal\b/, 'metal'], [/\bseat cushions?\b/, 'seat'], [/\blights?\b|\bglow\b|\bbulbs?\b/, 'glow'],
];

/** Colour named in `text`, preferring two-word names ("warm white"). Returns the word and its hex. */
function colourIn(text: string): { name: string; hex: string } | null {
  const t = text.toLowerCase();
  const two = /\bwarm white\b/.exec(t);
  if (two) return { name: two[0], hex: resolveColor(two[0])! };
  const names = [...COLOR_NAMES].sort((a, b) => b.length - a.length);
  for (const n of names) if (new RegExp(`\\b${n}\\b`).test(t)) return { name: n, hex: resolveColor(n)! };
  return null;
}

const assetIdsIn = (text: string): string[] => {
  const t = text.toLowerCase();
  const out: string[] = [];
  for (const w of ASSET_WORDS) if (w.re.test(t)) out.push(w.assetId);
  if (/\bmodern\b/.test(t) && out.includes('mandap-traditional') && !/\btraditional\b/.test(t)) return out.map((a) => (a === 'mandap-traditional' ? 'mandap-modern' : a));
  return [...new Set(out)];
};

type Targets = { ids: string[]; via: 'noun' | 'pronoun' } | { problem: string };

/** Which scene objects a request refers to: by name ("the mandap"), else by "it"/"that"/"those" (selected, else just-changed). */
function targets(text: string, objects: DecorObject[], session: PlannerSession): Targets | null {
  const t = text.toLowerCase();
  const nouns = assetIdsIn(t).filter((a) => !(a === 'stage-wedding' && /\bon (?:the )?(?:wedding )?stage\b/.test(t)));
  const families = new Set(nouns.map((a) => (a.startsWith('mandap') ? 'mandap' : a)));
  if (nouns.length) {
    const ids = objects.filter((o) => families.has(o.catalogId.startsWith('mandap') ? 'mandap' : o.catalogId)).map((o) => o.id);
    return ids.length ? { ids, via: 'noun' } : { problem: `There is no ${nouns.map((a) => findEntry(DECOR_CATALOG, a)?.name.toLowerCase()).join(' or ')} in the scene yet.` };
  }
  if (/\b(it|that|this|those|them|these|the selected one|selected)\b/.test(t)) {
    const pool = session.selectedId && /\b(it|this|that|selected)\b/.test(t) ? [session.selectedId] : session.lastTouched;
    const ids = pool.filter((id) => objects.some((o) => o.id === id));
    return ids.length ? { ids, via: 'pronoun' } : { problem: 'I am not sure what "it" refers to. Select an object in the studio, or name it (for example "the mandap").' };
  }
  return null;
}

/** For actions on one object: narrow several matches to the selected one, or the one just changed, else ask. */
function single(t: Targets, session: PlannerSession, objects: DecorObject[]): { id: string } | { problem: string } {
  if ('problem' in t) return t;
  if (t.ids.length === 1) return { id: t.ids[0]! };
  const sel = t.ids.find((id) => id === session.selectedId);
  if (sel) return { id: sel };
  const recent = t.ids.filter((id) => session.lastTouched.includes(id));
  if (recent.length === 1) return { id: recent[0]! };
  const e = findEntry(DECOR_CATALOG, objects.find((o) => o.id === t.ids[0])!.catalogId)?.name.toLowerCase();
  return { problem: `There are ${t.ids.length} ${e}s in the scene. Select the one you mean in the studio, then ask again.` };
}

// ---- handlers ------------------------------------------------------------------------------------------------

function handleUndo(env: Env): void {
  env.notes.push(report(env.exec('undoDecorationAction', { lastRequest: true })));
}

function handleLimit(env: Env, text: string): void {
  const amount = parseAmount(text.replace(/.*?(?:below|under|within|less than|at most|up to|not (?:to )?exceed|limit(?:ed)? (?:to|at)|cap(?:ped)? (?:at|to))/i, ''));
  if (amount === null) return void env.notes.push('✗ I could not find an amount in that. Try "keep decoration below ₹2 lakhs".');
  const set = env.exec('setBudgetLimit', { category: 'decoration', amount });
  env.notes.push(report(set));
  if (!set.ok) return; // a proposal is waiting for the customer; nothing else to do until they answer
  const est = env.exec('estimateDecorationCost', {});
  const d = data<{ projectedInr: number; withinConstraint: boolean | null; overByInr: number; trimSuggestion: { removeIds: string[]; feasible: boolean; resultingCost: number; savings: number; remove: { name: string }[] } | null }>(est);
  if (!d) return void env.notes.push(report(est));
  if (d.withinConstraint !== false) return void env.notes.push(`✓ The current decoration estimate is ${formatInr(d.projectedInr)} (sample prices), within the ${formatInr(amount)} limit.`);
  const trim = d.trimSuggestion;
  if (!trim || trim.removeIds.length === 0 || !trim.feasible) {
    return void env.notes.push(`✗ The scene is ${formatInr(d.overByInr)} over the limit and cannot be brought under it without removing the stage or mandap. Do you want to raise the limit, or remove those?`);
  }
  const removed = env.exec('removeDecoration', { ids: trim.removeIds });
  env.notes.push(report(removed));
  if (removed.ok) env.notes.push(`To fit ${formatInr(amount)} I removed ${trim.remove.map((r) => r.name).join(', ')}, saving ${formatInr(trim.savings)}. The estimate is now ${formatInr(trim.resultingCost)} (sample prices). Say "undo that" to bring them back.`);
}

interface Recipe {
  assetId: string;
  quantity: number;
  mount?: 'stage';
}

function handleTheme(env: Env, text: string): void {
  const t = text.toLowerCase();
  const modern = /\b(modern|contemporary)\b/.test(t);
  const southIndian = /south indian|tamil|kerala|telugu|kannada|mandapam/.test(t);
  const lighting = /\b(lighting|lights?|lanterns?|chandeliers?)\b/.test(t);
  const warm = /\bwarm\b/.test(t);
  const flowerColour = (() => { const m = /((?:\w+\s+){0,2})flowers?\b/.exec(t.replace(/\bflower\s+(?:arch|arrangements?|panel)/g, '')); return m ? colourIn(m[1]!) : null; })();
  const mandapColour = (() => { const m = /((?:\w+\s+){0,2})mandap(?:am)?\b/.exec(t); return m ? colourIn(m[1]!) : null; })();
  const limit = (() => { const m = /(?:below|under|within|less than|at most|up to|not (?:to )?exceed)\s+(.*)$/.exec(t); return m ? parseAmount(m[1]!) : null; })();

  env.notes.push(`Planning a ${modern ? 'modern' : 'traditional'}${southIndian ? ' South Indian' : ''} setup${limit ? ` within ${formatInr(limit)}` : ''}.`);
  const budget = env.exec('getBudgetSummary', {});
  env.notes.push(report(budget));
  if (limit !== null) env.notes.push(report(env.exec('setBudgetLimit', { category: 'decoration', amount: limit })));
  env.exec('listDecorationAssets', {});

  const mandap = modern ? 'mandap-modern' : 'mandap-traditional';
  const wanted: Recipe[] = [
    { assetId: 'stage-wedding', quantity: 1 },
    { assetId: mandap, quantity: 1, mount: 'stage' },
    { assetId: 'arch-flower', quantity: 1 },
    { assetId: 'flowers-centrepiece', quantity: 2 },
    { assetId: 'chair-banquet', quantity: 4 },
    ...(southIndian ? [{ assetId: 'flowers-wall-panel', quantity: 1 }] : []),
    ...(lighting ? [{ assetId: 'chandelier-crystal', quantity: 2 }, { assetId: 'lantern-floor', quantity: 2 }] : []),
  ];

  // Only add what is missing, and only what the limit allows (checked by the budget tool before each addition).
  const have = (id: string) => scene(env).filter((o) => o.catalogId === id).length;
  const accepted: Recipe[] = [];
  const skipped: string[] = [];
  for (const w of wanted) {
    const missing = w.quantity - have(w.assetId);
    if (missing <= 0) continue;
    const probe = env.exec('estimateDecorationCost', { items: [...accepted, { assetId: w.assetId, quantity: missing }].map((a) => ({ assetId: a.assetId, quantity: a.quantity })) });
    const within = data<{ withinConstraint: boolean | null }>(probe)?.withinConstraint;
    if (within === false) {
      skipped.push(`${findEntry(DECOR_CATALOG, w.assetId)!.name}${missing > 1 ? ` × ${missing}` : ''}`);
      continue;
    }
    const r = env.exec('addDecoration', { assetId: w.assetId, quantity: missing, ...(w.mount ? { mount: w.mount } : {}) });
    env.notes.push(report(r));
    if (r.ok) accepted.push({ ...w, quantity: missing });
    else skipped.push(findEntry(DECOR_CATALOG, w.assetId)!.name);
  }

  if (flowerColour) env.notes.push(report(env.exec('changeDecorationMaterial', { allWithPart: true, part: 'flowers', color: flowerColour.hex })));
  if (mandapColour) {
    const ids = scene(env).filter((o) => o.catalogId.startsWith('mandap')).map((o) => o.id);
    for (const part of modern ? ['frame'] : ['pillars', 'canopy']) if (ids.length) env.notes.push(report(env.exec('changeDecorationMaterial', { ids, part, color: mandapColour.hex })));
  }
  if (lighting) {
    const glow = scene(env).some((o) => findEntry(DECOR_CATALOG, o.catalogId)?.parts.some((p) => p.id === 'glow'));
    if (glow && warm) env.notes.push(report(env.exec('changeDecorationMaterial', { allWithPart: true, part: 'glow', color: 'warm' })));
  }

  env.exec('listSceneDecorations', {});
  const after = env.exec('getBudgetSummary', {});
  const d = data<{ decoration: { currentSceneEstimateInr: number; constraint: { amount: number } | null } }>(after);
  if (d) env.notes.push(`The scene now costs an estimated ${formatInr(d.decoration.currentSceneEstimateInr)} (sample prices)${d.decoration.constraint ? `, against a limit of ${formatInr(d.decoration.constraint.amount)}` : ''}.`);
  if (skipped.length) env.notes.push(`Left out to stay within the limit: ${skipped.join(', ')}.`);
  if (lighting && !warm) env.notes.push('There is no separate lighting setting yet: lighting is the chandeliers and lanterns in the scene.');
  if (lighting && warm) env.notes.push('Warm lighting is done by colouring the chandelier and lantern lights warm; the venue has no global lighting control yet.');
  if (accepted.length === 0 && skipped.length === 0) env.notes.push('Everything for that setup was already in the scene.');
}

function handleColour(env: Env, text: string): void {
  const colour = colourIn(text);
  if (!colour) return void env.notes.push(`✗ I did not recognise a colour. I know: ${COLOR_NAMES.join(', ')}.`);
  const objects = scene(env);
  const t = text.toLowerCase();
  const withoutColour = t.replace(new RegExp(`\\b${colour.name}\\b`, 'g'), ' ');
  let parts = PART_WORDS.filter(([re]) => re.test(withoutColour)).map(([, p]) => p);
  if (parts.includes('glow') && objects.some((o) => findEntry(DECOR_CATALOG, o.catalogId)?.parts.some((p) => p.id === 'lights'))) parts = [...parts, 'lights'];
  const refs = targets(withoutColour.replace(/\b(?:flowers?|jasmine|marigolds?)\b/g, ' '), objects, env.ctx.session);
  const hasPart = (o: DecorObject, part: string) => findEntry(DECOR_CATALOG, o.catalogId)?.parts.some((p) => p.id === part);

  if (refs && 'problem' in refs) return void env.notes.push(`✗ ${refs.problem}`);
  if (parts.length === 0) {
    if (!refs) return void env.notes.push('✗ Which part should change colour? For example "make the flowers pink" or "make the mandap gold".');
    // No part named: colour each object's main part (its first listed part) and say so.
    for (const id of refs.ids) {
      const e = findEntry(DECOR_CATALOG, objects.find((o) => o.id === id)!.catalogId)!;
      env.notes.push(report(env.exec('changeDecorationMaterial', { ids: [id], part: e.parts[0]!.id, color: colour.hex })));
    }
    env.notes.push('I changed the main part of each (the first one listed). Name a part, like "the canopy", to change a different one.');
    return;
  }
  for (const part of parts) {
    const pool = refs ? refs.ids.filter((id) => hasPart(objects.find((o) => o.id === id)!, part)) : null;
    if (pool && pool.length === 0) { env.notes.push(`✗ None of those has a ${part} part.`); continue; }
    if (!pool && !objects.some((o) => hasPart(o, part))) { if (parts.length === 1) env.notes.push(`✗ Nothing in the scene has ${part} to recolour yet.`); continue; }
    env.notes.push(report(env.exec('changeDecorationMaterial', pool ? { ids: pool, part, color: colour.hex } : { allWithPart: true, part, color: colour.hex })));
  }
}

/** The colour every existing object with `part` shares, or null when they differ or none is customised. */
function prevailingColour(env: Env, part: string): string | null {
  const colours = scene(env).filter((o) => findEntry(DECOR_CATALOG, o.catalogId)?.parts.some((p) => p.id === part)).map((o) => o.colors[part]);
  const first = colours[0];
  return first && colours.every((c) => c === first) ? first : null;
}

function handleAdd(env: Env, text: string): void {
  const t = text.toLowerCase();
  const onStage = /\bon (?:the |a )?(?:wedding )?stage\b/.test(t);
  const colour = colourIn(t);
  const found = ASSET_WORDS.flatMap((w) => { const m = w.re.exec(t); return m ? [{ assetId: assetIdsIn(t).find((a) => a === w.assetId || (a.startsWith('mandap') && w.assetId.startsWith('mandap'))) ?? w.assetId, index: m.index }] : []; })
    .filter((f) => !(f.assetId === 'stage-wedding' && onStage));
  if (found.length === 0) {
    return void env.notes.push(`✗ I could not tell what to add. I can add: ${DECOR_CATALOG.map((e) => e.name.toLowerCase()).join(', ')}.`);
  }
  for (const f of found) {
    const entry = findEntry(DECOR_CATALOG, f.assetId)!;
    const quantity = quantityBefore(t, f.index) ?? (/\bmore\b/.test(t) ? 2 : 1);
    const mount = onStage && entry.mounts.includes('stage') ? 'stage' : undefined;
    if (mount === 'stage' && !scene(env).some((o) => findEntry(DECOR_CATALOG, o.catalogId)?.category === 'stage')) {
      env.notes.push('There is no stage yet, so I am adding one first.');
      env.notes.push(report(env.exec('addDecoration', { assetId: 'stage-wedding' })));
    }
    const colorPart = entry.parts.find((p) => p.id === 'flowers')?.id ?? entry.parts[0]!.id;
    // An explicit colour wins; otherwise new flowers match the flower colour the scene already uses.
    const inherited = entry.parts.some((p) => p.id === 'flowers') ? prevailingColour(env, 'flowers') : null;
    const colors = colour && !/\bwarm\b/.test(colour.name) ? { [colorPart]: colour.name } : inherited ? { flowers: inherited } : undefined;
    env.notes.push(report(env.exec('addDecoration', { assetId: f.assetId, quantity, ...(mount ? { mount } : {}), ...(colors ? { colors } : {}) })));
  }
}

function handleMove(env: Env, text: string): void {
  const t = text.toLowerCase();
  const objects = scene(env);
  const refs = targets(t, objects, env.ctx.session);
  if (!refs) return void env.notes.push('✗ What should I move? Name it ("the mandap") or select it in the studio.');
  const one = single(refs, env.ctx.session, objects);
  if ('problem' in one) return void env.notes.push(`✗ ${one.problem}`);
  const dir = /\bleft\b/.test(t) ? 'left' : /\bright\b/.test(t) ? 'right' : /\b(forward|ahead|away|back wall|behind)\b/.test(t) ? 'forward' : /\b(back|backward|closer|toward|towards|near(?:er)?)\b/.test(t) ? 'back' : null;
  if (!dir) return void env.notes.push('✗ I can move things left, right, forward or back. Which way?');
  const distance = metresIn(t) ?? (/\b(a lot|far)\b/.test(t) ? 3 : /\b(slightly|a bit|a little|little|bit|tiny)\b/.test(t) ? 0.5 : 1);
  env.notes.push(report(env.exec('moveDecoration', { id: one.id, direction: dir, distance: Math.round(distance * 100) / 100 })));
}

function handleRotate(env: Env, text: string): void {
  const t = text.toLowerCase();
  const objects = scene(env);
  const refs = targets(t, objects, env.ctx.session);
  if (!refs) return void env.notes.push('✗ What should I turn? Name it or select it in the studio.');
  const one = single(refs, env.ctx.session, objects);
  if ('problem' in one) return void env.notes.push(`✗ ${one.problem}`);
  const deg = /(\d+(?:\.\d+)?)\s*(?:°|deg)/.exec(t);
  const amount = deg ? Number(deg[1]) : /quarter/.test(t) ? 90 : /\b(half|around|180)\b/.test(t) ? 180 : 15;
  const sign = /\bright\b|clockwise(?<!counter-?clockwise)/.test(t) && !/counter/.test(t) ? -1 : 1;
  env.notes.push(report(env.exec('rotateDecoration', { id: one.id, degrees: sign * amount })));
}

function handleScale(env: Env, text: string): void {
  const t = text.toLowerCase();
  const objects = scene(env);
  const refs = targets(t, objects, env.ctx.session);
  if (!refs) return void env.notes.push('✗ What should I resize? Name it or select it in the studio.');
  const one = single(refs, env.ctx.session, objects);
  if ('problem' in one) return void env.notes.push(`✗ ${one.problem}`);
  const pct = /(\d+(?:\.\d+)?)\s*%/.exec(t);
  const bigger = /\b(bigger|larger|increase|grow|enlarge|taller)\b/.test(t);
  const factor = /\bdouble\b/.test(t) ? 2 : /\bhalf\b/.test(t) ? 0.5 : pct ? (bigger ? 1 + Number(pct[1]) / 100 : 1 - Number(pct[1]) / 100) : bigger ? 1.2 : 0.8;
  env.notes.push(report(env.exec('scaleDecoration', { id: one.id, factor })));
}

function handleRemove(env: Env, text: string): void {
  const t = text.toLowerCase();
  const objects = scene(env);
  if (/\b(everything|all (?:the )?decorations?|the whole scene|clear (?:the )?scene)\b/.test(t)) {
    if (objects.length === 0) return void env.notes.push('✗ The scene is already empty.');
    return void env.notes.push(report(env.exec('removeDecoration', { ids: objects.map((o) => o.id) })));
  }
  const refs = targets(t, objects, env.ctx.session);
  if (!refs) return void env.notes.push('✗ What should I remove? Name it ("the chairs") or select it in the studio.');
  if ('problem' in refs) return void env.notes.push(`✗ ${refs.problem}`);
  const all = /\b(all|every|both|those|them|chairs|arrangements)\b/.test(t) || refs.via === 'pronoun';
  const pick = all ? refs : (() => { const o = single(refs, env.ctx.session, objects); return 'id' in o ? { ids: [o.id] } : o; })();
  if ('problem' in pick) return void env.notes.push(`✗ ${pick.problem}`);
  env.notes.push(report(env.exec('removeDecoration', { ids: pick.ids })));
}

function handleDuplicate(env: Env, text: string): void {
  const objects = scene(env);
  const refs = targets(text, objects, env.ctx.session);
  if (!refs) return void env.notes.push('✗ What should I duplicate? Name it or select it in the studio.');
  const one = single(refs, env.ctx.session, objects);
  if ('problem' in one) return void env.notes.push(`✗ ${one.problem}`);
  env.notes.push(report(env.exec('duplicateDecoration', { id: one.id })));
}

function handleDesign(env: Env, text: string): boolean {
  const save = /\bsave\b.*?\b(?:design|layout|scene|setup)\b(?:\s+(?:as|called|named))?\s*["“']?(.*?)["”']?\s*$/i.exec(text);
  if (save) {
    const name = save[1]!.trim() || 'My design';
    env.notes.push(report(env.exec('saveWeddingDesign', { name })));
    return true;
  }
  const load = /\b(?:load|open|restore|bring back)\b\s+(?:the |my )?(?:saved )?(?:design|layout|scene)?\s*["“']?(.*?)["”']?\s*$/i.exec(text);
  if (load && /\b(design|layout|scene|saved)\b/i.test(text)) {
    env.notes.push(report(env.exec('loadWeddingDesign', { name: load[1]!.trim() || undefined })));
    return true;
  }
  return false;
}

function handleDescribe(env: Env, text: string): boolean {
  const t = text.toLowerCase();
  if (/\b(what can i add|catalogue|catalog|available decorations|what decorations)\b/.test(t)) {
    const r = env.exec('listDecorationAssets', {});
    const d = data<{ assets: { name: string; samplePriceInr: number }[] }>(r);
    env.notes.push(d ? `You can add: ${d.assets.map((a) => `${a.name} (sample ${formatInr(a.samplePriceInr)})`).join(', ')}. These are demonstration prices, not quotations.` : report(r));
    return true;
  }
  if (/\b(what'?s|what is|what do i have|show|list|describe)\b.*\b(scene|venue|decorations?|stage)\b/.test(t) || /\bwhat'?s in\b/.test(t)) {
    const r = env.exec('listSceneDecorations', {});
    const d = data<{ objects: { name: string; mount: string; xMetres: number; zMetres: number }[]; estimatedCostInr: number }>(r);
    env.notes.push(d ? (d.objects.length ? `In the scene: ${d.objects.map((o) => `${o.name} (${o.mount}, ${o.xMetres.toFixed(1)}, ${o.zMetres.toFixed(1)})`).join('; ')}. Estimated ${formatInr(d.estimatedCostInr)} (sample prices).` : 'The scene is empty.') : report(r));
    return true;
  }
  return false;
}

const CATEGORY_WORDS: Record<BudgetCategory, string[]> = {
  venue: ['venue', 'hall', 'ballroom'], catering: ['catering', 'caterer', 'food', 'menu'], decoration: ['decor', 'decoration', 'flowers', 'floral', 'stage', 'mandap'],
  photography: ['photo', 'photography', 'photographer', 'video'], attire: ['attire', 'outfit', 'lehenga', 'sherwani', 'saree', 'clothes'], entertainment: ['music', 'dj', 'band', 'entertainment', 'sangeet'],
  travel: ['travel', 'transport', 'flights', 'hotel'], miscellaneous: ['misc', 'miscellaneous', 'other'],
};
const categoryIn = (t: string): BudgetCategory | null => BUDGET_CATEGORIES.find((c) => CATEGORY_WORDS[c].some((w) => new RegExp(`\\b${w}`).test(t.toLowerCase()))) ?? null;

/** Budget and wedding-detail requests (milestone 1), now through the same specialist tools. */
function handleDetails(env: Env, text: string): boolean {
  const lower = text.toLowerCase();
  let did = false;
  const profile: Record<string, unknown> = {};
  const guests = /\b(\d{1,4})\s*(?:guests?|people|persons|pax|attendees)\b/i.exec(text);
  if (guests) profile.guestCount = Number(guests[1]);
  const date = parseDate(text);
  if (date) profile.date = date;
  const city = /\b(?:in|at)\s+([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)(?=[\s,.!?]|$)/.exec(text);
  if (city && !/^(The|A|An|My|Our)$/.test(city[1]!)) profile.city = city[1];
  const names = /\b(?:we are|we're|i am|i'm|couple is|names? (?:are|is))\s+([A-Z][a-z]+\s*(?:&|and)\s*[A-Z][a-z]+)/i.exec(text);
  if (names) profile.coupleNames = names[1]!.replace(/\s+and\s+/i, ' & ');
  if (Object.keys(profile).length) { env.notes.push(report(env.exec('updateWeddingProfile', profile))); did = true; }

  const amount = parseAmount(text);
  if (amount !== null && /\b(spent|paid|booked|advance|deposit)\b/.test(lower) && categoryIn(text)) {
    env.notes.push(report(env.exec('addExpense', { category: categoryIn(text), label: text.slice(0, 80), amount }))); did = true;
  } else if (amount !== null && /\bbudget\b/.test(lower) && !categoryIn(lower.replace(/budget/g, ''))) {
    env.notes.push(report(env.exec('setTotalBudget', { total: amount }))); did = true;
    if (/\b(split|allocate|break ?down|divide)\b/.test(lower)) env.notes.push(report(env.exec('allocateBudget', { mode: 'guideline' })));
  } else if (/\b(split|allocate|break ?down|divide)\b/.test(lower)) {
    env.notes.push(report(env.exec('allocateBudget', { mode: 'guideline' }))); did = true;
  }
  if (/\bvenues?\b/.test(lower)) {
    const chosen = ['ballroom', 'courtyard', 'lakeside'].find((w) => lower.includes(w));
    const id = chosen ? { ballroom: 'venue-grand-ballroom', courtyard: 'venue-courtyard-hall', lakeside: 'venue-lakeside-lawn' }[chosen] : null;
    if (id && /\b(book|choose|select|pick|go with|take|use)\b/.test(lower)) env.notes.push(report(env.exec('selectVenue', { venueId: id })));
    else if (!id) {
      const r = env.exec('listVenues', {});
      const d = data<{ venues: { name: string; capacity: number; pricePerDayInr: number }[] }>(r);
      env.notes.push(d ? `Sample venues: ${d.venues.map((v) => `${v.name} (${v.capacity} guests, about ${formatInr(v.pricePerDayInr)}/day)`).join('; ')}. These are sample data, not real quotes.` : report(r));
    }
    did = true;
  }
  if (!did && /\b(budget (?:summary|status|left)|how much (?:is |do i have |have i )?(?:left|spent|remaining)|budget so far|remaining budget)\b/.test(lower)) {
    const r = env.exec('getBudgetSummary', {});
    const d = data<{ total: number; spent: number; remaining: number; decoration: { currentSceneEstimateInr: number } }>(r);
    env.notes.push(d ? `Budget ${d.total ? formatInr(d.total) : 'not set'}; spent ${formatInr(d.spent)}; remaining ${formatInr(d.remaining)}. Decoration estimate ${formatInr(d.decoration.currentSceneEstimateInr)} (sample prices).` : report(r));
    did = true;
  }
  if (!did && /\b(how much|cost|estimate|price)\b.*\b(decor|scene|mandap|stage|decoration)/.test(lower)) {
    const r = env.exec('estimateDecorationCost', {});
    env.notes.push(report(r)); did = true;
  }
  if (!did && /\b(status|overview|summary|where are we)\b/.test(lower)) { env.notes.push(report(env.exec('getWeddingOverview', {}))); did = true; }
  return did;
}

// ---- router --------------------------------------------------------------------------------------------------

// ---- vendors -------------------------------------------------------------------------------------------------

const VENDOR_WORDS: [RegExp, VendorCategory][] = [
  [/\bdecorators?\b|\bdecor(?:ation)? (?:vendors?|teams?|companies|studios?)\b/, 'decorator'], [/\bcaterers?\b|\bcatering\b/, 'caterer'], [/\bphotograph(?:er|ers|y)\b/, 'photographer'],
  [/\bvideograph(?:er|ers|y)\b|\bcinematograph/, 'videographer'], [/\bmake-?up\b|\bmua\b/, 'makeup'], [/\bflorists?\b/, 'florist'], [/\bwedding planners?\b|\bplanners?\b/, 'planner'],
  [/\bdjs?\b|\bentertain(?:er|ers|ment)\b/, 'entertainer'],
];
const STYLE_WORDS = ['traditional south indian', 'south indian', 'traditional', 'luxury', 'luxe', 'royal', 'contemporary', 'modern', 'floral', 'candid', 'cinematic', 'bridal', 'sangeet'];

const isVendorClause = (c: string) => {
  const t = c.toLowerCase();
  return /\bvendors?\b|\bshortlist\b|\bquot(?:e|ation)s?\b|\bcompare (?:them|these|those|packages|the (?:first|top|two|three))\b/.test(t) || (VENDOR_WORDS.some(([re]) => re.test(t)) && /\b(find|search|look(?:ing)? for|recommend|suggest|show me|need|want|get me|any|who)\b/.test(t));
};

const shortName = (n: string) => n.toLowerCase().replace(/^demo\s+/, '');

function vendorNamed(env: Env, text: string) {
  const t = text.toLowerCase();
  const all = env.ctx.vendors.list();
  const exact = all.find((v) => t.includes(shortName(v.businessName)));
  if (exact) return exact;
  const ord: [RegExp, number][] = [[/\b(?:first|top|1st|cheapest)\b/, 0], [/\bsecond\b|\b2nd\b/, 1], [/\bthird\b|\b3rd\b/, 2]];
  const ids = env.ctx.session.lastVendors;
  for (const [re, i] of ord) if (re.test(t) && ids[i]) return env.ctx.vendors.get(ids[i]!);
  const scored = all.map((v) => ({ v, n: shortName(v.businessName).split(/\s+/).filter((w) => w.length > 3 && t.includes(w)).length })).filter((x) => x.n >= 2).sort((a, b) => b.n - a.n);
  if (scored[0] && (!scored[1] || scored[1].n < scored[0].n)) return scored[0].v;
  if (ids.length === 1) return env.ctx.vendors.get(ids[0]!);
  return undefined;
}

interface VendorCard { id: string; name: string; location: string; trust: string; packages: { id: string; name: string; estimateInr: number; suitsGuestCount: boolean }[]; budget: { customerLimitInr: number | null; withinCustomerLimit: boolean | null } | null }

function handleVendors(env: Env, c: string): boolean {
  const t = c.toLowerCase();
  const s = state(env.ctx);
  const need = (what: string) => (env.notes.push(`✗ Which vendor? Tell me the vendor's name (or "the first one") ${what}. Ask me to search first if you have not seen any.`), true);

  if (/\b(remove|delete|unshortlist|drop)\b/.test(t) && /\b(shortlist|vendor)/.test(t)) {
    const v = vendorNamed(env, c) ?? s.vendorShortlist.map((x) => env.ctx.vendors.get(x.vendorId)).find((x) => x && t.includes(shortName(x.businessName)));
    if (!v) return need('to remove');
    env.notes.push(report(env.exec('removeShortlistedVendor', { vendorId: v.id })));
    return true;
  }
  if (/\b(show|list|what(?:'s| is)?)\b.*\bshortlist/.test(t)) {
    env.notes.push(s.vendorShortlist.length ? `Your shortlist: ${s.vendorShortlist.map((v) => `${v.name}${v.source === 'demo' ? ' (DEMO DATA)' : ''}`).join('; ')}.` : 'Your shortlist is empty.');
    return true;
  }
  if (/\bshortlist\b|\bsave\b.*\bvendor\b/.test(t)) {
    const v = vendorNamed(env, c);
    if (!v) return need('to shortlist');
    const pkgId = v.packages.find((p) => t.includes(p.name.toLowerCase()))?.id;
    env.notes.push(report(env.exec('shortlistVendor', { vendorId: v.id, ...(pkgId ? { packageId: pkgId } : {}) })));
    return true;
  }
  if (/\bquot(?:e|ation)s?\b/.test(t)) {
    const v = vendorNamed(env, c);
    if (!v) return need('to quote');
    const pkgId = v.packages.find((p) => t.includes(p.name.toLowerCase()))?.id;
    env.notes.push(report(env.exec('requestQuotation', { vendorId: v.id, ...(pkgId ? { packageId: pkgId } : {}) })));
    return true;
  }
  if (/\bavailab/.test(t)) {
    const v = vendorNamed(env, c);
    if (!v) return need('to check');
    env.notes.push(report(env.exec('getVendorAvailability', { vendorId: v.id })));
    return true;
  }
  if (/\bcompar/.test(t)) {
    const ids = env.ctx.session.lastVendors.slice(0, 3);
    const named = vendorNamed(env, c);
    const use = named && !ids.includes(named.id) ? [named.id] : ids;
    if (!use.length) return env.notes.push('✗ There is nothing to compare yet. Ask me to find vendors first, for example "find a decorator in Ramanagara".'), true;
    const r = env.exec('compareVendorPackages', { vendorIds: use });
    const d = data<{ rows: { vendor: string; package: string; estimateInr: number; suitsGuestCount: boolean; budget: { withinCustomerLimit: boolean | null } }[] }>(r);
    env.notes.push(d ? `Packages for your ${s.profile.guestCount} guests, cheapest first (list prices; DEMO DATA):\n${d.rows.map((x) => `• ${x.vendor}: ${x.package} ${formatInr(x.estimateInr)}${x.suitsGuestCount ? '' : ' (outside its guest range)'}${x.budget.withinCustomerLimit === false ? ' — over your limit' : ''}`).join('\n')}` : report(r));
    return true;
  }

  // Search.
  const category = VENDOR_WORDS.find(([re]) => re.test(t))?.[1];
  const known = [...new Set(env.ctx.vendors.list().flatMap((v) => [v.location, ...v.serviceAreas]))];
  const place = known.filter((l) => new RegExp(`\\b${l.toLowerCase()}\\b`).test(t)).sort((a, b) => b.length - a.length)[0];
  const style = STYLE_WORDS.find((w) => t.includes(w));
  const budget = parseAmount(c);
  const args: Record<string, unknown> = {};
  if (category) args.category = category;
  if (place) args.location = place;
  if (budget !== null) args.maxBudgetInr = budget;
  if (style) args.style = style === 'luxe' ? 'luxury' : style;
  const r = env.exec('searchOurVendors', args);
  const d = data<{ count: number; relaxed: string | null; searched: { location: string }; vendors: VendorCard[] }>(r);
  if (!d) return env.notes.push(report(r)), true;
  const what = category ? VENDOR_CATEGORY_LABELS[category].toLowerCase() : 'vendor';
  if (d.count === 0) return env.notes.push(`I searched our vendor catalogue for ${what}s in ${d.searched.location}${budget !== null ? ` within ${formatInr(budget)}` : ''} and found no match. I won't invent one. You could raise the budget, try a nearby town, or widen the search.`), true;
  const top = d.vendors.slice(0, 3);
  const lines = top.map((v) => {
    const fit = v.packages.filter((p) => p.suitsGuestCount && (budget === null || p.estimateInr <= budget));
    const best = (fit.length ? fit : v.packages)[0];
    const lim = v.budget?.customerLimitInr != null ? (v.budget.withinCustomerLimit ? ` Within your ${formatInr(v.budget.customerLimitInr)} limit.` : ` Over your ${formatInr(v.budget.customerLimitInr)} limit.`) : '';
    return `• ${v.name} [${v.trust}] — ${v.location}. ${best ? `${best.name}: ${formatInr(best.estimateInr)} for ${s.profile.guestCount} guests.` : ''}${lim}`;
  });
  env.notes.push(`${d.relaxed ? `${d.relaxed}\n` : ''}From our catalogue (${d.count} match${d.count === 1 ? '' : 'es'}; DEMO DATA entries are fictional examples, not real businesses), serving ${d.searched.location}${s.profile.style ? `, your style "${s.profile.style}"` : ''}${budget !== null ? `, within ${formatInr(budget)}` : ''}:\n${lines.join('\n')}\nSay "shortlist the first one", "compare them", or "request a quote from the first one".`);
  return true;
}

// ---- outfits and try-on --------------------------------------------------------------------------------------

const GARMENT_WORDS: [RegExp, GarmentCategory][] = [
  [/\blehengas?\b|\bghagras?\b/, 'lehenga'], [/\bgowns?\b/, 'gown'], [/\banarkalis?\b|\btraditional (?:women'?s? )?(?:outfits?|wear)\b/, 'traditional_women'],
  [/\bkurtas?\b|\bkurtis?\b/, 'kurta'], [/\bsherwanis?\b/, 'sherwani'], [/\b(?:men'?s|menswear|bandhgala|groom'?s?) (?:outfits?|wear|traditional)?\b|\btraditional men/, 'traditional_men'],
];
const COLOUR_ALIAS: Record<string, string> = { blush: 'pink', rose: 'pink', ruby: 'red', maroon: 'red', midnight: 'navy', blue: 'navy', indigo: 'blue', cream: 'ivory', saffron: 'orange', emerald: 'green' };

const isFashionClause = (c: string) => {
  const t = c.toLowerCase();
  const garment = GARMENT_WORDS.some(([re]) => re.test(t)) || /\boutfits?\b|\bgarments?\b|\blooks\b|\b(?:this|that|a|my|saved|the|favou?rite) look\b|\blook (?:named|called)\b|\btry[- ]?on\b/.test(t);
  if (!garment) return false;
  return /\b(show|list|see|find|search|browse|try|save|favou?rite|compare|delete|remove|preview|what)\b/.test(t) && !/\b(spent|paid|booked|budget)\b/.test(t);
};

function garmentIn(text: string): Garment | undefined {
  const t = text.toLowerCase();
  const cat = GARMENT_WORDS.find(([re]) => re.test(t))?.[1];
  const colour = Object.keys(COLOUR_ALIAS).find((w) => new RegExp(`\\b${w}\\b`).test(t));
  const scored = GARMENTS.map((g) => {
    const words = g.name.toLowerCase().replace(/\(.*\)/, '').split(/\s+/).filter((w) => w.length > 3 && !/lehenga|gown|anarkali|kurta|sherwani/.test(w));
    const direct = words.filter((w) => new RegExp(`\\b${w}\\b`).test(t)).length * 2;
    const col = new RegExp(`\\b${g.color}\\b`).test(t) || (colour !== undefined && COLOUR_ALIAS[colour] === g.color) ? 2 : 0;
    return { g, score: direct + col + (cat === g.category ? 1 : 0), catOk: !cat || cat === g.category };
  }).filter((x) => x.catOk && x.score > (cat ? 0 : 1)).sort((a, b) => b.score - a.score);
  return scored[0]?.g ?? (cat ? GARMENTS.find((g) => g.category === cat) : undefined);
}

function handleFashion(env: Env, c: string): boolean {
  const t = c.toLowerCase();
  const s = state(env.ctx);
  const reg = tryOnRequestsFor(env.ctx.store);
  const lastPreview = () => reg.recent(env.ctx.weddingId).filter((r) => r.kind === 'preview').at(-1)?.garmentIds[0];
  const lookNamed = () => s.outfits.find((o) => t.includes(o.label.toLowerCase())) ?? (garmentIn(c) ? s.outfits.find((o) => o.garmentId === garmentIn(c)!.id) : undefined) ?? (s.outfits.length === 1 ? s.outfits[0] : undefined);

  if (/\b(delete|remove)\b/.test(t) && /\blooks?\b/.test(t)) {
    const l = lookNamed();
    if (!l) return env.notes.push(s.outfits.length ? `✗ Which look? You have: ${s.outfits.map((o) => `"${o.label}"`).join(', ')}. Say "delete look <name>".` : '✗ You have no saved looks to delete.'), true;
    env.notes.push(report(env.exec('deleteLook', { lookId: l.id })));
    return true;
  }
  if (/\bcompare\b/.test(t)) {
    if (s.outfits.length < 2) return env.notes.push(`✗ Save at least two looks first (you have ${s.outfits.length}), then I can compare them.`), true;
    const r = env.exec('compareLooks', { ids: s.outfits.slice(0, 3).map((o) => o.id) });
    env.notes.push(report(r));
    return true;
  }
  if (/\bsave\b|\bfavou?rite\b/.test(t)) {
    const g = garmentIn(c) ?? findGarment(lastPreview() ?? '');
    if (!g) return env.notes.push('✗ Which outfit? Name one, or ask for a preview first, for example "try the pink lehenga".'), true;
    env.notes.push(report(env.exec('saveLook', { garmentId: g.id })));
    return true;
  }
  if (/\b(try|preview)\b/.test(t) && !/\b(show|list)\b/.test(t)) {
    const g = garmentIn(c);
    if (!g) return env.notes.push('✗ I could not tell which outfit. Try "try the pink lehenga" or ask me to show the outfits.'), true;
    const r = env.exec('generateOutfitPreview', { garmentId: g.id });
    env.notes.push(report(r));
    return true;
  }
  if (/\b(my|saved)\b.*\blooks?\b/.test(t)) {
    env.notes.push(s.outfits.length ? `Your saved looks: ${s.outfits.map((o) => `"${o.label}"`).join(', ')}.` : 'You have no saved looks yet.');
    return true;
  }
  // Browse / search.
  const cat = GARMENT_WORDS.find(([re]) => re.test(t))?.[1];
  const r = env.exec('searchGarments', cat ? { category: cat } : {});
  const d = data<{ garments: { name: string; status: string; indicativePriceInr: number; note: string }[] }>(r);
  if (!d) return env.notes.push(report(r)), true;
  if (cat && CATEGORY_INFO[cat].status === 'future') return env.notes.push(`${CATEGORY_LABELS[cat]} are a future option: ${CATEGORY_INFO[cat].note} Only the pictures are listed, and they cannot be tried on:\n${d.garments.map((g) => `• ${g.name}`).join('\n')}`), true;
  env.notes.push(`${d.garments.length ? d.garments.map((g) => `• ${g.name} [${g.status}] ~${formatInr(g.indicativePriceInr)} (indicative)`).join('\n') : 'No outfits match.'}\nThe pictures are our own illustrations. To try one, say "try the <colour> <outfit>", then open Virtual Try-On and upload a photo: the preview is generated in your browser.`);
  return true;
}

// ---- AI design (versions and refinement of a generated design) --------------------------------------------------
// Only active once a design exists, so the manual studio phrases keep working before one is generated.

const AI_REFINE = /\b(make|change|turn|use|switch)\b.*\b(flowers?|florals?)\b|\b(grander|simpler|more (?:jasmine|marigold|roses?|traditional|modern)|make it (?:more )?(?:traditional|modern)|prefer the .*(?:image|photo|picture|inspiration|one)|(?:add|more) (?:chandeliers?|fairy[- ]lights?|lanterns?)|reduce the (?:decoration )?budget|cheaper|tone it down)\b/;

function handleAiDesign(env: Env, c: string): boolean {
  const s = state(env.ctx);
  if (s.design.versions.length === 0 && !s.design.brief) return false;
  const t = c.toLowerCase();
  const versionRef = (re: RegExp) => { const m = re.exec(t); return m ? `Version ${m[1]}` : null; };
  if (/\b(another|a different|new|second|alternative)\b.*\b(version|layout|arrangement|design)\b|\bgive me another\b/.test(t)) return env.notes.push(report(env.exec('generateAnotherVersion', {}))), true;
  if (/\b(restore|go back to|switch to|open|load)\b.*\bversion\s*(\d+)/.test(t)) { const v = versionRef(/version\s*(\d+)/); return env.notes.push(report(env.exec('restoreDesignVersion', { versionId: v! }))), true; }
  if (/\bcompar\w*\b.*\b(versions?|designs?)\b/.test(t)) {
    const nums = [...t.matchAll(/version\s*(\d+)|\b(\d+)\b/g)].map((m) => m[1] ?? m[2]).filter(Boolean) as string[];
    const labels = s.design.versions.map((v) => v.label);
    const pick = nums.length >= 2 ? [`Version ${nums[0]}`, `Version ${nums[1]}`] : labels.slice(-2);
    if (pick.length < 2) return env.notes.push('✗ I need at least two design versions to compare. Ask for another version first.'), true;
    const r = env.exec('compareDesignVersions', { versionIdA: pick[0]!, versionIdB: pick[1]! });
    env.notes.push(report(r));
    return true;
  }
  if (/\b(list|show)\b.*\b(versions|designs)\b/.test(t)) {
    const r = env.exec('listDesignVersions', {});
    const d = data<{ versions: { label: string; sourceNote: string; pieces: number; estimateInr: number; active: boolean }[] }>(r);
    env.notes.push(d ? `Design versions:\n${d.versions.map((v) => `• ${v.label}${v.active ? ' (current)' : ''}: ${v.pieces} pieces, about ${formatInr(v.estimateInr)} (sample prices), ${v.sourceNote}`).join('\n')}` : report(r));
    return true;
  }
  if (AI_REFINE.test(t)) return env.notes.push(report(env.exec('refineDesign', { instruction: c.slice(0, 300) }))), true;
  return false;
}

const VERB = /^(?:please\s+)?(add|put|place|bring|include|change|make|turn|set|colou?r|paint|move|shift|nudge|slide|push|rotate|spin|remove|delete|take|get rid|undo|duplicate|copy|clone|save|load|restore|keep|limit|cap|create|build|design|resize|enlarge|shrink)\b/i;

/** Splits "change the flowers to white and add more arrangements" into clauses, keeping clauses that start with a verb. */
export function splitClauses(text: string): string[] {
  const pieces = text.split(/\s*(?:,\s*and then\s+|\band then\b|\bthen\b|;\s*|,\s+and\s+|\s+and\s+|\bbut\b|\.\s+)\s*/i).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of pieces) {
    if (out.length === 0 || VERB.test(p)) out.push(p);
    else out[out.length - 1] += ` and ${p}`;
  }
  return out;
}

const isLimit = (c: string) => !isVendorClause(c) && /\b(keep|limit|cap|stay|below|under|within|less than)\b/i.test(c) && /\bdecor/i.test(c) && parseAmount(c) !== null;
const isTheme = (c: string) => /\b(wedding|setup|set-up|set up|theme)\b/i.test(c) && /\b(traditional|modern|south indian|north indian|royal|rajasthani|contemporary)\b/i.test(c) && /\b(create|make|build|design|set up|plan|give me|i want|turn)\b/i.test(c);

function runClause(env: Env, c: string): boolean {
  const t = c.toLowerCase();
  if (isVendorClause(c) && handleVendors(env, c)) return true;
  if (isFashionClause(c) && handleFashion(env, c)) return true;
  if (handleAiDesign(env, c)) return true;
  if (/\bundo\b|\brevert\b|\bgo back\b|\btake that back\b/.test(t)) return handleUndo(env), true;
  if (/\bredo\b/.test(t)) return env.notes.push('✗ Redo is not available from chat yet. Use the Redo button in the 3D Studio.'), true;
  if (handleDesign(env, c)) return true;
  if (isLimit(c)) return handleLimit(env, c), true;
  if (isTheme(c)) return handleTheme(env, c), true;
  if (/^\s*(?:please\s+)?(add|put|place|bring|include)\b/.test(t) || /\b(?:i want|i'd like|can you add|could you add)\b/.test(t)) return handleAdd(env, c), true;
  if (/\b(duplicate|copy|clone)\b/.test(t)) return handleDuplicate(env, c), true;
  if (/\b(remove|delete|get rid of|take away|take out)\b/.test(t)) return handleRemove(env, c), true;
  if (/\b(move|shift|nudge|slide|push|bring (?:it )?(?:closer|forward|back))\b/.test(t)) return handleMove(env, c), true;
  if (/\b(rotate|spin|turn)\b/.test(t) && !/\bcolou?r\b/.test(t) && !colourIn(t)) return handleRotate(env, c), true;
  if (/\b(bigger|larger|smaller|shrink|enlarge|resize|scale|double|taller)\b/.test(t)) return handleScale(env, c), true;
  if (/\b(make|change|turn|set|colou?r|paint|switch)\b/.test(t) && colourIn(t) && !/\bbudget\b/.test(t)) return handleColour(env, c), true;
  if (handleDescribe(env, c)) return true;
  if (handleDetails(env, c)) return true;
  return false;
}

export const DEMO_HELP =
  'In demo mode I understand simple requests such as: "Create a traditional South Indian wedding with a gold mandap and yellow flowers", "Add a traditional mandap on the wedding stage", "Make the flowers pink", "Move the mandap slightly to the left", "Add 3 chairs", "Keep the decoration budget below ₹2 lakhs", "Undo that change", "Save this design as Plan A", or "Our budget is 25 lakh, split it". Add an OpenAI key to the server for open-ended conversation.';

/** Runs a demo-mode message. Returns the reply text; every action in it was executed by a real tool call. */
export function runDemo(text: string, ctx: ToolContext, rawExec: Exec): string {
  let calls = 0;
  const exec: Exec = (name, args) => { calls++; return rawExec(name, args); };
  const env: Env = { exec, ctx, notes: [] };
  const clauses = splitClauses(text);
  // A limit mentioned alongside a request applies to that request, so it goes first.
  const ordered = [...clauses.filter(isLimit), ...clauses.filter((c) => !isLimit(c))];
  const unknown: string[] = [];
  for (const c of ordered) if (!runClause(env, c)) unknown.push(c);
  for (const u of unknown) env.notes.push(`✗ Demo mode does not support "${u}". ${DEMO_HELP}`);
  // After a long run the chat already lists every step, so the reply keeps only the narrative and any failures.
  if (calls > 3) {
    const kept = env.notes.filter((n) => !n.startsWith('✓ '));
    return [...kept, `Completed ${calls} steps; the list above shows each one.`].join('\n');
  }
  return env.notes.join('\n');
}

