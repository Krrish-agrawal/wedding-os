/**
 * Optional API base URL for deployments where the web app and the API are on different origins and there is no proxy or
 * rewrite in front (for example two Render services). Set `VITE_API_BASE_URL=https://api.example.com`. When it is unset
 * (local development with the Vite proxy, or Vercel with its `/api` rewrite) nothing changes.
 *
 * Every API call in the app uses a relative `/api/...` URL, so one wrapper around `fetch` covers them all. WebSockets
 * have their own setting (`VITE_WS_ORIGIN`, see session/socketUrl.ts).
 */
const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim().replace(/\/+$/, '');

export function withApiBase(input: RequestInfo | URL): RequestInfo | URL {
  return base && typeof input === 'string' && input.startsWith('/api/') ? `${base}${input}` : input;
}

if (base && typeof window !== 'undefined') {
  const original = window.fetch.bind(window);
  window.fetch = (input, init) => original(withApiBase(input), init);
}
