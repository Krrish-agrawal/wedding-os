import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { loadServerSettings } from './session/bootstrap';
import './styles.css';

void loadServerSettings();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
