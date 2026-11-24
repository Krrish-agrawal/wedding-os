import { resolveColor, COLOR_NAMES } from '../scene/colors.js';
import type { WeddingDesignBrief } from './brief.js';

/**
 * Deterministic edits to a stored brief from a plain-language instruction ("make the flowers white", "grander",
 * "more jasmine"). The scene is then re-planned from the edited brief, so a refinement never touches the scene directly.
 * `supported: false` means nothing here understood the request.
 */

export interface Refinement {
  brief: WeddingDesignBrief;
  changes: string[];
  /** Multiply the decoration budget by this (e.g. 0.8 for "reduce the budget"). */
  budgetScale: number | null;
  /** 0-based inspiration image the customer prefers. Needs a real vision model to re-weigh; the caller decides. */
  emphasiseImage: number | null;
  supported: boolean;
}

const ORD: [RegExp, number][] = [[/\b(first|1st|1)\b/, 0], [/\b(second|2nd|2)\b/, 1], [/\b(third|3rd|3)\b/, 2], [/\b(fourth|4th|4)\b/, 3], [/\b(fifth|5th|5)\b/, 4], [/\b(sixth|6th|6)\b/, 5]];

export function refineBrief(input: WeddingDesignBrief, instruction: string): Refinement {
  const b: WeddingDesignBrief = structuredClone(input);
  const t = instruction.toLowerCase();
  const changes: string[] = [];
  let budgetScale: number | null = null;
  let emphasiseImage: number | null = null;

  const names = [...COLOR_NAMES].sort((a, c) => c.length - a.length);
  const colour = /\bwarm white\b/.test(t) ? 'warm white' : names.find((n) => new RegExp(`\\b${n}\\b`).test(t));
  if (colour && /\b(flowers?|florals?|blooms?)\b/.test(t) && /\b(make|change|turn|use|switch|colou?r|paint)\b/.test(t)) {
    const hex = resolveColor(colour)!;
    void hex;
    b.flowers = b.flowers.length ? b.flowers.map((f) => ({ ...f, color: colour })) : [{ name: 'flowers', color: colour, use: 'arrangements' as const }];
    b.palette = [{ color: colour, role: 'primary' as const }, ...b.palette.filter((p) => p.role !== 'primary')].slice(0, 6);
    changes.push(`Flowers are now ${colour}.`);
  } else if (colour && /\b(make|change|turn|switch|use)\b/.test(t) && /\b(theme|colou?rs?|palette|decor|mandap|decoration)\b/.test(t)) {
    b.palette = b.palette.some((p) => p.role === 'secondary') ? b.palette.map((p) => (p.role === 'secondary' ? { ...p, color: colour } : p)) : [...b.palette, { color: colour, role: 'secondary' as const }].slice(0, 6);
    changes.push(`The supporting colour is now ${colour}.`);
  }
  if (/\b(grand(?:er)?|bigger|more lavish|more luxurious|more opulent|more elaborate|extravagant)\b/.test(t)) {
    b.grandness = Math.min(5, b.grandness + 1);
    changes.push(`Made it grander (level ${b.grandness} of 5).`);
  }
  if (/\b(simpler|simple|less (?:decor|decoration)|minimal|tone it down|fewer)\b/.test(t) && !/\bmore\b/.test(t)) {
    b.grandness = Math.max(1, b.grandness - 1);
    changes.push(`Made it simpler (level ${b.grandness} of 5).`);
  }
  const more = /\bmore\s+(jasmine|marigold|roses?|flowers?)\b/.exec(t);
  if (more) {
    const kind = more[1]!.replace(/s$/, '');
    if (kind === 'jasmine' || kind === 'marigold' || kind === 'rose') {
      const color = kind === 'jasmine' ? 'jasmine' : kind === 'marigold' ? 'marigold' : 'rose';
      if (!b.flowers.some((f) => new RegExp(kind, 'i').test(f.name))) b.flowers = [...b.flowers, { name: kind, color, use: 'garlands' as const }].slice(0, 8);
      if (!b.flowers.some((f) => new RegExp(kind, 'i').test(f.name) && f.use === 'wall')) b.flowers = [...b.flowers, { name: kind, color, use: 'wall' as const }].slice(0, 8);
    }
    b.grandness = Math.min(5, b.grandness + 1);
    changes.push(`Added more ${more[1]} and raised the floral amount.`);
  }
  if (/\bmore traditional\b|\bmake it traditional\b|\bgo traditional\b/.test(t)) {
    b.tradition = 'traditional';
    b.mandap = { ...b.mandap, style: 'traditional' };
    changes.push('Made the style and mandap traditional.');
  } else if (/\bmore modern\b|\bmake it modern\b|\bcontemporary\b/.test(t)) {
    b.tradition = 'modern';
    b.mandap = { ...b.mandap, style: 'modern' };
    changes.push('Made the style and mandap modern.');
  }
  for (const [re, feat, label] of [[/\bchandeliers?\b/, 'chandelier', 'chandeliers'], [/\bfairy[- ]lights?\b/, 'fairy_lights', 'fairy lights'], [/\blanterns?\b/, 'lanterns', 'lanterns'], [/\bdiyas?\b/, 'diyas', 'diyas']] as const) {
    if (re.test(t) && /\b(add|more|use|include|with)\b/.test(t) && !b.lighting.features.includes(feat)) { b.lighting = { ...b.lighting, features: [...b.lighting.features, feat].slice(0, 4) }; changes.push(`Added ${label}.`); }
  }
  if (/\b(reduce|lower|cut|decrease|trim)\b.*\b(decor(?:ation)?\s+)?budget\b|\bcheaper\b|\bless expensive\b/.test(t)) {
    budgetScale = 0.8;
    changes.push('Reduced the decoration budget by 20%.');
  }
  const img = /\b(prefer|favou?r|like|closer to|more like)\b.*\b(image|photo|picture|inspiration|one)\b/.test(t) || /\b(image|photo|picture|inspiration)\s*(?:#|number\s*)?[1-6]\b/.test(t);
  if (img) {
    const hit = ORD.find(([re]) => re.test(t));
    if (hit) { emphasiseImage = hit[1]; changes.push(`Giving more weight to inspiration image ${hit[1] + 1}.`); }
  }
  return { brief: b, changes, budgetScale, emphasiseImage, supported: changes.length > 0 };
}
