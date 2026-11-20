# Voice runbook

How to run and check a live voice call: the buyer's browser, Agora Conversational AI Engine (ARES ASR, OpenAI, Murf Falcon), our MCP tools, and a human advisor joining the same channel. Written by the Voice workstream on 2026-11-20.

## How the pieces fit

| Piece | Where | What it does |
|---|---|---|
| Token route | `POST /api/sessions/:id/voice/token` `{ role: buyer \| advisor }` | One RTC + RTM token per participant (`buildTokenWithRtm`), expiry in seconds from now (`VOICE_TOKEN_TTL_SEC`, default 7200). Buyer uid 2001, human advisor 3001, agent 1000. Channel `ave-<sessionId>`. |
| Agent start | `POST /api/sessions/:id/voice/start` `{ restart? }` | Starts the agent with `agora-agents` (App ID + certificate only). Name `ave-<sessionId>-<n>`, unique per start. Hears only uid 2001. Returns `{ available, agentId, standby, warnings }` or `{ available: false, reason }`. |
| Status check | inside the start | Two seconds after Agora accepts a start, the server reads the agent's status; if it already exited it stops it and retries with the next name (up to 3 retries). See "Known live behaviour". |
| Screen awareness | server, on every session change | Debounced 300 ms `update` of `llm.system_messages = [brief, (handoff or resume context), screen line]`; one update in flight at a time. Buyer clicks on a view, property, tour room or legal card also get one `think` (rate limited to one per 2.5 s). |
| Typed input | `POST /api/sessions/:id/voice/text` | Recorded as a buyer transcript line, then sent to the agent with `think` (takes the floor like speech). |
| Agent state | `POST /api/sessions/:id/voice/state` | The buyer's browser reports listening / thinking / speaking for the Desk. |
| Stop | `POST /api/sessions/:id/voice/stop`, call end, server shutdown | Reads the agent's history, adds any line the browser never relayed, then `leave`. |
| Handoff | session `handoff.status` | `joined`: the agent says one handover line (graceful farewell lets it finish), leaves, `agent.status = standby`. `returned`: a new agent, no greeting, with `buildHandoffContext` in its system messages, nudged to welcome the buyer back. |
| Browser | `apps/web/src/call/voice/` | `client.ts` implements `useCallControls` (lazy loaded); `buyerCall.ts` runs RTC, RTM, the toolkit, captions relay, reconnection and agent watchdog; `advisor.ts` / `advisorCall.ts` give the human advisor audio. |

## Before the first call

1. `.env` at the repository root (never commit it). Required for voice: `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`, `OPENAI_API_KEY`, `MURF_API_KEY`. `MURF_VOICE_ID` defaults to `Anusha`, `ASR_VENDOR` to `ares`, `ASR_LANGUAGE` to `en-IN`. Blank `KEY=` lines count as unset.
2. `PUBLIC_BASE_URL` must be an HTTPS origin Agora's cloud can reach, pointing at the API server (port 8787). Without it the agent starts with tools off and `voice/start` returns a warning; with a `localhost` value it warns that Agora cannot reach it. On this machine the lead runs a Cloudflare quick tunnel (`pnpm --filter @ave/server exec cloudflared tunnel --protocol http2 --url http://127.0.0.1:8787`); its hostname changes every time it restarts, so update `PUBLIC_BASE_URL` and restart the server (`touch apps/server/src/index.ts`).
3. Optional: `LLM_MODEL`, `LLM_REASONING_EFFORT` (none | low | medium | high, sent as `llm.params.reasoning_effort`; reasoning models such as `gpt-6-luna` need `none` to call tools on chat completions), `MURF_BASE_URL` (pin `wss://us-east.api.murf.ai/v1/speech/stream-input` for 5 concurrent calls instead of 2), `FILLER_WAIT_MS`, `AGENT_IDLE_TIMEOUT_SEC`, `AGENT_MAX_HISTORY`, `MCP_TIMEOUT_MS`, `AGORA_AREA` (default AP), `AGORA_DEBUG=1` (logs the redacted start request).

### In Agora Console (console.agora.io)

- The project uses **App ID + App Certificate** (secured mode). The certificate in `.env` must be the project's primary certificate.
- **Conversational AI Engine** is enabled for the project (Products & Usage). A start without it fails with 401/403 or "service not enabled".
- **Signaling (RTM)** is enabled for the project. Without it the browser's RTM login fails: voice still works, but there are no captions, no agent state and no metrics.
- Usage: Conversational AI minutes and RTC minutes appear under Usage; each live call uses one agent.
- Agora Analytics / Call Inspector: search channel `ave-<sessionId>` to see the buyer (2001), agent (1000) and human advisor (3001), their audio quality and join/leave times.

## Step 1: server-only smoke test (no browser, about 30 seconds)

Run from the repository root while the dev server is up. It costs a few seconds of agent time and ends by stopping the agent.

```sh
B=http://127.0.0.1:8787; J='content-type: application/json'
curl -s $B/api/health                                   # agora/openai/murf/publicTools should be true
SID=$(curl -s -X POST $B/api/sessions -H "$J" -d '{"name":"Test Buyer","phone":"9876543210","email":"test@example.com"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["sessionId"])')
curl -s $B/api/sessions/$SID/voice                       # {"available":true,"warnings":[]}
curl -s -X POST $B/api/sessions/$SID/voice/token -H "$J" -d '{"role":"buyer"}'   # token starts with 007, uid 2001
curl -s -X POST $B/api/sessions/$SID/voice/start -H "$J" -d '{}'                 # {"available":true,"agentId":"A44...","standby":false,"warnings":[]}
curl -s -X POST $B/api/sessions/$SID/voice/text  -H "$J" -d '{"text":"Hi, can you show me what properties are available?"}'   # {"delivered":true}
sleep 8
curl -s $B/api/sessions/$SID | python3 -c 'import json,sys; s=json.load(sys.stdin)["state"]; print(s["agent"]); print(s["timeline"][-3:])'
curl -s -X POST $B/api/sessions/$SID/voice/stop -H "$J" -d '{}'                  # agent history is copied into the transcript
curl -s $B/api/sessions/$SID | python3 -c 'import json,sys; [print(l["role"], l["text"]) for l in json.load(sys.stdin)["state"]["transcript"]]'
```

In the server log expect, in order: `agent started` (with `tools: "mcp"`), three `POST /mcp` from the tunnel host right after the start (initialize, initialized, tools/list), then `tool call` lines (`showShortlist via mcp ok`) after the typed message, then `agent left`. The transcript should end with the advisor's spoken answer (lines with ids `hist-<agentId>-<n>`).

## Step 2: browser call

1. Use desktop Chrome at `http://localhost:5173` (the Browser pane blocks the microphone; it can only test typed mode). Wear headphones for the first run.
2. Fill the landing form, accept the ringing call. Expected within about 4 seconds: the advisor greets you by first name, captions appear under the advisor tile (partial lines grey, then final), the advisor tile shows listening / thinking / speaking.
3. Say "Show me what's available", "Let's see the apartment", "Take me to the kitchen". The screen should change as the advisor starts answering.
4. Click a dock chip (for example Pricing). The advisor should react in one sentence without being asked; while it is mid-sentence the click is only added to its context (it is not cut off).
5. Interrupt the advisor mid-sentence: it should stop within about half a second.
6. Type a message instead of talking (type box): it appears as your caption and the advisor answers it.
7. Press "Talk to a human": the advisor acknowledges, the Desk rings. From `/desk`, join the call as a named advisor: the AI says one handover line and goes to "Standing by"; the advisor's voice is heard in the buyer tab and vice versa. Turn the buyer camera on: the human advisor sees it (it is never published to the AI). Hand back: within about 5 seconds the AI welcomes the buyer back and knows what was discussed.
8. End the call. The agent leaves (server log `agent left`) and the summary screen opens.
9. In the browser console (dev builds only) each turn logs `[voice] turn N: X ms end to end (asr, llm, tts, transport, processing)` with a running median. Production builds log nothing.

## Troubleshooting

| Symptom | Likely cause | Where to look / fix |
|---|---|---|
| `voice/start` returns `available: false` naming env vars | Missing credentials | `.env`, then restart the server |
| Warning "Tools are off" | `PUBLIC_BASE_URL` unset or `http` with `TOOL_TRANSPORT=http` | Set the tunnel or deployment URL |
| `voice/start` returns 502 | Agora rejected the start | Server log `agent start failed` has Agora's `reason: detail`. 401/403: certificate or ConvoAI not enabled. 409 is retried automatically. 422: quota. |
| Log `agent start did not hold; retrying` | Agent exited right after start | See "Known live behaviour"; one retry usually succeeds |
| No greeting, captions empty, advisor audio silent | Buyer not subscribed / autoplay blocked | Browser console; after a reload click once anywhere (`audioBlocked` in the controls store) |
| Greeting heard but no captions | RTM login failed (Signaling not enabled) | Browser console `[voice] RTM unavailable` |
| Advisor answers but the screen never changes | MCP not reachable or tools off | Server log: no `POST /mcp` after start means Agora cannot reach `PUBLIC_BASE_URL`; check `curl -X POST $PUBLIC_BASE_URL/mcp` returns 401 without a token |
| Agent speaks twice or talks to the human advisor | Should not happen: `remote_rtc_uids` is the buyer only | Check the join body with `AGORA_DEBUG=1` |
| Second simultaneous call has no voice | Murf concurrency (2 on the global endpoint) | Pin `MURF_BASE_URL` to US-East, or run one call at a time |
| Dev server restarted mid-call | In-memory sessions are lost on restart; agents are stopped on shutdown | Start a new call |

## Known live behaviour (2026-11-20)

- About one start in three exited immediately with `agent exits with reason: RTC connection error` (status FAILED, `start_ts == stop_ts`). In every such case our server saw the engine's MCP `initialize` (answered 200) and then nothing more, while healthy starts send initialize, initialized and tools/list within 600 ms. Starts with tools off, or with an MCP token our server rejects, never failed in 12 tries. So the failure follows MCP discovery, most likely the quick tunnel dropping a response; it may also be on Agora's side. The server now detects it two seconds after the start and retries with a new name, so the buyer only sees a slower start (about 7 to 9 seconds instead of 4). Worth re-testing on a deployed URL, and raising with Agora with agent ids if it persists.
- On the second tunnel (restarted 04:00) the next six starts all held on the first try, each with initialize, initialized and tools/list arriving within 650 ms.
- `voice/start` takes about 4 seconds (Agora's start plus the two-second status check). The greeting does not wait for it: it plays as soon as the agent is in the channel.
- Browser check in the Browser pane (microphone blocked, so typed mode): greeting caption relayed in full, typed "Let's see the apartment please" made the advisor call `openProperty` and `tourGoTo` over MCP (screen switched to the tour) and answer; no duplicate caption for the typed line; End call left the agent STOPPED and the transcript complete. Dev metrics on that run: LLM time to first byte 1.2 s for a plain turn, 2.3 to 3.0 s for turns with tool calls; TTS first byte about 95 ms.
- Every dev-server restart (tsx watch, which happens whenever any server file changes) drops in-memory sessions; the shutdown hook stops running agents, so nothing is left talking.
- The engine's history contains the filler phrase it spoke ("Let me pull that up.") as an assistant message, and `tool` role entries (ignored by the transcript cross-check).
- A `think` sent to an agent that already exited returns 404 `TaskNotFound`.

## What only a live test can confirm

- Whether ARES `en-IN` with our keywords transcribes Bengaluru locality names, "2 BHK", "Khata", "ek crore twenty lakh" well, and how it compares with Deepgram nova-3 (`ASR_VENDOR=deepgram`, `ASR_API_KEY`) and Sarvam.
- How the chosen Murf voice reads `₹1,28,00,000`, Hindi words in Devanagari, and project names; whether `MURF_VOICE_ID` should change.
- Turn-taking feel: semantic end of speech at 320 ms silence / 3000 ms max wait, interruption thresholds (160 ms listening, 320 ms speaking), and whether the advisor's own voice from laptop speakers ever triggers an interruption with AEC on.
- Filler words at 2000 ms: whether they fire only on slow turns (tool calls, live commute lookups) and never on normal ones.
- Latency per turn (target: end to end under about 1.5 s for plain turns) for the chosen model, with and without `LLM_REASONING_EFFORT=none`.
- Whether `think` text (screen events, typed input) is echoed back as a user transcription over RTM. The client filters both (`[screen]` marker and recent typed text), but the echo itself is unverified.
- Whether a buyer click arriving while the advisor is speaking is ignored as intended (`on_speaking_action: ignore`) and whether the screen line update alone keeps the next answer accurate.
- Graceful farewell: that the handover line always finishes before the agent leaves.
- The hand-back nudge: that 1.5 s after the restart is long enough for the new agent to act on `think` (it retries up to 3 times).
- Reconnection: pull the network for 10 s and for 3 minutes; the first should resume on its own, the second should rejoin and replace the agent (idle timeout 120 s).
- Token renewal after `VOICE_TOKEN_TTL_SEC` on a long call (set it to 600 to test quickly).
- Two-person audio: the human advisor and the buyer hear each other with no echo, and the AI never responds to the human (it only subscribes to uid 2001).
- Camera: the buyer's camera reaches the human advisor only while they are on the call.
- Caption timing in WORD mode (captions follow the audio) and the fallback to TEXT mode if the engine sends no word timings.

## Public tunnel (Agora must reach /mcp)

`pnpm tunnel` runs `scripts/tunnel/run.ts`: a Cloudflare quick tunnel over HTTP/2 that writes its address into
`PUBLIC_BASE_URL` in `.env`, restarts the API server to load it, checks the address from public DNS every 30 s,
and replaces the tunnel when it stops answering (quick tunnels die for good when the connection drops, e.g. when
the laptop sleeps). Keep it running for the whole session; a replaced tunnel restarts the API server, which ends
any call in progress.

Symptom of a dead tunnel: the advisor greets you, then answers everything with its failure line ("Sorry, I lost
that for a moment…") and no tool calls appear in the server log. Never add `parallel_tool_calls` to the agent's
LLM params: OpenAI rejects it whenever the request has no tools, which turns a tunnel outage into every reply failing.

## Speech recognition (ARES)

Symptom of a recognition problem: the advisor stops talking when the buyer speaks (voice activity is detected) but
no buyer captions appear and the replies are generic ("I didn't catch that"). The dev endpoint
`GET /api/sessions/:id/voice/debug/history` shows the running agent's history: user turns with `"content": ""` and
`"source": "asr"` mean ARES heard speech but produced no text.

Found on 2026-11-20: ARES returned empty text for every utterance while `asr.keywords` included nearby place names
with punctuation, accents and Kannada script. Keywords are now plain ASCII terms, at most 40, without place names
(`voice/keywords.ts`). `ASR_KEYWORDS=off` disables them; `ASR_VENDOR=openai` switches to OpenAI transcription.

Testing without a microphone: in the built-in browser, replace `navigator.mediaDevices.getUserMedia` with a
Web Audio `MediaStreamDestination` before accepting the call, then play speech into it (for example a WAV made with
macOS `say -v Rishi -o line.wav --data-format=LEI16@24000 "..."`). The agent hears it exactly like a real mic.
