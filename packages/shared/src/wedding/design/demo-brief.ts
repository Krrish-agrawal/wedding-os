import { resolveColor } from '../scene/colors.js';
import type { DesignForm, WeddingDesignBrief } from './brief.js';

/**
 * DEMO WORKFLOW. Builds a brief from the form text only (style, colours, description). No photograph is read and no
 * vision model is called, and the brief says so. Used when no vision model is configured.
 */
export const DEMO_DESIGN_NOTICE = 'Sample design: built from your written choices only. Your photographs were NOT analysed.';

export function demoBriefFromForm(form: DesignForm): WeddingDesignBrief {
  const text = `${form.style} ${form.description}`.toLowerCase();
  const traditional = /south indian|north indian|rajasthani|traditional|temple|royal/.test(text);
  const modern = /modern|minimal|contemporary/.test(text) && !traditional;
  const tradition = modern ? 'modern' : traditional ? 'traditional' : 'fusion';
  const flowers: WeddingDesignBrief['flowers'] = [];
  const add = (name: string, color: string, use: WeddingDesignBrief['flowers'][number]['use']) => { if (flowers.length < 8) flowers.push({ name, color, use }); };
  if (/jasmine/.test(text)) { add('jasmine', 'jasmine', 'arrangements'); add('jasmine', 'jasmine', 'garlands'); }
  if (/marigold|yellow|orange/.test(text) || /south indian/.test(text)) { add('marigold', 'marigold', 'garlands'); add('marigold', 'marigold', 'arrangements'); }
  if (/\brose|pink|red/.test(text)) add('rose', 'rose', 'arrangements');
  if (flowers.length === 0) add('mixed flowers', modern ? 'white' : 'pink', 'arrangements');
  if (/wall/.test(text) || tradition !== 'modern') add(flowers[0]!.name, flowers[0]!.color ?? 'pink', 'wall');
  const picked = form.palette.filter((p) => resolveColor(p)).slice(0, 3);
  const defaults = tradition === 'traditional' ? ['marigold', 'maroon', 'gold'] : tradition === 'modern' ? ['white', 'ivory', 'silver'] : ['pink', 'white', 'gold'];
  const roles = ['primary', 'secondary', 'accent'] as const;
  const palette = roles.map((role, i) => ({ color: picked[i] ?? defaults[i]!, role }));
  const grand = /grand|lavish|royal|luxur|opulent/.test(text) ? 4 : /simple|minimal|intimate|small/.test(text) ? 2 : 3;
  const features: WeddingDesignBrief['lighting']['features'] = [];
  if (/chandelier|royal|grand|luxur/.test(text) || tradition === 'modern') features.push('chandelier');
  if (/fairy|string light/.test(text) || tradition !== 'traditional') features.push('fairy_lights');
  if (/lantern|diya|lamp/.test(text) || tradition === 'traditional') features.push('lanterns');
  const outdoor = /beach|outdoor|lawn|garden/.test(text);
  return {
    title: `${form.style || 'Your'} wedding (sample)`,
    summary: `${DEMO_DESIGN_NOTICE} A ${tradition} design with ${palette.map((p) => p.color).join(', ')} colours.`,
    tradition, style: (form.style || tradition).slice(0, 80), grandness: grand,
    mandap: { style: modern ? 'modern' : 'traditional', description: 'From your style choice.' },
    stage: { present: !/no stage|without (?:a )?stage/.test(text), description: 'Standard wedding stage.' },
    flowers, palette,
    lighting: { warmth: modern ? 'neutral' : 'warm', features: features.slice(0, 4), description: 'From your style choice.' },
    ceiling: { treatment: outdoor ? 'none' : /chandelier/.test(text) ? 'chandeliers' : /floral|flower|garland/.test(text) ? 'floral' : 'none', description: 'From your description.' },
    entrance: { treatment: 'floral_arch', description: 'A floral entrance arch.' },
    seating: { arrangement: /banquet|round table|dinner/.test(text) ? 'banquet' : /lounge|sofa/.test(text) ? 'lounge' : 'theatre', description: 'Guest seating facing the stage.' },
    details: [/rangoli/.test(text) ? 'rangoli' : null, /swing|jhula/.test(text) ? 'swing' : null, /lamp|diya/.test(text) ? 'brass lamps' : null].filter((x): x is string => x !== null),
    provenance: [],
    limitations: [DEMO_DESIGN_NOTICE],
  };
}
