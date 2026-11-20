import { useEffect, useState } from 'react';
import { SessionActionSchema, VIEW_LABELS, type SessionSummary } from '@ave/shared';
import { content } from '@/content';
import { useDispatch, useSessionConnection, useSessionState } from '@/session/useSession';
import { Stage } from '@/call/Stage';
import { ViewDock } from '@/call/ViewDock';
import { usePresenterKeys } from '@/call/usePresenterKeys';
import { AdvisorPanels } from '@/studio/advisor/AdvisorPanels'; // Tools workstream: tool console + simulated advisor
import { PresenceLab } from '@/call/presence/PresenceLab'; // Presence workstream: avatar lip-sync lab
import PlanEditor from '@/studio/plan-editor/PlanEditor'; // Plans workstream: electrical and plumbing editor
import Studio3D from '@/studio/shots/Studio3D'; // 3D workstream: shot capture and renders

/**
 * Developer studio (not linked from the product). The Director drives any session by hand
 * through the same reducer the advisor uses. Other workstreams add panels here.
 */
export default function Studio() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [json, setJson] = useState('{"type":"set_view","view":"money","params":{"tab":"emi"}}');
  const [msg, setMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<'director' | 'plan' | '3d'>('director');
  useSessionConnection(sessionId, 'studio');
  const state = useSessionState();
  const dispatch = useDispatch();
  usePresenterKeys(state, dispatch);

  const refresh = async () => {
    const r = await fetch('/api/sessions');
    setSessions(((await r.json()) as { sessions: SessionSummary[] }).sessions);
  };
  useEffect(() => {
    void refresh();
  }, []);

  const createTestSession = async () => {
    const r = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Studio Test', phone: '9000000000', email: 'studio@example.com' }),
    });
    const { sessionId: id } = (await r.json()) as { sessionId: string };
    setSessionId(id);
    void refresh();
  };

  const sendJson = () => {
    try {
      const action = SessionActionSchema.parse(JSON.parse(json));
      dispatch(action);
      setMsg('Sent');
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  return (
    <div className="grid h-full grid-cols-[320px_1fr] gap-4 p-4">
      <aside className="flex flex-col gap-3 overflow-auto text-sm">
        <h1 className="font-display text-xl font-bold">Studio · Director</h1>
        <button className="rounded-lg border-2 border-ink bg-blue px-3 py-2 font-semibold" onClick={createTestSession}>
          New test session
        </button>
        <select className="rounded-lg border-2 border-line px-2 py-2" value={sessionId ?? ''} onChange={(e) => setSessionId(e.target.value || undefined)}>
          <option value="">Pick a session…</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.buyerName} · {s.id} · {VIEW_LABELS[s.view]}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-2">
          {content.properties.map((b) => (
            <button key={b.property.id} className="rounded-lg border-2 border-line px-2 py-1" onClick={() => dispatch({ type: 'set_property', propertyId: b.property.id })}>
              {b.property.name}
            </button>
          ))}
        </div>
        <textarea className="h-28 rounded-lg border-2 border-line p-2 font-mono text-xs" value={json} onChange={(e) => setJson(e.target.value)} />
        <button className="rounded-lg border-2 border-ink px-3 py-2 font-semibold" onClick={sendJson}>
          Dispatch action
        </button>
        {msg && <p className="text-ink-soft">{msg}</p>}
        {state && <pre className="overflow-auto rounded-lg bg-paper p-2 text-[11px]">{JSON.stringify({ view: state.view, propertyId: state.propertyId, params: state.params[state.view], rev: state.rev }, null, 2)}</pre>}
        <AdvisorPanels sessionId={sessionId} /> {/* Tools workstream */}
        <PresenceLab /> {/* Presence workstream */}
      </aside>
      <main className="flex min-h-0 flex-col gap-3">
        <div className="flex gap-2 text-sm font-semibold">
          {([['director', 'Director'], ['plan', 'Plan editor'], ['3d', '3D shots and renders']] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)} aria-pressed={tab === id} className={`rounded-lg border-2 px-3 py-1 ${tab === id ? 'border-ink bg-blue-tint' : 'border-line'}`}>
              {label}
            </button>
          ))}
        </div>
        {tab === '3d' ? (
          <div className="min-h-[620px] flex-1 overflow-auto">
            <Studio3D />
          </div>
        ) : tab === 'plan' ? (
          <div className="min-h-[620px] flex-1 overflow-auto">
            <PlanEditor />
          </div>
        ) : state ? (
          <>
            <div className="min-h-0 flex-1">
              <Stage state={state} dispatch={dispatch} role="studio" />
            </div>
            <ViewDock state={state} dispatch={dispatch} />
          </>
        ) : (
          <div className="grid h-full place-items-center text-ink-soft">Create or pick a session to drive.</div>
        )}
      </main>
    </div>
  );
}
