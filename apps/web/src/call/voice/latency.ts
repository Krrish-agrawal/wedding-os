import type { AgentMetric, Turn } from 'agora-agent-client-toolkit';

/** Turns kept for the running median. */
const TURNS_KEPT = 20;

export interface LatencyLog {
  turn(t: Turn): void;
  metric(m: AgentMetric): void;
}

const silent: LatencyLog = { turn: () => {}, metric: () => {} };

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * Development-only turn latency from the engine's metrics (enable_metrics): end-to-end time from
 * the buyer stopping to the advisor starting, split into ASR, LLM first token, TTS first byte and
 * transport. Production builds get no-ops, so nothing is logged there.
 */
export function createLatencyLog(): LatencyLog {
  if (!import.meta.env.DEV) return silent;
  const recent: number[] = [];
  return {
    turn(t) {
      recent.push(t.e2eLatencyMs);
      if (recent.length > TURNS_KEPT) recent.shift();
      const s = t.segmentedLatency;
      console.info(
        `[voice] turn ${t.turnId}: ${Math.round(t.e2eLatencyMs)} ms end to end (asr ${s.asrTtlwMs}, llm ${s.llmTtftMs}, tts ${s.ttsTtfbMs}, transport ${s.transportMs}, processing ${s.algorithmProcessingMs}); median of last ${recent.length}: ${Math.round(median(recent))} ms`,
      );
    },
    metric(m) {
      console.debug(`[voice] ${m.type} ${m.name}: ${Math.round(m.value)} ms`);
    },
  };
}
