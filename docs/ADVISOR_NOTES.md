# Advisor Notes — verified against live docs and the npm registry

Checked on 2026-11-20. Sources are listed per section. "Verified" means read in the vendor's own documentation, type definitions or published package source on that date. Nothing here was executed against live Agora, Murf or OpenAI accounts; anything that needs a live call to confirm is listed under **Unverified** at the end. Where this file and `BUILD_PLAN.md` disagree, this file wins; where this file and the live docs disagree, the docs win.

---

## Decisions

**Agent control**
1. Use the official server SDK **`agora-agents@2.15.0`** for start, stop, update, think, say and interrupt, in app-credentials mode (`appId` + `appCertificate` only). It emits the documented REST field names (checked in its source) and mints the agent token itself. Wrap it behind one small `AgentGateway` interface. `AGORA_CUSTOMER_ID` / `AGORA_CUSTOMER_SECRET` are not needed.
2. Agent `name` must be unique on every start (reuse returns 409). Use `ave-<sessionId>-<startCounter>`.
3. UIDs are numeric, sent as strings: agent `"1000"`, buyer e.g. `"2001"`, human advisor `"3001"`. `remote_rtc_uids` takes exactly one UID (the buyer). RTM user id is `String(uid)`.

**Tokens**
4. Browser: one combined RTC+RTM token per user from `generateClientToken` (SDK) or `RtcTokenBuilder.buildTokenWithRtm` (`agora-token@2.0.7`). Agent: `generateConvoAIToken` / `ConvoAITokenBuilder.buildToken` (RTC + RTM + ConvoAI). Expiry arguments are seconds from now, never `0`.

**Web client**
5. Packages: `agora-rtc-sdk-ng@4.24.10`, **`agora-rtm@2.3.0`** (not `agora-rtm-sdk`; the toolkit's peer dependency names `agora-rtm`), and **`agora-agent-client-toolkit@2.10.0`** — Agora's web toolkit is on npm under that name. Do not hand-parse RTM payloads. Skip `agora-agent-client-toolkit-react` (it needs `agora-rtc-react`).
6. The app must call `rtm.subscribe(channel, { withMessage: true, withPresence: true })` itself; the toolkit only attaches listeners.

**Screen context (section 6.4 of the plan changes)**
7. Do not rely on RTM presence reaching the OpenAI model. It is documented only as a non-standard top-level `context.presence` field for a custom LLM to interpret.
8. Primary mechanism, all documented: (a) server calls `update` with `llm.system_messages = [brief, screenStateLine]` whenever screen state changes, debounced; (b) every tool result carries a `screen` snapshot; (c) clicks that deserve a spoken reaction go through `think`.
9. Fallback behind `LLM_ROUTE=proxy`: our own `/llm/:token/chat/completions` that injects screen state and streams OpenAI's SSE through untouched. Test on day one whether MCP tool calls still execute in that mode before depending on it.

**Tools**
10. MCP is primary. Tool names must be **letters and digits only, starting with a letter, no `mcp` prefix**: `showShortlist`, `openProperty`, `tourGoTo`, `tourWalkthrough`, `showBlueprint`, `showLocality`, `showCommute`, `showCompass`, `showMoney`, `applyOffer`, `requestDiscount`, `showLegal`, `getVisitSlots`, `bookSiteVisit`, `updateLead`, `sendReport`, `requestHuman`. The plan's snake_case names are rejected by the custom-HTTP-tool fallback.
11. MCP server: **`@modelcontextprotocol/sdk@1.32.2`** (v1 line), stateless, one `McpServer` + transport per POST, mounted in Fastify on raw req/res. Omit `allowed_tools`. Never return a protocol error from a tool; return a normal result with `{ ok: false, reason }`.

**Speech**
12. ASR: start with **ARES, `language: "en-IN"`, with `keywords`**. It is the only vendor that accepts `asr.keywords`, needs no extra key, and keeps semantic end-of-speech available. Bake-off alternatives behind `ASR_VENDOR`: Deepgram `nova-3` and Sarvam.
13. TTS: `vendor: "murf"`, `model: "FALCON"`, `sample_rate: 24000`, `base_url: wss://global.api.murf.ai/v1/speech/stream-input`. Shortlist voices **Anusha, Pooja, Anisha** (female) and **Nikhil, Samar, Abhinav** (male); all list `en-IN`, `hi-IN` and `hi-LATN`. Default `MURF_VOICE_ID=Anusha`, `MURF_LOCALE=en-IN`; pick by ear.
14. Prompt rule from Murf: Hindi words in Devanagari, English in Latin, numbers and money as digits (`₹1,28,00,000`), no markdown. This replaces the plan's "say one point two eight crore" instruction.

**Avatar**
15. `@met4citizen/talkinghead@1.8.2` + `@met4citizen/headaudio@1.1.0`. **Pin `three@0.186.1`** for the whole workspace (TalkingHead depends on `three ^0.186`; installing 0.187 gives two copies). `@types/three@0.186.0`.
16. Import HeadAudio by deep path (`@met4citizen/headaudio/dist/headaudio.min.mjs`); its `main` field points at a file that is not in the package. `mpfb.glb` is not on npm: copy it from the TalkingHead repo (`avatars/mpfb.glb`, CC0, 36.8 MB) and optimise it.
17. Feed the Agora track straight into the HeadAudio node and let Agora play the audio. Validate this in Chrome in the first hour of the Presence workstream.

**Stack pins**
18. `typescript@6.0.3`, not 7.0.2: `typescript-eslint@8.73.0` declares `typescript >=4.8.4 <6.1.0`. Full table in section 9. Node on this machine is v22.23.3, which satisfies every `engines` field checked.

**Maps**
19. Satellite: MapTiler Cloud free plan (no card, logo required, PoC/non-commercial wording). Fallback style: OpenFreeMap (no key, street map). Routing: precompute presets with the OSRM demo server (1 req/s, non-commercial); live custom routes go through our server with a timeout. Geocoding: Nominatim through our server only, under its usage policy (section 10).

**Needs an owner decision**
20. The engine must reach `/mcp` (and `/llm` in proxy mode) over the public internet. A tunnel binary conflicts with the "no global installs" rule; the owner must approve a tunnel or provide a deployed dev URL before the Voice and Tools workstreams can test end to end.

---

## 1. Agora agent REST API

Base: `https://api.agora.io/api/conversational-ai-agent`

| Action | Method and path | Body |
|---|---|---|
| Start | `POST /v2/projects/{appid}/join` | below |
| Stop | `POST /v2/projects/{appid}/agents/{agentId}/leave` | none |
| Update | `POST /v2/projects/{appid}/agents/{agentId}/update` | `{ properties: { token?, llm?: { system_messages?, params? }, mllm?: { params? } } }` |
| Speak (TTS only) | `POST /v2/projects/{appid}/agents/{agentId}/speak` | `{ text (≤512 bytes), priority?: "INTERRUPT"\|"APPEND"\|"IGNORE", interruptable?: boolean }` |
| Think (inject as user input) | `POST /v2/projects/{appid}/agents/{agentId}/think` | below |
| Interrupt | `POST /v2/projects/{appid}/agents/{agentId}/interrupt` | `{}` |
| History | `GET /v2/projects/{appid}/agents/{agentId}/history` | only while the agent is running |
| Also exist | `query`, `list`, `turns` | not read in detail |

**Auth.** Two modes: token (documented as recommended) `Authorization: agora token="<token>"`, where the same token also goes in `properties.token`; or Basic `Authorization: Basic base64(customerId:customerSecret)`. Tokens last at most 86400 s. The SDK sends the token form for you.

**Start response:** `{ "agent_id": "...", "create_ts": 1737111452, "status": "RUNNING" }`. Failure: `{ detail, reason }`. Codes worth handling: 409 name conflict, 422 quota, 429 rate limit (back off), 503 startup failure (retry).

**Update.** Only `token`, `llm.system_messages`, `llm.params` and `mllm.params` are updatable. `llm.params` is overwritten whole, so always send the complete object. `system_messages` are "appended to the beginning of each LLM request"; the doc's own example adds a second system message carrying context. ASR, TTS, MCP servers, greeting and turn detection cannot be changed mid-session.

**Think body.**
```json
{
  "text": "The buyer tapped the kitchen on the mini floor plan.",
  "on_listening_action": "interrupt",
  "on_thinking_action": "interrupt",
  "on_speaking_action": "ignore",
  "interruptable": true,
  "metadata": { "source": "ui" }
}
```
`on_listening_action`: `inject | interrupt | append | ignore` (default `interrupt`). `on_thinking_action` and `on_speaking_action`: `interrupt | append | ignore` (defaults `interrupt` and `ignore`). The text is processed as user input and the agent answers it; it is not a silent context channel.

### Join body — field notes

- `properties.channel`, `token`, `agent_rtc_uid` (string), `remote_rtc_uids` (array of strings, "currently only one user ID is supported"), `enable_string_uid` (default false), `idle_timeout` (seconds after the remote user leaves; default 30; 0 disables).
- `advanced_features`: `enable_rtm`, `enable_tools`, `enable_sal`. With `enable_rtm`, the agent reuses `properties.token` for RTM, so that token needs RTC and RTM privileges.
- `asr`: `vendor` (`ares` default, `microsoft`, `deepgram`, `openai`, `google`, `gemini`, `amazon`, `assemblyai`, `sarvam`, `smallestai`, `xai`), `language` (BCP-47, default `en-US`), `keywords` (≤128; **only when vendor is unset or `ares`**, otherwise the request fails), `params` (required for every non-ARES vendor since v2.13), `credential_mode`.
- `llm`: `url`, `api_key`, `system_messages[]`, `greeting_message`, `greeting_configs { mode: single_every|single_first, delay_ms, interruptable }`, `failure_message`, `max_history` (default 32), `params`, `input_modalities`, `output_modalities`, `vendor` (`openai|azure|xai|custom`), `style` (`openai` default), `template_variables`, `headers` (merged into the LLM request; engine headers win), `mcp_servers[]`, `tools[]`. **`mcp_servers` sits directly under `llm`.**
- `tts`: `vendor`, `params`, `skip_patterns` (e.g. `[3,4]` skips `( )` and `[ ]` content).
- `turn_detection.config`: `speech_threshold`, `start_of_speech { mode: "vad", vad_config { interrupt_duration_ms, speaking_interrupt_duration_ms, prefix_padding_ms } }`, `end_of_speech { mode: "vad"|"semantic", vad_config { silence_duration_ms } | semantic_config { silence_duration_ms, max_wait_ms, pause_state_enabled } }`. The older flat fields are deprecated.
- `interruption` (top level, since v2.6): `enable`, `mode: "start_of_speech"|"keywords"`, `keywords_config.trigger_keywords`, `disabled_config.strategy: append|ignore`.
- `filler_words` is a **top-level property**, not under `llm`: `enable`, `trigger.fixed_time_config.response_wait_ms` (100–10000, default 1500), `content.mode: static|generated`, `content.static_config { phrases[1..100] (≤20 words each), selection_rule: shuffle|round_robin }`. At most one filler per turn; it also covers tool-call waits.
- `parameters`: `data_channel: "rtm"|"datastream"`, `enable_metrics`, `enable_error_message` (both need `enable_rtm`), `silence_config { timeout_ms, action: speak|think, content }`, `farewell_config { graceful_enabled, graceful_timeout_seconds }`, `audio_scenario`, `opt_out`.
- `labels`: key/value pairs echoed in webhook payloads. `geofence.area`: `GLOBAL|NORTH_AMERICA|EUROPE|ASIA|INDIA|JAPAN`.
- Semantic end-of-speech works only when the language is exactly one of `en-US`, `en-IN`, `zh-CN`, `zh-HK`, `zh-TW`. Any other language, or more than one, falls back to VAD (SDK ≥2.15.0 throws instead).

### Complete join body for this project

```json
{
  "name": "ave-<sessionId>-<startCounter>",
  "properties": {
    "channel": "ave-<sessionId>",
    "token": "<agent token: RTC + RTM (+ ConvoAI), uid 1000, this channel>",
    "agent_rtc_uid": "1000",
    "remote_rtc_uids": ["2001"],
    "enable_string_uid": false,
    "idle_timeout": 120,
    "advanced_features": { "enable_rtm": true, "enable_tools": true },
    "asr": {
      "vendor": "ares",
      "language": "en-IN",
      "keywords": ["BHK", "Vastu", "RERA", "Khata", "lakh", "crore", "<locality names>", "<project names>"]
    },
    "llm": {
      "url": "https://api.openai.com/v1/chat/completions",
      "api_key": "<OPENAI_API_KEY>",
      "style": "openai",
      "system_messages": [
        { "role": "system", "content": "<advisor brief, section 6.3>" },
        { "role": "system", "content": "SCREEN view=shortlist property=none" }
      ],
      "greeting_message": "<personalised greeting>",
      "greeting_configs": { "mode": "single_first" },
      "failure_message": "<short, in character>",
      "max_history": 24,
      "params": { "model": "<LLM_MODEL>" },
      "mcp_servers": [
        {
          "name": "estates",
          "endpoint": "<PUBLIC_BASE_URL>/mcp",
          "transport": "streamable_http",
          "headers": { "Authorization": "Bearer <per-session tool token>" },
          "timeout_ms": 8000
        }
      ]
    },
    "tts": {
      "vendor": "murf",
      "params": {
        "api_key": "<MURF_API_KEY>",
        "base_url": "wss://global.api.murf.ai/v1/speech/stream-input",
        "voiceId": "<MURF_VOICE_ID>",
        "locale": "<MURF_LOCALE>",
        "rate": 0,
        "pitch": 0,
        "model": "FALCON",
        "sample_rate": 24000
      }
    },
    "turn_detection": {
      "mode": "default",
      "config": {
        "speech_threshold": 0.5,
        "start_of_speech": {
          "mode": "vad",
          "vad_config": { "interrupt_duration_ms": 160, "speaking_interrupt_duration_ms": 320, "prefix_padding_ms": 800 }
        },
        "end_of_speech": {
          "mode": "semantic",
          "semantic_config": { "silence_duration_ms": 320, "max_wait_ms": 3000 }
        }
      }
    },
    "interruption": { "enable": true, "mode": "start_of_speech" },
    "filler_words": {
      "enable": true,
      "trigger": { "fixed_time_config": { "response_wait_ms": 1500 } },
      "content": {
        "mode": "static",
        "static_config": {
          "phrases": ["Let me pull that up.", "One moment.", "Sure, just a second."],
          "selection_rule": "shuffle"
        }
      }
    },
    "parameters": {
      "data_channel": "rtm",
      "enable_metrics": true,
      "enable_error_message": true,
      "farewell_config": { "graceful_enabled": true, "graceful_timeout_seconds": 10 }
    },
    "labels": { "session_id": "<sessionId>" }
  }
}
```

Every field name above appears in the join reference or the vendor pages. Numeric values (timeouts, thresholds, history length) are starting points taken from the docs' own examples, to be tuned. Tuning numbers belong in named server config, not in code.

Notes:
- MCP server `name`: letters and digits only, ≤48 chars.
- `allowed_tools`: omitting it or `["*"]` enables everything. The docs warn that an empty array or a name that matches no real tool "doesn't fail cleanly: the agent can hang mid-response with no error".
- Attaching servers without `enable_tools: true` silently disables all tools.
- After MCP discovery at most 32 tools are exposed; a name conflict or overflow makes **agent startup fail**.
- With `farewell_config.graceful_enabled`, `leave` waits for the agent to go idle, so a spoken handover line can finish before the agent leaves.

Sources: https://docs.agora.io/en/api-reference/api-ref/conversational-ai/join.md · `/leave.md` · `/update.md` · `/speak.md` · `/think.md` · `/interrupt.md` · `/history.md` · `/authentication.md` · `/status-codes.md` (same directory) · https://docs.agora.io/en/ai/build/shape-the-conversation/filler-words.md · https://docs.agora.io/en/ai/build/shape-the-conversation/interrupt-agent.md · https://docs.agora.io/en/ai/build/shape-the-conversation/asr-keywords.md · https://docs.agora.io/en/ai/release-notes.md

### ASR for Indian English with Hindi mixed in

What the docs establish (capability, not accuracy):

| Vendor | Block | Term boosting | Notes |
|---|---|---|---|
| ARES | `{ "vendor": "ares", "language": "en-IN", "keywords": [...] }` | `keywords`, ≤128 | Built in, no key. `en-IN` and `hi-IN` are both in the supported list. `"en-IN,hi-IN"` is accepted as a comma-separated string but disables semantic end-of-speech. The keywords page says mixed-language terms may be listed together. |
| Deepgram | `{ "vendor": "deepgram", "params": { "url": "wss://api.deepgram.com/v1/listen", "api_key": "...", "model": "nova-3", "language": "en", "keyterm": "term1%20term2" } }` | `keyterm` (nova-3 only), one URL-encoded string | Agora-managed mode exists (`"credential_mode": "managed"`, no key) for `nova-2`/`nova-3`. Deepgram documents code-switching with `language=multi` on Nova-3. |
| Sarvam | `{ "vendor": "sarvam", "language": "en-US", "params": { "api_key": "...", "language": "hi-IN" } }` | none documented on Agora's page | Indian-language specialist; `params.language: "unknown"` auto-detects. Marked "newer to the platform". |
| Microsoft | `{ "vendor": "microsoft", "language": "en-IN", "params": { "key": "...", "region": "...", "language": "en-IN", "phrase_list": [...] } }` | `phrase_list` | Needs an Azure key. |

Recommendation and test: start on ARES `en-IN` with keywords. Record ten scripted buyer lines (locality names, "2 BHK", "Khata", "ek crore twenty lakh", one full Hindi sentence) and compare the user transcripts across ARES `en-IN`, ARES `en-IN,hi-IN`, and Deepgram nova-3. Keep the vendor in `ASR_VENDOR` config. Remember `asr.keywords` must be removed from the request for any non-ARES vendor.

Sources: https://docs.agora.io/en/ai/models/asr/ares.md · `/deepgram.md` · `/sarvam.md` · `/microsoft.md` · https://docs.agora.io/en/realtime-media/speech-to-text/reference/supported-languages.md · https://docs.agora.io/en/ai/build/managed-mode.md · https://developers.deepgram.com/docs/multilingual-code-switching

---

## 2. Server SDK

`agora-agents` is the official TypeScript SDK (repo `AgoraIO/agora-agents-ts`, Fern-generated client plus an "agentkit" builder layer). Latest **2.15.0**, published 2026-11-19; `3.0.0-alpha.4` exists under the `alpha` tag — do not use it. Node ≥18. Only dependency: `agora-token ^2.0.6`. Ships ESM and CJS with types.

It covers every field we need. Checked in the published source: `MurfTTS` emits `{ vendor: "murf", params: { api_key, base_url, voiceId, locale, rate, pitch, model, sample_rate } }`; `OpenAI` emits `url, api_key, params{model,…}, system_messages, greeting_message, failure_message, max_history, style: "openai", mcp_servers, tools, template_variables, headers`.

```ts
import {
  AgoraClient, Agent, Area, OpenAI, MurfTTS, AresSTT, ExpiresIn,
  type FillerWordsConfig,
} from 'agora-agents';

const client = new AgoraClient({
  area: Area.AP,                       // Area.US | EU | AP | CN
  appId: env.AGORA_APP_ID,
  appCertificate: env.AGORA_APP_CERTIFICATE,   // no customerId/secret => "app-credentials" auth
});

const agent = new Agent({ client })
  .withStt(new AresSTT({ keywords }))
  .withTurnDetection({ language: 'en-IN', config: turnDetectionConfig }) // language is also sent as asr.language
  .withInterruption({ enable: true, mode: 'start_of_speech' })
  .withLlm(new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    url: 'https://api.openai.com/v1/chat/completions',   // required when apiKey is set
    model: env.LLM_MODEL,
    systemMessages: [{ role: 'system', content: brief }, { role: 'system', content: screenLine }],
    greetingMessage, failureMessage,
    maxHistory: config.maxHistory,
    greetingConfigs: { mode: 'single_first' },
    mcpServers: [{
      name: 'estates',
      endpoint: `${env.PUBLIC_BASE_URL}/mcp`,
      transport: 'streamable_http',
      headers: { Authorization: `Bearer ${toolToken}` },
      timeout_ms: config.mcpTimeoutMs,
    }],
  }))
  .withTts(new MurfTTS({
    key: env.MURF_API_KEY,
    voiceId: env.MURF_VOICE_ID,
    locale: env.MURF_LOCALE,
    baseUrl: 'wss://global.api.murf.ai/v1/speech/stream-input',
    model: 'FALCON',
    sampleRate: 24000,
  }))
  .withAdvancedFeatures({ enable_rtm: true })   // must come BEFORE withTools
  .withTools(true)
  .withParameters({ data_channel: 'rtm', enable_metrics: true, enable_error_message: true })
  .withFillerWords(fillerWords)
  .withLabels({ session_id: sessionId });

const session = agent.createSession({
  channel,
  agentUid: '1000',                 // numeric string when the token is auto-generated
  remoteUids: [String(buyerUid)],
  name: `ave-${sessionId}-${startCounter}`,
  idleTimeout: config.idleTimeoutSec,
  expiresIn: ExpiresIn.hours(2),
  debug: env.AGORA_DEBUG === '1',   // logs the redacted request body
});

const agentId = await session.start();        // Promise<string>
await session.update({ llm: { system_messages: [...] } });  // sent as { properties: <this object> }
await session.think(text, { on_listening_action: 'interrupt', on_speaking_action: 'ignore' });
await session.say(text, { interruptable: true });
await session.interrupt();
await session.stop();                          // or client.stopAgent(agentId) with no session object; 404 is treated as success
```

Gotchas found in the source:
- `withAdvancedFeatures()` **replaces** the whole object; `withTools(true)` **merges** `enable_tools` into it. Call `withAdvancedFeatures({ enable_rtm: true })` first, or pass `{ enable_rtm: true, enable_tools: true }` once and skip `withTools`.
- `AresSTT` has no `language` option; language comes from `withTurnDetection({ language })`, default `en-US`.
- The `maxTokens` option serialises to `params.max_tokens`. If the chosen OpenAI model wants a different field, set it through `params` instead.
- `session.start()` returns the agent id string (the "build from scratch" tutorial destructures `{ agentId }`, which does not match the reference or the source).
- `AgentSession` keeps state in memory. Persist `agentId` in the session record and use `client.stopAgent(agentId)` after a server restart.
- Token helpers: `generateConvoAIToken({ appId, appCertificate, channelName, uid, tokenExpire?, privilegeExpire? })`, `generateClientToken({ ...same })`, `ExpiresIn.hours(n) | minutes(n) | seconds(n)`.

Sources: https://docs.agora.io/en/api-reference/api-ref/server-sdk/typescript.md · https://docs.agora.io/en/ai/models/tts/murf.md · https://docs.agora.io/en/ai/models/llm/openai.md · package source at https://unpkg.com/agora-agents@2.15.0/dist/esm/agentkit/ (`Agent.mjs`, `AgentSession.mjs`, `token.mjs`, `vendors/tts.mjs`, `vendors/llm.mjs`) · `npm view agora-agents`

---

## 3. Tokens

`agora-token@2.0.7` (CommonJS, ships types). Exports: `RtcTokenBuilder`, `RtcRole`, `RtmTokenBuilder`, `ConvoAITokenBuilder`, `Rtm2Permissions`, plus others.

```ts
import { RtcTokenBuilder, RtcRole, RtmTokenBuilder, ConvoAITokenBuilder } from 'agora-token';

// RTC only
RtcTokenBuilder.buildTokenWithUid(appId, appCertificate, channelName, uid, RtcRole.PUBLISHER, tokenExpire, privilegeExpire);

// RTM only
RtmTokenBuilder.buildToken(appId, appCertificate, userId /* String(uid) */, expire);

// ONE token for RTC + RTM, same uid  <-- use this for buyer and human advisor
RtcTokenBuilder.buildTokenWithRtm(appId, appCertificate, channelName, account /* uid */, RtcRole.PUBLISHER, tokenExpire, privilegeExpire);

// Agent token: RTC + RTM + ConvoAI service (also valid as the REST Authorization token)
ConvoAITokenBuilder.buildToken(appId, appCertificate, channelName, agentUid, tokenExpire, privilegeExpire);
```

- `tokenExpire` and `privilegeExpire` are **seconds from now**, not timestamps. A `privilegeExpire` of `0` is treated by the SDK as invalid ("expires immediately"); pass the same value as `tokenExpire`. Maximum 86400.
- Yes, a single token can cover RTC and RTM for one uid: `buildTokenWithRtm`. The SDK's `generateClientToken` calls exactly that. Use it for `rtc.join(appId, channel, token, uid)` and `rtm.login({ token })`. The uid cannot be `0`.
- The agent needs a token for its own uid in the session channel with RTC and RTM privileges when `enable_rtm` is on. In app-credentials mode the SDK generates it (ConvoAI builder) and uses the same token for REST auth.
- When the agent token nears expiry Agora fires webhook event `104 agent expire`; refresh through `update { token }`. For a demo, a 2-hour token avoids this.
- Agora's own tutorial passes an absolute timestamp to `buildTokenWithUid`; the package's doc comments say seconds from now. Follow the package.

Sources: https://unpkg.com/agora-token@2.0.7/index.d.ts · https://unpkg.com/agora-token@2.0.7/src/RtcTokenBuilder2.js · `ConvoAITokenBuilder.js` · https://docs.agora.io/en/api-reference/faq/integration/rtc_rtm_token.md · https://docs.agora.io/en/api-reference/api-ref/conversational-ai/authentication.md

---

## 4. Web client

| Package | Latest | Notes |
|---|---|---|
| `agora-rtc-sdk-ng` | 4.24.10 | |
| `agora-rtm` | 2.3.0 | peer `agora-rtc-sdk-ng ^4.24.3` |
| `agora-rtm-sdk` | 2.3.0 | same description and entry file as `agora-rtm`; Agora's tutorial installs this one, the toolkit's peer names `agora-rtm` |
| `agora-agent-client-toolkit` | 2.10.0 | MIT, peers `agora-rtm >=2.0.0`, `agora-rtc-sdk-ng >=4.23.4`; ESM + CJS + types |
| `agora-agent-client-toolkit-react` | 2.10.0 | peers `react >=18`, `agora-rtc-react >=2.0.0`, toolkit `2.10.0` — skip |

The toolkit exports both naming styles: `AgoraVoiceAI` = `ConversationalAIAPI`, `AgoraVoiceAIEvents` = `EConversationalAIAPIEvents`, `TranscriptHelperMode` = `ETranscriptHelperMode`, `AgentState` = `EAgentState`.

```ts
import AgoraRTC from 'agora-rtc-sdk-ng';
import AgoraRTM from 'agora-rtm';
import { AgoraVoiceAI, AgoraVoiceAIEvents, TranscriptHelperMode, ChatMessageType, ChatMessagePriority } from 'agora-agent-client-toolkit';

AgoraRTC.setParameter('ENABLE_AUDIO_PTS_METADATA', true);   // before createClient; needed for WORD mode
const rtc = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

const { RTM } = AgoraRTM;                                   // default export is the AgoraRTM namespace object
const rtm = new RTM(appId, String(uid));                    // one instance for the app lifetime; never wrap in a Proxy/store
await rtm.login({ token });
await rtm.subscribe(channel, { withMessage: true, withPresence: true });   // the toolkit does NOT do this

const ai = await AgoraVoiceAI.init({ rtcEngine: rtc, rtmEngine: rtm, renderMode: TranscriptHelperMode.WORD, enableRenderModeFallback: true });
ai.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, (items) => store.setTranscript(items));   // full list each time: replace, don't append
ai.on(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, (agentUid, e) => store.setAgentState(e.state));
ai.on(AgoraVoiceAIEvents.AGENT_INTERRUPTED, (agentUid, e) => presence.onInterrupted());
ai.on(AgoraVoiceAIEvents.AGENT_METRICS, (agentUid, m) => metrics.push(m));
ai.on(AgoraVoiceAIEvents.AGENT_ERROR, (agentUid, err) => onAgentError(err));
ai.subscribeMessage(channel);                               // before the agent is started

await rtc.join(appId, channel, token, uid);
// ...publish mic; on 'user-published' audio from the agent uid: subscribe, play(), hand the track to the avatar

// typed input ("type instead of talk"), interrupt button
await ai.sendText(agentUid, { messageType: ChatMessageType.TEXT, text, priority: ChatMessagePriority.INTERRUPTED, responseInterruptable: true });
await ai.interrupt(agentUid);
// teardown
ai.unsubscribe(); ai.destroy();
```

Client-side `ai.think(agentUid, { text, onListeningAction, onThinkingAction, onSpeakingAction, interruptable, metadata })` and `ai.speak(agentUid, { text, priority, interruptable })` also exist (toolkit ≥ the v2.12 engine release). Prefer server-side `think` so the server stays the single writer.

### Payload shapes (from the toolkit's published type declarations)

Each RTM `message` event has `{ publisher: string, message: string | Uint8Array, ... }`; `message` is a JSON string that needs its own `JSON.parse`. Long payloads can arrive in pieces (the toolkit ships a `ChunkedMessageAssembler`), which is the main reason not to parse by hand.

```ts
// object: "user.transcription"
{ object, text, start_ms, duration_ms, language, turn_id, stream_id, user_id, words: Word[] | null, final: boolean }

// object: "assistant.transcription"
{ object, text, start_ms, duration_ms, language, turn_id, stream_id, user_id, words: Word[] | null,
  quiet: boolean, turn_seq_id: number, turn_status: 0 | 1 | 2 }      // 0 in progress, 1 ended, 2 interrupted
type Word = { word: string, start_ms: number, duration_ms: number, stable: boolean }

// object: "message.interrupt"
{ object, message_id, data_type: "message", turn_id, start_ms, send_ts }

// object: "message.metrics"
{ object, module: "asr" | "llm" | "mllm" | "tts" | "context" | "unknown", metric_name, turn_id, latency_ms, send_ts }

// object: "message.error"
{ object, module, code, message, turn_id, send_ts }

// "turn.finished"
{ object | event_type: "turn.finished", payload: { turn_id, agent_id, start: { start_at }, metrics: { e2e_latency_ms, segmented_latency_ms: [{ name, latency }] } } }

// agent state as RTM messages (documented page "Get agent state")
{ event_id, event_type: "state.listening" | "state.thinking" | "state.speaking", event_ms, payload: { value: boolean, timestamp } }

// agent state as RTM presence
event.stateChanged = { state: "idle" | "silent" | "listening" | "thinking" | "speaking", turn_id }
```

What the toolkit hands the app:
```ts
TRANSCRIPT_UPDATED: Array<{ uid: string, stream_id: number, turn_id: number, _time: number, text: string,
                            status: 0 | 1 | 2, metadata: Partial<UserTranscription | AgentTranscription> | null }>
AGENT_STATE_CHANGED: (agentUserId, { state, turnID, timestamp, reason })
AGENT_LISTENING_CHANGED | AGENT_THINKING_CHANGED | AGENT_SPEAKING_CHANGED: (agentUserId, active: boolean)
AGENT_INTERRUPTED: (agentUserId, { turnID, timestamp })
AGENT_METRICS: (agentUserId, { type, name, value, timestamp })
AGENT_TURN_FINISHED: (agentUserId, { agentId, turnId, timestamp, e2eLatencyMs, segmentedLatency: { algorithmProcessingMs, asrTtlwMs, llmTtftMs, transportMs, ttsTtfbMs } })
AGENT_ERROR: (agentUserId, { type, code, message, timestamp })
```
`AGENT_STATE_CHANGED` is flagged deprecated-but-supported in the toolkit README; the three per-flag events are the newer form. `state.speaking: false` is estimated from TTS length and can precede the end of local playback.

Caption rule for the plan: a line is partial while `status === 0` (user: `metadata.final === false`), final at `1`, cut off at `2`.

Sources: https://docs.agora.io/en/api-reference/api-ref/conversational-ai/client-toolkit/web.md · https://docs.agora.io/en/ai/build/transcripts.md · https://docs.agora.io/en/ai/build/handle-runtime-events/event-notifications.md · https://docs.agora.io/en/ai/best-practices/get-agent-state.md · https://unpkg.com/agora-agent-client-toolkit@2.10.0/dist/index.d.ts · https://github.com/AgoraIO-Conversational-AI/agent-client-toolkit-ts · https://unpkg.com/agora-rtm@2.3.0/agora-rtm.d.ts · https://docs.agora.io/en/ai/build/build-server-client.md

---

## 5. Screen context to the agent

### What "Pass information to the agent" really does

- Requires `advanced_features.enable_rtm: true`.
- The client sets RTM presence state. Web call (from the RTM type declarations):
  ```ts
  await rtm.presence.setState(channel, 'MESSAGE', { view: 'money', property: 'apartment', room: 'kitchen' });
  await rtm.presence.removeState(channel, 'MESSAGE', { states: ['room'] });
  ```
  `setState(channelName, channelType, state: { [key: string]: string })`; `removeState(channelName, channelType, { states?: string[] })`. Values are **strings only**, at most 32 keys per user per channel, and the state only takes effect once the user has subscribed to the channel.
- "Before invoking the LLM, the agent automatically retrieves the active user's temporary status information and transmits it as context to the model", in the request body as a **top-level `context` object next to `messages`**:
  ```json
  { "messages": [{ "role": "user", "content": "What does this mean?" }],
    "context": { "presence": { "userA": { "selection": "Pythagorean Theorem" } } },
    "model": "openai" }
  ```
- The page's last step is "LLM Adaptation: adapt the LLM to process the temporary status information in the `context.presence` field", and it points to the custom LLM guide. The custom LLM sample request model has `context: Optional[Dict]`.

So the documented contract is: presence arrives as a non-OpenAI field that your own LLM service must read. Nothing in the docs says the engine folds it into `messages` for the OpenAI vendor. Treat presence as **not reaching the OpenAI model**.

### Recommended mechanism (documented pieces only)

1. **Silent state — `update`.** The server already owns `SessionState`. On any change to view, property, selected room, slider values or applied offer, debounce and call
   `session.update({ llm: { system_messages: [ {role:'system', content: brief}, {role:'system', content: screenLine} ] } })`.
   Keep `screenLine` one compact line, e.g. `SCREEN view=money property=apartment room=kitchen emi={down:30L,years:20} offer=festive`. Send both messages every time. Do not use `{{template_variables}}` in the brief; render it server-side so an update cannot lose substitutions.
2. **Tool results.** Every tool returns `screen` (already in the plan). This is the freshest source because it is in the conversation history itself.
3. **Events that deserve a reply — `think`.** A dock chip click or a mini-map room tap: call `think` with a short factual sentence. Suggested actions: `on_listening_action: "interrupt"`, `on_thinking_action: "append"`, `on_speaking_action: "ignore"` so a click never cuts the advisor off mid-sentence. Slider drags and hovers go through `update` only.

Known limits: `update` is a REST round trip, so a click followed instantly by speech can race it; the tool-result snapshot and the next update cover that. 429 exists on the API, hence the debounce. Presenter keys go through the same reducer, so they get the same treatment for free.

### Fallback: our own LLM endpoint (`LLM_ROUTE=proxy`)

Documented requirements for "Connect your own LLM service": an OpenAI Chat Completions-compatible endpoint; the request arrives with `stream: true` (the samples reject non-streaming); respond as SSE (`text/event-stream`, `data: {chunk}\n\n`, final `data: [DONE]\n\n`). Request fields seen in the samples: `model`, `messages`, `tools`, `tool_choice`, `parallel_tool_calls`, `stream`, `stream_options`, `response_format`, `modalities`, `audio`, `context`. Auth: whatever is in `llm.api_key`; extra headers via `llm.headers`. Setting `llm.vendor: "custom"` adds `turn_id` and `timestamp` to messages.

```ts
// llm.url = `${PUBLIC_BASE_URL}/llm/${llmToken}/chat/completions`; leave llm.vendor unset
app.post('/llm/:token/chat/completions', async (request, reply) => {
  const session = sessions.byLlmToken((request.params as { token: string }).token);
  if (!session) return reply.code(401).send({ detail: 'unauthorized' });

  const { context: _presence, ...body } = request.body as ChatCompletionRequest;
  body.messages = withScreenMessage(body.messages, session.screenLine());   // insert just before the last user message
  const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  reply.hijack();
  reply.raw.writeHead(upstream.status, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  for await (const chunk of upstream.body!) reply.raw.write(chunk);   // bytes through untouched: tool_call deltas survive
  reply.raw.end();
});
```

What is and is not known about tools in this mode:
- Verified: **custom HTTP tools (`llm.tools`) are not supported with custom LLMs** ("Custom LLMs, Dify, asynchronous tools, and stored tool references aren't supported").
- Not stated either way: whether **MCP** tools keep working when `llm.url` is not a first-party vendor. The custom-LLM sample code forwards `tools` and `tool_choice` from the incoming request, which suggests the engine sends them, but the MCP page is silent.
- A custom LLM may also send a first SSE chunk with `object: "chat.completion.custom_metadata"` and `metadata: { interruptable: false }` or `metadata: { tts_params: { params: {...} } }` to control interruption or change TTS parameters for that response.

Day-one test before adopting the proxy: start an agent with the proxy URL, MCP attached, `enable_tools: true`; log whether the incoming request carries `tools`, and whether a streamed `tool_calls` response produces a hit on `/mcp`.

Sources: https://docs.agora.io/en/ai/build/shape-the-conversation/custom-information.md · https://docs.agora.io/en/ai/build/custom-model-integration/custom-llm.md · https://docs.agora.io/en/api-reference/api-ref/conversational-ai/update.md · `/think.md` · https://docs.agora.io/en/ai/build/tools/custom-tools.md · https://unpkg.com/agora-rtm@2.3.0/agora-rtm.d.ts · https://docs.agora.io/en/realtime-media/rtm/build/manage-presence-and-metadata/presence.md

---

## 6. MCP tools

**Config fields (verified):** `name` (required, letters/digits, ≤48), `endpoint` (required; "reachable over HTTP or HTTPS"), `transport` (only `streamable_http`), `headers` (object, static values), `allowed_tools` (array), `timeout_ms` (integer). The engine is the MCP client. MCP works for cascading LLM agents and, since v2.12, MLLM agents.

**Session identifier:** none documented. Nothing says the engine sends an agent id, channel or MCP session id. Bind the session ourselves with the per-session bearer in `headers` (the join body is built per session, so a static value is enough).

**Header templating:** documented only for custom HTTP tools (`{{template_variables.x}}`, `{{tool_call_id}}` as a whole header value). Not documented for `mcp_servers[].headers`; assume static.

**Timeouts:** `timeout_ms` per server; "after the timeout, the agent stops waiting for a response and continues with subsequent logic". No default is documented for MCP (custom HTTP tools default to 10000, range 1000–100000).

**Failure behaviour:** documented for custom HTTP tools, not for MCP. For HTTP tools: non-2xx bodies are still handed to the model marked failed; timeouts and network errors are reported as failed and never retried; several tool calls in one model response run concurrently and the engine waits for all of them; an interruption does not cancel an in-flight request. For MCP assume the same and never depend on error semantics: always return a successful MCP result whose JSON says `{ ok: false, reason, say }`.

**Shared limits:** one namespace across custom, MCP, built-in and model-native tools; comparison is case-insensitive; max 32 exposed tools; names cannot start with `mcp` or equal `ragsearch_tool`; conflicts or overflow fail agent startup. Custom-tool names must match `^[a-zA-Z][a-zA-Z0-9]{0,63}$`. Agora's MCP examples do show underscores (`ask_question`), so the regex may apply only to `llm.tools`; using camelCase everywhere removes the question and lets both adapters share one name table.

**Custom HTTP tool fallback (shape, for the adapter):**
```json
{ "type": "function",
  "function": { "name": "showMoney", "description": "...", "parameters": { "type": "object", "properties": {}, "additionalProperties": false } },
  "execution": { "mode": "sync" },
  "server": { "method": "POST", "url": "https://<host>/tools/showMoney",
              "headers": { "Authorization": "{{template_variables.tool_auth}}", "Content-Type": "application/json" },
              "body": { "args": { "downPayment": "{{args.downPayment}}" }, "call": "{{tool_call_id}}" },
              "timeout_ms": 8000 } }
```
`server` is a sibling of `function`. URL must be absolute HTTPS. A placeholder must be a whole leaf value. A referenced argument that is missing or `null` fails the call with `UnresolvedTemplate` before reaching us, so optional arguments cannot be templated individually — a real constraint on the fallback adapter's schema design. Response body ≤1 MiB.

### MCP TypeScript SDK

Two lines exist:
- **v1: `@modelcontextprotocol/sdk@1.32.2`** — the `latest` tag of that package. Supports protocol versions `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`, `2024-10-07`. Peer `zod ^3.25 || ^4.0`. Bug and security fixes promised until at least six months after v2's release on 2026-07-27.
- **v2: `@modelcontextprotocol/server@2.4.0`** with `@modelcontextprotocol/node@2.1.2` and `@modelcontextprotocol/fastify@2.0.1` — the SDK's `main` branch, implementing the 2026-07-28 spec.

Use v1. Agora's docs do not say which protocol revision its client speaks, and v1 covers every revision that existed when Agora shipped MCP support.

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

function buildServer(session: Session): McpServer {
  const server = new McpServer({ name: 'estates', version: '1.0.0' });
  for (const tool of toolTable) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.inputShape }, async (args) => ({
      content: [{ type: 'text', text: JSON.stringify(await tool.run(session, args)) }],
    }));
  }
  return server;
}

app.post('/mcp', async (request, reply) => {
  const session = sessions.byToolToken(bearerOf(request.headers.authorization));
  if (!session) {
    return reply.code(401).send({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
  }
  const server = buildServer(session);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  reply.hijack();                                           // Fastify stops managing this response
  reply.raw.on('close', () => { void transport.close(); void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(request.raw, reply.raw, request.body);   // Fastify has already parsed the JSON body
});

const methodNotAllowed = { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null };
app.get('/mcp', (_req, reply) => reply.code(405).send(methodNotAllowed));
app.delete('/mcp', (_req, reply) => reply.code(405).send(methodNotAllowed));
```

- `sessionIdGenerator: undefined` is the documented stateless mode; `enableJsonResponse: true` returns plain JSON instead of an SSE stream, which suits sub-100 ms tools.
- The per-request server pattern is the one the SDK's own Fastify README shows (there with the v2 class `NodeStreamableHTTPServerTransport`; same `handleRequest(request.raw, reply.raw, request.body)` call).
- Tool handlers close over `session`, so no tool takes a session argument and the model never sees the token.
- `inputSchema` in v1 `registerTool` accepts a Zod raw shape or schema; keep inputs to plain types, enums and descriptions (Agora passes schemas in OpenAI non-strict mode and advises against `$ref`, `format`, `pattern`, ranges and composition).
- Verify the registered names the way Agora suggests:
  `curl -X POST $PUBLIC_BASE_URL/mcp -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`

Sources: https://docs.agora.io/en/ai/build/tools/mcp-tools.md · https://docs.agora.io/en/ai/build/tools/custom-tools.md · https://docs.agora.io/en/api-reference/api-ref/conversational-ai/join.md · https://github.com/modelcontextprotocol/typescript-sdk (README, `main`) · https://unpkg.com/@modelcontextprotocol/fastify@2.0.1/README.md · https://unpkg.com/@modelcontextprotocol/sdk@1.32.2/dist/esm/types.js · `/dist/esm/server/streamableHttp.d.ts` · `npm view @modelcontextprotocol/sdk`

---

## 7. Murf on Agora

**Agora REST params (exact):** `api_key` (required), `base_url`, `voiceId`, `locale`, `rate`, `pitch`, `model`, `sample_rate`. Agora's sample: `voiceId: "Matthew"`, `locale: "en-US"`, `model: "FALCON"`, `sample_rate: 24000`, `base_url: "wss://global.api.murf.ai/v1/speech/stream-input"`. Agora's SDK option names: `key`, `voiceId`, `baseUrl`, `locale`, `rate`, `pitch`, `model`, `sampleRate`. Extra params are "passed through directly to the underlying vendor without validation". Agora labels the Murf integration as newer to the platform.

**Model naming.** Murf's current model is **Falcon 2.1** (`falcon-2.1`). "The earlier identifiers `falcon-2`, `falcon2` and `FALCON` are still accepted and now use Falcon 2.1." WebSocket streaming serves Falcon only. Defaults on the socket: `sample_rate` 24000, `channel_type` MONO, `format` WAV. The plan's link `falcon-2.md` is stale; the page is `falcon-2-1.md`.

**Voice IDs** are short names. Falcon 2.1 voices listed under "English - India":

| Voice ID | Locales listed |
|---|---|
| Anusha | en-IN, hi-IN, hi-LATN |
| Pooja | en-IN, hi-IN, hi-LATN, kn-IN, ta-IN, te-IN, id-ID, ms-MY, vi-VN |
| Anisha | en-IN, hi-IN, hi-LATN, as-IN, bn-IN, mr-IN, or-IN, pa-IN, ta-IN, te-IN |
| Nikhil | en-IN, hi-IN, hi-LATN, kn-IN |
| Samar | en-IN, hi-IN, hi-LATN, kn-IN, mr-IN, or-IN, ta-IN, te-IN, as-IN, ar-XA |
| Abhinav | en-IN, hi-IN, hi-LATN, ml-IN, mr-IN |
| Prathamesh | en-IN, hi-IN, hi-LATN, mr-IN, te-IN |
| Aarav, Priya | en-IN, hi-IN |
| Chirag, Jaya, Neeta, Poonam, Pranav, Rachna | en-IN, hi-IN and many Indian languages (no hi-LATN) |
| Hardik | en-IN, gu-IN |
| Nimisha | en-IN, en-US, ml-IN |

`hi-LATN` is Murf's "Hinglish - India" locale. Pooja, Nikhil and Samar also list Kannada, useful for Bengaluru place names. The docs do not state gender or tone; the names suggest it, the ear decides. Falcon's only style is `Conversational`. Authoritative list: Murf's List Voices endpoint, `GET /v1/speech/voices?model=falcon-2.1`, or the Voice Library page.

**Hinglish.** Falcon 2.1 "Multinative speech": voices "switch between multiple languages within a single sentence", Hindi and English named explicitly. `multiNativeLocale` exists only on the HTTP Stream endpoint and is **deprecated in favour of `locale`**; on the WebSocket the field is `voice_config.locale`, which Agora exposes as `params.locale`. There is no separate multi-native parameter to set.

**Murf's writing rules, which belong in the system prompt:**
- "Send text in its original script… do not transliterate." For Hinglish: Devanagari for Hindi words, Latin for English words and brand names. Romanised Hindi is converted back internally, "which costs accuracy and adds 5–10 ms".
- "Keep numbers, dates and currency in their standard written form"; e.g. `₹1,25,000` is read as "one lakh twenty-five thousand rupees". Do not spell numbers out.
- No markdown, lists, emoji, URLs or SSML: "every symbol you write is read aloud". Shape pauses with punctuation; end the sentence after an amount.
- Pick a voice that lists every language in the text.
- Captions will therefore show Devanagari for Hindi words. That is correct behaviour, not a bug.

**Limits.** Falcon 2.1 concurrency on Free and Pay-as-you-go: **5 on US-East, 2 on global and every other regional endpoint**, counted per region as contexts actively generating audio. From Bengaluru the global router lands in India (limit 2). One live call uses one slot; two simultaneous demo calls are the ceiling unless `base_url` is pinned to `wss://us-east.api.murf.ai/v1/speech/stream-input`. Region list includes `wss://in.api.murf.ai/v1/speech/stream-input`. Price quoted: 1 cent per 1000 characters. On Murf's side an invalid API key is a WebSocket close with code 1008 after the upgrade succeeds, and exceeding concurrency closes with 4029; how Agora reports either to the client was not checked, so watch `AGENT_ERROR` with module `tts` on the first run.

Optional pass-through candidates (Murf fields, not validated by Agora): `style`, `volume_offset` (−50..50), `pronunciation_dictionary` for project and locality names.

Sources: https://docs.agora.io/en/ai/models/tts/murf.md · https://murf.ai/api/docs/text-to-speech-models/falcon-2-1.md · https://murf.ai/api/docs/voices-styles/voice-library.md · https://murf.ai/api/docs/text-to-speech/web-sockets.md · https://murf.ai/api/docs/api-reference/text-to-speech/stream-input.md · https://murf.ai/api/docs/api-reference/text-to-speech/stream.md · https://murf.ai/api/docs/text-to-speech/speech-customization.md · https://murf.ai/api/docs/resources/best-practices.md · https://murf.ai/api/docs/resources/rate-limits.md

---

## 8. Avatar lip-sync

**TalkingHead** — `@met4citizen/talkinghead@1.8.2`, MIT, ESM (`"type": "module"`, `main: modules/talkinghead.mjs`). `three` is a regular **dependency** `^0.186` (so `>=0.186.0 <0.187.0`), not a peer. The package contains only `modules/*.mjs`, `playback-worklet.js`, README and LICENSE: **no avatars, no animations**.

It imports `three`, `three/addons/controls/OrbitControls.js`, `three/addons/loaders/{GLTFLoader,DRACOLoader,FBXLoader}.js`, `three/addons/libs/meshopt_decoder.module.js`, `three/addons/environments/RoomEnvironment.js`, `three/addons/libs/stats.module.js`. `three@0.186.1` exports `./addons/*`, so these resolve in Vite without aliases.

```ts
import { TalkingHead } from '@met4citizen/talkinghead';
```

Two things in its source matter for bundling:
- Text lip-sync modules load through `import(path + 'lipsync-' + lang + '.mjs')`, which a bundler cannot follow. We use audio-driven lip-sync, so pass `lipsyncModules: []` and that code never runs.
- `new URL('./playback-worklet.js', import.meta.url)` is only used by `streamStart()`, which we do not call.

**HeadAudio** — `@met4citizen/headaudio@1.1.0`, MIT, no dependencies. `package.json` says `main: dist/headaudio.min.js`, but the published files are `dist/headaudio.min.mjs`, `dist/headworklet.min.mjs`, `dist/model-en-mixed.bin` and `modules/*.mjs`. The bare specifier will not resolve; there is no `exports` map, so deep imports work.

The class is `HeadAudio extends AudioWorkletNode`, one mono input, no audio output. Constructor `new HeadAudio(audioCtx, options)`; `loadModel(url)`; `update(dtMs)`; `start()`; `stop()`; callbacks `onvalue(key, value)`, `onstarted`, `onended`. `key` is an Oculus viseme name (`viseme_aa` … `viseme_sil`), `value` 0–1. Stated processing latency 50–100 ms.

```ts
import { TalkingHead } from '@met4citizen/talkinghead';
import { HeadAudio } from '@met4citizen/headaudio/dist/headaudio.min.mjs';
import workletUrl from '@met4citizen/headaudio/dist/headworklet.min.mjs?url';
import modelUrl from '@met4citizen/headaudio/dist/model-en-mixed.bin?url';

const head = new TalkingHead(el, {
  ttsEndpoint: 'N/A',            // as in the reference example; built-in TTS unused
  lipsyncModules: [],
  cameraView: 'upper',
  cameraRotateEnable: false,
});
await head.showAvatar({ url: avatarUrl, body: 'F', avatarMood: 'neutral' }, onProgress);

await head.audioCtx.audioWorklet.addModule(workletUrl);
const headaudio = new HeadAudio(head.audioCtx, { visemeMinMs: 120 });
await headaudio.loadModel(modelUrl);
headaudio.onvalue = (key, value) => {
  Object.assign(head.mtAvatar[key], { newvalue: value, needsUpdate: true });
};
head.opt.update = headaudio.update.bind(headaudio);     // runs inside TalkingHead's animation loop

// attachAudio(track): track = agentUser.audioTrack.getMediaStreamTrack()
function attachAudio(track: MediaStreamTrack) {
  const stream = new MediaStream([track]);
  const keepAlive = new Audio();                         // Chrome: Web Audio may get no samples from a remote
  keepAlive.muted = true;                                // WebRTC stream until a media element touches it
  keepAlive.srcObject = stream;
  const source = head.audioCtx.createMediaStreamSource(stream);
  source.connect(headaudio);                             // lip-sync only; Agora's own play() stays the audible path
}

// on the "accept call" click (user gesture):
head.start();
await head.audioCtx.resume();
```

How this differs from the reference example (`openai.html`): there the remote stream is connected to `head.audioAnalyzerNode`, which runs through TalkingHead's gain and reverb to the speakers, and HeadAudio taps `head.audioSpeechGainNode`. That makes TalkingHead the audio player. If the direct-to-HeadAudio wiring above misbehaves, the fallback is the example's exact wiring with Agora's `audioTrack.play()` **not** called, so the audio is not doubled. In that variant a `DelayNode` (about 0.1 s) between gain and reverb can line the sound up with the lips. The example also calls `head.lookAtCamera(500)` and `head.speakWithHands()` from `headaudio.onstarted` when the previous `onended` was more than 150 ms earlier, and pauses both on `visibilitychange` (`head.stop(); headaudio.stop()` / `start()`).

Expression API confirmed in the README: `setMood(mood)`, `playGesture(name, dur=3, mirror=false, ms=1000)` with hand gestures `handup`, `index`, `ok`, `thumbup`, `thumbdown`, `side`, `shrug` (also animated emoji), `stopGesture(ms)`, `lookAtCamera(t)`, `makeEyeContact(t)`, `setView('full'|'mid'|'upper'|'head', opt)`.

**Avatar file.** `avatars/mpfb.glb` lives only in the GitHub repo (36,815,920 bytes). README: "Example avatar 'mpfb.glb' was created using Blender and MPFB Blender extension. The avatar is licensed under CC0." The others are restricted: `brunette.glb` CC BY-NC 4.0 (Ready Player Me), `avatar.glb`/`avaturn.glb` Avaturn non-commercial, `avatarsdk.glb` non-commercial, `vroid.glb` non-commercial. The owner should place `mpfb.glb` in `assets/` (it is a third-party download, which the plan reserves for the owner). At 36.8 MB it needs texture downscaling and compression before shipping; TalkingHead's loader has Draco and Meshopt decoders wired but no KTX2 loader, so use WebP/JPEG textures and Meshopt, and re-check every blend shape after optimising. Draco decoding pulls a decoder from `https://www.gstatic.com/draco/v1/decoders/` by default (`dracoDecoderPath` option), so prefer Meshopt to stay self-contained.

**Vite settings to add** (reasoned from the package layout, not run):
```ts
resolve: { dedupe: ['three'] },
optimizeDeps: { exclude: ['@met4citizen/talkinghead', '@met4citizen/headaudio'] },
```

TalkingHead creates its own WebGL renderer, so the call screen runs two WebGL contexts (tour canvas and avatar). Budget for it in the 60 fps target. The `avatarOnly` mode that renders into an existing scene is marked experimental; do not use it.

The lip-sync model is `model-en-mixed.bin`, trained on English voices. It classifies sound, not words, so Hindi words will animate, with unknown fidelity.

Sources: https://github.com/met4citizen/TalkingHead (README) · https://github.com/met4citizen/HeadAudio (README) · https://raw.githubusercontent.com/met4citizen/HeadAudio/main/openai.html · https://unpkg.com/@met4citizen/talkinghead@1.8.2/package.json · `/modules/talkinghead.mjs` · https://unpkg.com/@met4citizen/headaudio@1.1.0/package.json · `/modules/headaudio.mjs` · https://data.jsdelivr.com/v1/package/npm/@met4citizen/talkinghead@1.8.2 · https://api.github.com/repos/met4citizen/TalkingHead/contents/avatars

---

## 9. Versions (npm `latest` on 2026-11-20)

| Package | Pin | Notes |
|---|---|---|
| react, react-dom | 19.3.1 | |
| @types/react, @types/react-dom | 19.3.0 | |
| vite | 8.3.8 | Node `^20.19.0 \|\| >=22.12.0` |
| @vitejs/plugin-react | 6.3.0 | peer `vite ^8` |
| typescript | **6.0.3** | `latest` is 7.0.2, but `typescript-eslint@8.73.0` peers `typescript >=4.8.4 <6.1.0` |
| typescript-eslint / eslint | 8.73.0 / 10.15.0 | eslint Node `^20.19 \|\| ^22.13 \|\| >=24` |
| tailwindcss + @tailwindcss/vite | 4.3.5 + 4.3.5 | v4; plugin peers `vite ^5.2 \|\| ^6 \|\| ^7 \|\| ^8` |
| zustand | 5.1.0 | peer `react >=18` |
| motion | 14.14.0 | peer `react ^18 \|\| ^19`; import from `motion/react` |
| three | **0.186.1** | `latest` is 0.187.0; held back for TalkingHead |
| @types/three | 0.186.0 | |
| @react-three/fiber | 9.8.2 | peers `react >=19 <19.4`, `three >=0.156` |
| @react-three/drei | 10.7.9 | peers `react ^19`, `three >=0.159`, fiber `^9` |
| camera-controls | 3.1.2 | peer `three >=0.126.1` |
| maplibre-gl | 6.19.0 | ESM package (`"type": "module"`); `latest-5` tag is 5.24.1 |
| suncalc | 2.1.4 | published 2026-11-10, ships its own types, ESM + CJS; no `@types/suncalc` needed. `astronomy-engine@2.1.19` is the heavier alternative; not needed |
| zod | 4.6.7 | satisfies `openai` and MCP SDK peers (`^3.25 \|\| ^4.0`) |
| fastify | 5.12.8 | |
| @fastify/websocket | 11.3.7 | declares `fastify: '5.x'` |
| @fastify/cors | 11.4.3 | declares `fastify: '5.x'` |
| @fastify/static | 10.1.12 | declares `fastify: '5.x'` |
| openai | 7.60.0 | Node `>=22`; peer `zod ^3.25 \|\| ^4.0` |
| @modelcontextprotocol/sdk | 1.32.2 | see section 6 |
| agora-agents | 2.15.0 | |
| agora-token | 2.0.7 | comes in through `agora-agents`; add directly only if imported directly |
| agora-rtc-sdk-ng | 4.24.10 | |
| agora-rtm | 2.3.0 | |
| agora-agent-client-toolkit | 2.10.0 | |
| @met4citizen/talkinghead | 1.8.2 | |
| @met4citizen/headaudio | 1.1.0 | |
| @gltf-transform/core, functions, cli | 4.5.1 each | cli Node `>=20` |
| meshoptimizer | 1.3.0 | |
| vitest | 5.1.1 | peer `vite ^6.4 \|\| ^7 \|\| ^8`; Node `^22.12 \|\| ^24 \|\| >=26` |
| tsx | 4.23.15 | |
| @types/node | 22.x line to match the runtime | `latest` is 26.6.6 |

Peer conflicts found:
1. **three**: TalkingHead `^0.186` vs npm latest 0.187.0. Pinning 0.186.1 satisfies fiber, drei and camera-controls. Add `resolve.dedupe: ['three']` and check `npm ls three` shows one copy.
2. **TypeScript 7** vs typescript-eslint. Pin 6.0.3.
3. **agora-rtm vs agora-rtm-sdk**: install `agora-rtm` so the toolkit's peer is met.
4. **React**: fiber requires `<19.4`; 19.3.1 is inside the range. Do not float React.
5. `agora-agent-client-toolkit-react` would add `agora-rtc-react`; not used.

Runtime: local Node is v22.23.3. `node:sqlite` loads and runs there without a flag (checked: `DatabaseSync` works) but prints `ExperimentalWarning: SQLite is an experimental feature` on stderr; filter that one warning in the server's log setup rather than silencing all warnings.

Source: `npm view <pkg> version dist-tags peerDependencies engines` for each row, run 2026-11-20.

---

## 10. Maps

### Satellite tiles

| Provider | Card | Free allowance | Terms that matter | Attribution |
|---|---|---|---|---|
| **MapTiler Cloud, Free** | "No credit card needed" | 100,000 API requests/month, 5,000 map sessions/month; "service will pause until the next month" when exceeded | Described as "suitable for testing, PoC, prototyping, personal, or non-commercial use" | Text `© MapTiler © OpenStreetMap contributors` (linked) on every map, plus the MapTiler logo on free accounts |
| ArcGIS Location Platform | not stated on the pricing page | "2M free" basemap tiles, "20K free" geocodes, "20K free" routes | commercial terms not read | not read |
| Stadia Maps, Free | not stated | 200,000 credits/month | "Commercial use not allowed"; satellite is listed under the paid Standard plan, not Free | — |

MapTiler raster endpoint pattern from its Tiles API reference: `https://api.maptiler.com/tiles/satellite-v4/{z}/{x}/{y}?key=KEY` (the reference example uses `satellite-v4`; the schema page still links `satellite-v2`; tileset spec says min zoom 0, max zoom 22, format jpg). Copy the exact TileJSON or style URL from the owner's MapTiler dashboard rather than hard-coding from this note. The key is a browser key (`MAP_TILES_KEY`); restrict it by HTTP origin in the dashboard.

Fallback when satellite fails: OpenFreeMap vector style `https://tiles.openfreemap.org/styles/liberty` (no key; attribution `OpenFreeMap © OpenMapTiles Data from OpenStreetMap`). It is a street map, not imagery, which is an honest fallback for "map tiles fail → second source".

A commercial launch would need a paid tile plan. For the demo, the Free plan's wording covers a prototype.

### Routing

- **OSRM demo server**: `https://router.project-osrm.org/route/v1/driving/{lon},{lat};{lon},{lat}?overview=full&geometries=geojson`. Policy: "restricted to reasonable, non-commercial use-cases", "Do not exceed 1 request per second", "no guarantees wrt. uptime, latency, or data updates". Data is OpenStreetMap: show `© OpenStreetMap contributors`.
- Use it from the **precompute script** for the preset routes (a dozen requests, spaced ≥1 s, results committed to `data/commute/`).
- Live custom destinations: call from the server only, 1 req/s global limiter, 4 s timeout, cache by rounded coordinates, and the plan's graceful "couldn't work that route out" path. OSRM durations are free-flow; label them as the plan says ("estimate without heavy traffic").
- Alternative with a key and no card: Geoapify Free — "3,000 credits / day", "up to 5 requests/second", "No credit card required", commercial use allowed with attribution; covers routing and geocoding at 1 credit per simple request. Worth it if the OSRM demo proves flaky.
- OpenRouteService: hosted limits page gives only structural limits (6,000 km per route, 50 waypoints); its plan quotas are on an account page that could not be read.

### Geocoding — Nominatim (`https://nominatim.openstreetmap.org/search`)

**Read the policy before using it: https://operations.osmfoundation.org/policies/nominatim/** The policy itself requires that anyone pointed at the service by an AI assistant be shown these restrictions prominently:
- "Absolute maximum of 1 request per second", counted across all users of the application together.
- A real identifying `User-Agent` or `Referer`; stock library user agents are rejected. Use something like `AgoraVirtualEstates-demo/1.0 (<owner contact>)` — the owner supplies the contact.
- **No autocomplete**, no as-you-type queries, no systematic or bulk queries.
- Cache results; repeated identical queries can get the app blocked.
- Show attribution; data is ODbL.
- The app must be able to switch the service off without a redeploy (a config flag).
- The policy forbids wiring the public API in as a generic geocoder without a deliberate, informed decision by the developer. The owner should confirm they accept the policy; otherwise use Geoapify geocoding.

Implementation consequence: geocode only inside `showCommute` when the buyer names a place that is not a preset, from the server, behind a 1 req/s limiter and an on-disk cache, biased to Bengaluru with `viewbox` + `bounded=1` and `countrycodes=in`.

The locality-places fetch script (OpenStreetMap via Overpass) is a one-off authoring step; keep it to a few queries and commit the output.

Sources: https://www.maptiler.com/cloud/pricing/ · https://docs.maptiler.com/cloud/api/tiles/ · https://docs.maptiler.com/schema-raster/satellite.md · https://docs.maptiler.com/guides/map-design/attribution/add-attribution.md · https://stadiamaps.com/pricing/ · https://location.arcgis.com/pricing/ · https://openfreemap.org/quick_start/ · https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server · https://www.geoapify.com/pricing/ · https://giscience.github.io/openrouteservice/hosted-api-restrictions · https://operations.osmfoundation.org/policies/nominatim/

---

## 11. Plan corrections, in order of impact

1. **Section 6.4, screen awareness.** RTM presence → `context.presence` is documented as something a custom LLM must read, not as something injected for OpenAI. Replace with `update` of `system_messages` (silent), tool-result snapshots, and `think` (events), all server-driven. Keep the proxy as a flagged fallback. Remove "also sets Agora Signaling presence state" from the browser's job.
2. **Section 6.5, tool names.** `show_shortlist`-style names fail the custom-tool pattern `^[a-zA-Z][a-zA-Z0-9]{0,63}$`, so the "same functions, two adapters" fallback cannot share names as written. Use camelCase. Also: the HTTP fallback needs an HTTPS URL per tool, cannot template optional arguments individually, and is unavailable with a custom LLM — so `TOOL_TRANSPORT=http` and `LLM_ROUTE=proxy` cannot be combined.
3. **Section 6.1, ASR.** "Pick the best vendor and use Agora's keywords feature" is not possible as stated: `asr.keywords` is ARES-only and the request fails with any other vendor. Each other vendor has its own mechanism (`keyterm`, `phrase_list`) and now requires `asr.params`.
4. **Section 6.3, spoken style vs Murf.** Murf wants digits and currency symbols, Devanagari for Hindi words, and no transliteration. The prompt must say that. Money formatting in tool results should give the model a ready display string (`₹1,28,00,000`) so it never reformats numbers. Test how the chosen voice reads `₹1.28 crore` before allowing that form.
5. **Section 15, web toolkit.** It is published: `agora-agent-client-toolkit`. Use it; pair it with `agora-rtm`, not `agora-rtm-sdk`. The app must subscribe to the RTM channel itself.
6. **Section 5 and 15, three.** "One single three version" needs a pin at 0.186.1 because TalkingHead depends on `^0.186` while latest is 0.187.0.
7. **Section 5, HeadAudio wiring.** The reference example plays audio through TalkingHead; the plan keeps Agora playback. Both can work, never both at once. The bare `@met4citizen/headaudio` import is broken. `mpfb.glb` is 36.8 MB and absent from npm.
8. **Sections 6.2 and 15, credentials.** Token auth with App ID + certificate is enough; drop the two customer-credential variables unless raw Basic auth is wanted. The agent token must carry RTC and RTM privileges. Filler words are a top-level `filler_words` block. Add `interruption` and `turn_detection.config` to the join config; the plan's sketch omits both.
9. **Public URL.** `/mcp` must be reachable by Agora's cloud from the first voice test. The environment rules forbid installing a tunnel. This needs the owner's decision now, not at integration time.
10. **Section 8.3, handoff.** Stopping the agent is right (there is no mute, and it only ever hears the buyer). Add: a new unique `name` on every restart; no `greeting_message` on restart (otherwise the greeting replays) — speak the hand-back line with `say`/`think` instead; `farewell_config.graceful_enabled` so the handover line finishes before the agent leaves; and remember each running agent holds a Murf concurrency slot (limit 2 outside US-East).
11. **Sections 8.1 and 8.2, transcripts on the server.** The server never sees the conversation unless something sends it. Relay final transcript items from the buyer's browser over the existing WebSocket as they finalise, and as a cross-check call `GET …/history` just before every `leave` (it only works while the agent is running). Webhook event `103 agent history` is the third option and needs Agora console setup.
12. **Section 15, TypeScript.** "Current stable" is 7.0.2, which the lint toolchain does not accept. Pin 6.0.3.
13. **Section 15, MCP SDK.** There are now two SDK lines; choose v1 (`@modelcontextprotocol/sdk@1.32.2`) for client compatibility.
14. **Section 6.2, `idle_timeout`.** It counts from when the buyer leaves the channel, not from silence. For "buyer went quiet" use `parameters.silence_config`. Always call `leave` explicitly at call end.
15. **Section 6.1, turn-taking.** Semantic end-of-speech requires a single language from a short list that includes `en-IN`. A two-language ASR setting quietly drops to VAD. That is one more reason to start with ARES `en-IN`.
16. **Section 9, live commute lookups.** Nominatim (1 req/s, no autocomplete, identifying user agent, off-switch) and the OSRM demo (1 req/s, non-commercial, no uptime promise) are acceptable for a demo only when called from the server with a limiter and cache. `showCommute` for a custom place will take seconds, not the 100 ms tool budget: exempt it explicitly, set the MCP `timeout_ms` above its internal timeout, and rely on filler words.
17. **Section 10, texture compression.** TalkingHead's loader has no KTX2 support, so the avatar cannot use KTX2. For the property models, glTF-Transform's KTX2 commands depend on an external encoder binary (see Unverified); WebP plus Meshopt keeps the pipeline inside npm.
18. **Section 13, `node:sqlite`.** Works on the installed Node but logs an experimental warning; handle it deliberately.
19. **Section 12, Murf concurrency.** Two concurrent calls is the ceiling on the default endpoint. Fine for a demo; state it in the README so a second tester does not look like a bug.
20. **Section 19, links.** Murf Falcon page is now `https://murf.ai/api/docs/text-to-speech-models/falcon-2-1.md`. Add the web toolkit reference `https://docs.agora.io/en/api-reference/api-ref/conversational-ai/client-toolkit/web.md`, the server SDK reference `https://docs.agora.io/en/api-reference/api-ref/server-sdk/typescript.md`, and the REST pages for `update`, `think`, `speak`.

Confirmed as written in the plan: join endpoint path; `enable_tools` being mandatory and silent when missing; `streamable_http` as the only transport; the `allowed_tools` hang warning; the 32-tool limit; `data_channel: "rtm"` with `enable_metrics` / `enable_error_message`; Murf `vendor: "murf"`, model `FALCON`, sample rate 24000; `mpfb.glb` being CC0 and the other bundled avatars being non-commercial; `setMood` and the listed `playGesture` names; the Chrome muted-media-element workaround.

---

## Unverified

Nothing below could be settled from documentation. Each needs a live test or an owner check.

**Agora engine behaviour**
- Whether the engine sends `context.presence` at all when `llm.url` is OpenAI's, and what OpenAI does with the extra field. Section 5 assumes it is unusable.
- Whether MCP tool calls still execute when `llm.url` points at our proxy (with or without `vendor: "custom"`).
- Which MCP protocol revision Agora's client speaks; whether it sends `Mcp-Session-Id` or any agent/channel identifier; whether it opens a GET stream; the default MCP timeout.
- How an MCP `isError` result or JSON-RPC error is presented to the model.
- Whether underscores are accepted in MCP tool names, and how MCP tool names appear to the model (the `mcp` prefix is reserved, which may hint at internal prefixing).
- Rate limits on `update` and `think`; whether replacing `system_messages` mid-session has side effects on history.
- The agent's RTM user id (assumed `String(agent_rtc_uid)`; an `agent_rtm_uid` field appears in one REST example but not in the parameter list). Read it from the RTM event `publisher` instead of assuming.
- The exact `Authorization` form for token auth: docs show `agora token="<token>"`, the SDK sends `agora token=<token>` without quotes. Using the SDK avoids the question.
- Effect of `geofence: { area: "INDIA" }` or `Area.AP` on latency for a Bengaluru buyer.
- Agora's pricing page lists a per-minute engine fee with the first 300 minutes free; not read in full.

**Speech quality**
- Which ASR actually transcribes Indian English with Hindi words best; whether ARES keywords help Hindi-origin terms; whether Deepgram `language=multi` includes Hindi and accepts `keyterm`.
- How each shortlisted Murf voice sounds, their genders, how `en-IN` vs `hi-LATN` behaves for mixed text through Agora, and whether Agora forwards unlisted params such as `style` or `volume_offset` to Murf.
- Which OpenAI model and `params` to use. No model was evaluated; Agora's managed list names `gpt-4o-mini`, `gpt-4.1-mini`, `gpt-5-nano`, `gpt-5-mini`, which only shows those ids work through the engine.

**Avatar**
- The whole chain Agora remote track → `createMediaStreamSource` → HeadAudio in Chrome, including whether the muted `Audio` element is needed alongside Agora's own playback, and whether two audio paths drift.
- Vite 8 handling of `?url` imports for the worklet and model inside `node_modules`, and of TalkingHead's `new URL(..., import.meta.url)` under dependency pre-bundling. The `optimizeDeps.exclude` setting is a precaution.
- Whether `mpfb.glb` survives glTF-Transform optimisation with all ARKit and Oculus blend shapes intact, and its final size.
- Lip-sync quality on Hindi words.

**Tooling**
- `maplibre-gl` v5 → v6 API changes were not reviewed.
- TypeScript 7 with the rest of the toolchain was not explored beyond the typescript-eslint peer range.
- glTF-Transform's KTX2 path needing the external KTX-Software encoder is from memory, not re-read.
- `reply.hijack()` with the MCP transport and with SSE passthrough is standard Fastify, but neither snippet in this file was run.

**Maps**
- MapTiler's current satellite tileset id (`satellite-v4` vs `satellite-v2`) and style ids; whether the Free plan's terms permit this demo's audience.
- Whether ArcGIS Location Platform needs a card; OpenRouteService's free quotas; Geoapify's free plan including map tiles or satellite imagery.
- OpenFreeMap and Overpass usage limits were not read.
