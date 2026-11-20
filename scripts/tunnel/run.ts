/**
 * Keeps a public HTTPS tunnel to the local API server alive for Agora's tool calls.
 *
 * Cloudflare quick tunnels are free and need no account, but they die for good when their connection drops
 * (for example when the laptop sleeps), and every new one has a new address. This script:
 * - runs the project-local cloudflared binary (HTTP/2, since UDP is often blocked),
 * - writes each new address into PUBLIC_BASE_URL in the root .env and restarts the API server to load it,
 * - checks the address from the public internet every 30 s and replaces the tunnel when it stops answering.
 *
 * Run with `pnpm tunnel`. It changes only the PUBLIC_BASE_URL line of .env.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, utimes, writeFile } from 'node:fs/promises';
import { Resolver } from 'node:dns/promises';
import https from 'node:https';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENV_FILE = path.join(ROOT, '.env');
const SERVER_ENTRY = path.join(ROOT, 'apps/server/src/index.ts');
const LOCAL_TARGET = 'http://127.0.0.1:8787';
const CHECK_EVERY_MS = 30_000;
/** Consecutive failed public checks before the tunnel is replaced. */
const FAILURES_BEFORE_RESTART = 3;
const CHECK_TIMEOUT_MS = 8_000;
const RESTART_DELAY_MS = 2_000;
/** A new trycloudflare hostname takes a few seconds to appear in public DNS. */
const DNS_WAIT_MS = 45_000;
const URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const FATAL_PATTERN = /Tunnel not found|Unauthorized/;

const require = createRequire(path.join(ROOT, 'apps/server/package.json'));
const CLOUDFLARED = path.join(path.dirname(require.resolve('cloudflared/package.json')), 'bin/cloudflared');

/** Public resolvers: this Mac's own DNS is often slow to learn new tunnel hostnames. */
const resolver = new Resolver();
resolver.setServers(['1.1.1.1', '8.8.8.8']);

let child: ChildProcess | null = null;
let currentUrl: string | null = null;
let failures = 0;
let stopping = false;
let restarting = false;

function log(msg: string) {
  console.log(`[tunnel ${new Date().toLocaleTimeString('en-IN', { hour12: false })}] ${msg}`);
}

async function setPublicUrl(url: string) {
  const env = await readFile(ENV_FILE, 'utf8').catch(() => '');
  const line = `PUBLIC_BASE_URL=${url}`;
  const next = /^PUBLIC_BASE_URL=.*$/m.test(env) ? env.replace(/^PUBLIC_BASE_URL=.*$/m, line) : `${env.trimEnd()}\n${line}\n`;
  if (next === env) return;
  await writeFile(ENV_FILE, next);
  // tsx watch restarts the API server on source changes; touching the entry file makes it re-read .env.
  const now = new Date();
  await utimes(SERVER_ENTRY, now, now);
  log(`PUBLIC_BASE_URL set to ${url}; API server restarting to load it`);
}

/** GET <url>/api/health, resolving the hostname through public DNS. */
async function publicHealth(url: string): Promise<boolean> {
  const { hostname } = new URL(url);
  let address: string | undefined;
  try {
    [address] = await resolver.resolve4(hostname);
  } catch {
    return false;
  }
  if (!address) return false;
  return new Promise((resolve) => {
    const req = https.get(
      { host: address, servername: hostname, headers: { host: hostname }, path: '/api/health', timeout: CHECK_TIMEOUT_MS },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

async function waitUntilReachable(url: string): Promise<boolean> {
  const deadline = Date.now() + DNS_WAIT_MS;
  while (Date.now() < deadline) {
    if (await publicHealth(url)) return true;
    await new Promise((r) => setTimeout(r, 3_000));
  }
  return false;
}

function start() {
  failures = 0;
  log('starting cloudflared quick tunnel');
  child = spawn(CLOUDFLARED, ['tunnel', '--protocol', 'http2', '--no-autoupdate', '--url', LOCAL_TARGET], { stdio: ['ignore', 'pipe', 'pipe'] });
  const onOutput = (chunk: Buffer) => {
    const text = chunk.toString();
    const found = URL_PATTERN.exec(text)?.[0];
    if (found && found !== currentUrl) {
      currentUrl = found;
      void (async () => {
        log(`tunnel address ${found}`);
        await setPublicUrl(found);
        log((await waitUntilReachable(found)) ? 'reachable from the public internet' : 'not reachable yet; will keep checking');
      })();
    }
    if (FATAL_PATTERN.test(text)) void restart('Cloudflare no longer recognises this tunnel');
  };
  child.stdout?.on('data', onOutput);
  child.stderr?.on('data', onOutput);
  child.on('exit', (code) => {
    child = null;
    if (!stopping && !restarting) void restart(`cloudflared exited (code ${code ?? 'none'})`);
  });
}

async function restart(reason: string) {
  if (restarting || stopping) return;
  restarting = true;
  log(`replacing the tunnel: ${reason}`);
  currentUrl = null;
  child?.kill('SIGTERM');
  child = null;
  await new Promise((r) => setTimeout(r, RESTART_DELAY_MS));
  restarting = false;
  start();
}

setInterval(async () => {
  if (!currentUrl || restarting) return;
  if (await publicHealth(currentUrl)) {
    failures = 0;
    return;
  }
  failures += 1;
  log(`public check failed (${failures}/${FAILURES_BEFORE_RESTART})`);
  if (failures >= FAILURES_BEFORE_RESTART) await restart('the address stopped answering');
}, CHECK_EVERY_MS);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    stopping = true;
    child?.kill('SIGTERM');
    process.exit(0);
  });
}

start();
