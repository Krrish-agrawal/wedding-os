import { useCallControls } from '@/call/controls';

/**
 * One request at startup for server-owned display settings (the advisor's name).
 * Failure is harmless: the UI falls back to its defaults.
 */
export async function loadServerSettings(): Promise<void> {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return;
    const body = (await res.json()) as { advisorName?: unknown };
    if (typeof body.advisorName === 'string' && body.advisorName.trim() && !useCallControls.getState().advisorName) {
      useCallControls.setState({ advisorName: body.advisorName.trim() });
    }
  } catch {
    // Server not reachable yet; defaults apply.
  }
}
