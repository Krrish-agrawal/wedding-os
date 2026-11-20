import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles.css';
import PlanEditor from './PlanEditor';

/**
 * Stand-alone dev entry for the plan editor, served by Vite at
 * /src/studio/plan-editor/harness.html. The same editor mounts inside /studio.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="h-screen p-4">
      <PlanEditor />
    </div>
  </StrictMode>,
);
