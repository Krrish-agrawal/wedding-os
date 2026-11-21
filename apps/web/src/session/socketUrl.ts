/**
 * WebSocket address for a server path such as `/ws`.
 *
 * Locally the web app and the API share an origin (Vite proxies `/ws`). When the web app is hosted
 * on its own (Vercel) and the server elsewhere, `VITE_WS_ORIGIN` names the server, e.g.
 * `wss://api.example.com`: Vercel can forward plain HTTP to the server but not WebSocket upgrades.
 */
export function socketUrl(path: string): string {
  const configured = (import.meta.env.VITE_WS_ORIGIN as string | undefined)?.trim().replace(/\/+$/, '');
  if (configured) return `${configured}${path}`;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}${path}`;
}
