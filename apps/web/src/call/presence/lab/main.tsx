import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useSessionConnection } from '@/session/useSession';
import { PresenceLab } from '../PresenceLab';
import '@/styles.css';

/** Standalone host for the Presence lab (see lab.html). */
function LabPage() {
  const sessionId = new URLSearchParams(location.search).get('session') ?? undefined;
  useSessionConnection(sessionId, 'studio');
  return (
    <main className="min-h-full bg-canvas p-6">
      <PresenceLab />
    </main>
  );
}

const container = document.getElementById('root');
if (container) {
  // Keep one root across hot reloads of this entry.
  const root = (import.meta.hot?.data.root as Root | undefined) ?? createRoot(container);
  if (import.meta.hot) import.meta.hot.data.root = root;
  root.render(
    <StrictMode>
      <LabPage />
    </StrictMode>,
  );
}
