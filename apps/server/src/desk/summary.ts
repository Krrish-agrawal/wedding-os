import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { RecapSummarySchema, type RecapSummary, type TranscriptLine } from '@ave/shared';
import type { Config } from '../config.js';
import type { RecapFacts } from './facts.js';

/** The recap goes out without the AI paragraph if the model takes longer than this. */
export const AI_SUMMARY_TIMEOUT_MS = 8_000;
/** Only the end of a long call is sent to the model; the facts cover the rest. */
const MAX_TRANSCRIPT_LINES = 120;
const MAX_TRANSCRIPT_CHARS = 12_000;
const MAX_HEADLINE_CHARS = 140;
const MAX_SUMMARY_CHARS = 700;
const MAX_LIST_ITEMS = 4;
const MAX_ITEM_CHARS = 140;

export interface SummaryInput {
  facts: RecapFacts;
  transcript: TranscriptLine[];
}

export type Summarizer = (input: SummaryInput) => Promise<RecapSummary | null>;

interface Logger {
  warn(obj: object, msg: string): void;
}

const SYSTEM_PROMPT = [
  'You write the short personal summary at the top of a recap email after a property advisor call in Bengaluru.',
  'Use only what is in FACTS and TRANSCRIPT. Never add a property, price, date, time, place, offer, promise or claim that is not there.',
  'Do not write any digits or amounts at all: the recap already lists every number below your summary.',
  'Write to the buyer in the second person, in plain Indian English, warm and brief. No marketing language, no emoji.',
  'headline: one short line on what the call was about.',
  'summary: two to four short sentences on what the buyer looked at and decided.',
  'priorities: up to four things that matter most to the buyer, in their own terms; empty if unclear.',
  'openQuestions: up to three questions the buyer still has open; empty if none.',
].join('\n');

const ROLE_NAMES: Record<TranscriptLine['role'], string> = {
  buyer: 'Buyer',
  agent: 'AI advisor',
  human: 'Human advisor',
};

/** Final transcript lines as plain text, newest kept when the call was long. */
export function transcriptForModel(lines: TranscriptLine[]): string {
  const final = lines.filter((l) => l.final && l.text.trim()).slice(-MAX_TRANSCRIPT_LINES);
  const text = final.map((l) => `${ROLE_NAMES[l.role]}: ${l.text.trim()}`).join('\n');
  return text.length > MAX_TRANSCRIPT_CHARS ? text.slice(text.length - MAX_TRANSCRIPT_CHARS) : text;
}

/**
 * Numbers in the AI text that do not appear in the facts or transcript. Any hit means the model
 * made something up, and the AI part is dropped rather than sent.
 */
export function ungroundedNumbers(summary: RecapSummary, sources: string): string[] {
  const known = new Set(numberTokens(sources));
  const text = [summary.headline, summary.summary, ...summary.priorities, ...summary.openQuestions].join(' ');
  return numberTokens(text).filter((t) => !known.has(t));
}

/** Whole numbers as written, without Indian or Western digit grouping: "1,57,849" -> "157849". */
function numberTokens(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((t) => t.replace(/,/g, '').replace(/\.$/, ''));
}

function clip(s: string, max: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

/** Trims model output to the lengths the email layout is designed for. */
export function tidySummary(s: RecapSummary): RecapSummary {
  const list = (items: string[]) => items.map((i) => clip(i, MAX_ITEM_CHARS)).filter(Boolean).slice(0, MAX_LIST_ITEMS);
  return {
    headline: clip(s.headline, MAX_HEADLINE_CHARS),
    summary: clip(s.summary, MAX_SUMMARY_CHARS),
    priorities: list(s.priorities),
    openQuestions: list(s.openQuestions),
  };
}

/** What the model sees: the facts without contact details, and the transcript. */
function modelInput(input: SummaryInput): { facts: string; transcript: string } {
  const { buyer, ...rest } = input.facts;
  return {
    facts: JSON.stringify({ buyerFirstName: buyer.firstName, ...rest }),
    transcript: transcriptForModel(input.transcript),
  };
}

/** Structured-output summarizer on the official OpenAI SDK. Null when no key is configured. */
export function createOpenAiSummarizer(config: Config, log: Logger): Summarizer | null {
  if (!config.OPENAI_API_KEY) return null;
  const client = new OpenAI({ apiKey: config.OPENAI_API_KEY, timeout: AI_SUMMARY_TIMEOUT_MS, maxRetries: 0 });

  return async (input) => {
    const { facts, transcript } = modelInput(input);
    if (!transcript) return null;
    try {
      const completion = await client.chat.completions.parse({
        model: config.REPORT_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `FACTS:\n${facts}\n\nTRANSCRIPT:\n${transcript}` },
        ],
        response_format: zodResponseFormat(RecapSummarySchema, 'call_recap_summary'),
      });
      const parsed = RecapSummarySchema.safeParse(completion.choices[0]?.message.parsed);
      if (!parsed.success) {
        log.warn({ sessionId: input.facts.sessionId }, 'AI summary did not match the schema; sending the recap without it');
        return null;
      }
      const summary = tidySummary(parsed.data);
      const stray = ungroundedNumbers(summary, `${facts}\n${transcript}`);
      if (stray.length) {
        log.warn({ sessionId: input.facts.sessionId, stray }, 'AI summary mentioned numbers that are not in the call; sending the recap without it');
        return null;
      }
      return summary;
    } catch (err) {
      log.warn({ sessionId: input.facts.sessionId, err: (err as Error).message }, 'AI summary failed; sending the recap without it');
      return null;
    }
  };
}
