import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles.css';
import Studio3D from './Studio3D';

/**
 * Stand-alone dev entry for the 3D studio tools, served by Vite at
 * /src/studio/shots/harness.html. The same tools mount inside /studio.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Studio3D />
  </StrictMode>,
);
