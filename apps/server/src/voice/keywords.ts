import type { Content } from '@ave/shared';

/** Agora ARES accepts up to 128 `asr.keywords`; a short list of plain terms recognises reliably. */
export const MAX_ASR_KEYWORDS = 40;
/** Keywords are names and short terms; longer strings are descriptions, not hotwords. */
const MAX_KEYWORD_CHARS = 40;
const MAX_KEYWORD_WORDS = 4;
const MIN_KEYWORD_CHARS = 2;

/**
 * ARES returned empty transcripts for every utterance when keywords carried punctuation, accents or other scripts
 * (found in a live test on 2026-11-20). Keep keywords to plain ASCII letters, digits and single spaces.
 */
export function plainKeyword(term: string): string {
  return term
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[-\u2010-\u2015/&+]/g, ' ')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Real-estate terms an Indian buyer says that general speech models often miss. */
export const ASR_DOMAIN_TERMS = [
  'BHK',
  'Vastu',
  'RERA',
  'Khata',
  'A Khata',
  'B Khata',
  'lakh',
  'crore',
  'EMI',
  'carpet area',
  'super built up',
  'occupancy certificate',
  'possession',
  'registration',
  'stamp duty',
  'GST',
  'maintenance',
  'lock in',
  'per seat',
  'site visit',
] as const;

/**
 * Builds the ASR hotword list from content: domain terms first, then proper names a buyer is likely
 * to say (properties, localities, builders, commute destinations). Common words such
 * as room names are left out so they do not skew recognition. Deduplicated case-insensitively and
 * capped at Agora's limit.
 */
export function buildAsrKeywords(content: Content, max = MAX_ASR_KEYWORDS): string[] {
  const groups: string[][] = [[...ASR_DOMAIN_TERMS]];
  const bundles = content.properties;
  groups.push(bundles.map((b) => b.property.name));
  groups.push(bundles.flatMap((b) => [b.property.localityName, b.locality.name, b.property.city]));
  groups.push(bundles.map((b) => b.property.builder));
  groups.push(bundles.flatMap((b) => b.commute.routes.map((r) => r.destination.name)));
  // Nearby place names are left out: buyers rarely say them, and their punctuation and scripts break ARES.

  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of groups.flat()) {
    const clean = plainKeyword(term);
    const key = clean.toLowerCase();
    if (clean.length < MIN_KEYWORD_CHARS || seen.has(key) || clean.length > MAX_KEYWORD_CHARS || clean.split(' ').length > MAX_KEYWORD_WORDS) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= max) break;
  }
  return out;
}
