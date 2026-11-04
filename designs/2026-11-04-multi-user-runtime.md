# Multi-user runtime and the Claude connection (2026-11-04)

## Target
Each client's work runs in its own container, placed by Restate. Each client's Claude use runs on that client's own plan or key, one to one. Wren pays for no client's Claude use and holds no client Claude token.

## Decision 1: where workers run (agreed 11-04)

| Option | For | Against |
|---|---|---|
| A. Kubernetes (EKS or k3s) | standard, portable, scales far | most ops; EKS ~$73/mo before nodes |
| B. Fargate tasks started by Restate | no cluster; already on AWS; pay per job | AWS lock; cold start; no GPU |
| C. Docker on a few VPS, Restate places jobs | cheapest; self-hosted | we own failover and packing |
| D. microVM per client (E2B, open source) | strongest isolation | newer; more setup |

Ranked by risk, then $ cost, then result. Choice: no cluster before the first paying multi-user load. Now: each worker is a container image that takes the client id as input (autobrowse worker, birdwatch run, video render), with the Mac-only parts named. At first load: B or C; D where a client's agent runs. Kubernetes only at dozens of nodes and many service types.

## Facts: Claude plans and keys (checked 11-04)
- Terms: a product may not offer claude.ai login or route requests through Pro/Max credentials for its users. A host may run the unmodified Claude Code binary where each user signs in with their own plan through Anthropic's flow. Wren may not collect or store a user's claude.ai token (code.claude.com, legal-and-compliance).
- Agent SDK: third parties may not offer claude.ai login or rate limits for agents built on the SDK, unless Anthropic approves.
- Agent SDK and `claude -p` signed in with a plan count against the plan's limits. The separate SDK credit announced for 06-15 is paused (support.claude.com article 15036540). Max plans carry monthly API credits since 10-07; only an API key spends them.
- Credential order: cloud provider, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `apiKeyHelper`, `CLAUDE_CODE_OAUTH_TOKEN`, profiles, then the `/login` plan. In `-p` and the SDK, an API key in the env always wins. `--bare` never reads the plan login.
- Checked on the Mac 11-04: with those env vars removed, `claude -p` reports `apiKeySource: none` and `authMethod: claude.ai`. The shared model-keys file holds `ANTHROPIC_API_KEY`: a process started with it bills the API credit.
- Conductor runs its bundled or the system Claude Code binary on the machine's login. Its docs warn that `ANTHROPIC_API_KEY` in its env bills the API.

## Who may use what

| Who | Agent SDK | Unmodified Claude Code (hosted) |
|---|---|---|
| William | his plan, env scrubbed | his plan |
| A client | the client's own API key only | the client's own plan via `/login` in their sandbox, or their key |

## Decision 2: the agent in a wren UI (agreed 11-04, WA-1052)
William's bar: plan only with a guard against the API key; a skeleton for a client's plan or key; any wren UI, multi-turn; lean context; new setups (content publishing, autobrowse) without new code.

| Option | For | Against |
|---|---|---|
| A. Relay: a local WebSocket pipes the unmodified `claude` CLI's stream-json; the page runs the SDK's `./browser` `query()` | least code; the full SDK in the page (multi-turn, interrupt, `canUseTool`, resume); the host never parses turns | `./browser` is not in the README; its WebSocket transport is marked "for existing callers during the migration" to SSE |
| B. Host runs the node SDK `query()` and speaks our own JSON to the page | documented API only | we own a protocol, the permission relay and resume; more code that drifts from the SDK |
| C. Hosted terminal (ttyd) on `claude` | the user's own `/login`; the only path for a client's plan | a terminal, not our UI |
| D. Channels or Remote Control | Anthropic's own | research preview behind a dangerous flag; the UI is claude.ai, not ours |

Ranked by risk, then result, then $. Choice: A for William's plan and a client's key; C later for a client's plan (WA-1051 sandbox). D rejected.

Spike, 11-04 (CLI 2.1.318, SDK 0.3.318, Haiku): through the relay, the browser `query()` ran two turns, a `canUseTool` round trip on `touch`, and a resume that recalled the first session. Every init said `apiKeySource: none`.

Risk of A and the exit: if `./browser` drops WebSocket, the relay keeps the CLI protocol and the page gets a 100-line NDJSON client, or the host moves to B. The SDK version is pinned exactly.

How it holds:
- One setup = one record (data, not code): app, cwd, model, tools, skills, plugin dir, MCP config, allow rules, env names, credential, connection.
- The child env is a short base (PATH, HOME, ...) plus the setup's env names. Never the whole parent env: the wren CLI loads the repo's env file into it.
- `plan`: the three Anthropic token vars never reach the child; the init must say `apiKeySource: none`, else the relay ends the session. `key`: the client's key per session; the init must name `ANTHROPIC_API_KEY`. Never `--bare`: it skips the plan login.
- Lean: `--setting-sources ""` (none of William's skills, plugins, memory or bypass mode), `--strict-mcp-config`, claude.ai connectors and bundled skills off, `--exclude-dynamic-system-prompt-sections`, the setup's tools, its own skill through `--plugin-dir`. Spike: first turn 17.7k tokens down to 6.4k.
- The user's no-secret-print hook comes back per setup through `--settings`.
- The page may not widen a setup. The relay passes user turns, permission answers and a short control list (interrupt, a model from the setup's list, a permission mode other than bypass, status reads). It rewrites `initialize`: drops prompt, agents and SDK MCP servers, and sets the setup's skills. Any other control request gets an error answer.
- Who may connect: the socket is on 127.0.0.1, Origin must be the portal or localhost, and the first frame carries a local token (the browser SDK's `authMessage`).

### Built 11-04 (WA-1052)
- `packages/agent` (`@wren/agent`): setup records (`setups.ts`), `launch` (flags and child env), `inbound` (page frames), `credentialBreach` (init check), `relay`, `checkSession`. `wren agent serve|check|setups|token`; port 4748. Portal: `modules/agent/connect.ts` (`openSetup`, `turns`), CSP `ws://127.0.0.1:4748`.
- The birdwatch skill ships in `@wrenautomation/birdwatch` 0.36.1, and the package is a Claude Code plugin. A setup names the package; the relay loads it with `--plugin-dir` and links its `bin` CLIs onto the child's PATH.
- Live on William's plan (Sonnet, birdwatch setup):
  - Every init said `apiKeySource: none`.
  - Loaded: Bash, Read, Skill; skill `birdwatch:birdwatch`; no MCP.
  - First turn 5.8k tokens, against 17.7k with the CLI defaults.
  - `birdwatch sources` ran under the allow rule with no prompt.
  - Resume through `wren agent check --resume` recalled the prior session (the browser SDK resume was proven on the spike pipe).
  - The no-secret-print hook blocked a `cat` of an env-named file.
  - The browser `query()` ran two turns and a `canUseTool` round trip through the relay.
- Still listed: the CLI's built-in `doctor` and `plugin-authoring` and three `cc-plugin-*` plugins. The skills filter hides them from the model's list; no flag removes them.
- The pnpm root overrides drop the SDK's 300 MB native CLI binaries: the portal needs only `./browser`, and the relay runs the installed `claude`.
- API spend inside a plan session: birdwatch's own model calls (the Jev judge, `youtube-see`) read keys from its config and bill them, as before. Only Claude Code runs on the plan.
- Not built: the portal panel (a separate task, under the design-language artifact), the client `key` source from credvault (the skeleton takes the key from the relay's process), `terminal` (WA-1051).

## Decision 3: product segregation (agreed 11-04)
William: a menu, upsell and prescription framework sells utility products, so tools and services stay apart.

| Option | For | Against |
|---|---|---|
| A. Each setup names a portal app; access is the existing grants: `can(who, "run", {client, app})` | one access model; roles, scopes, `until`, `usesLeft` already built | none now |
| B. A policy engine (Cedar, OpenFGA) | rich rules (ABAC, ReBAC) | a second access model beside `@wren/core/access` |
| C. Per-user skill filters inside a setup | fine grain | prompt and cache vary per user; tests multiply |

Choice: A. Grants are RBAC with scoped attributes. A purchase is a grant on the app, an upsell is another grant, a trial is a grant with `until` or `usesLeft`. A prescription names setups and grants nothing. A setup's record fixes its skills, tools, MCP, env and model, never per user. A smaller offer is a smaller setup (`birdwatch-read` beside `birdwatch`). (11-04 later: `birdwatch-read` dropped; read versus write is a permission mode on one setup, not a second picker entry. WA-1066.) The catalog waits for the product-lines redesign (WA-1033).

## Decision 4: the chat UI in a page (agreed 11-04, WA-1053)
William: use a vetted chat UI library for the thread, its states and the stream, then style it to wren.

No library reads the Agent SDK's message stream. Every option keeps one adapter from SDK messages to the library's message shape. A library removes the UI work: scroll anchoring, streaming markdown, the composer, Stop, tool cards, approval cards, running and error states.

| Option | Holds the state | We write | Against |
|---|---|---|---|
| A. assistant-ui (MIT, 0.15, ~2.9M/week), `ExternalStoreRuntime` | running, cancel, composer, thread viewport, tool UI by name, approval controls | SDK → `ThreadMessageLike` adapter; tool and approval parts in wren CSS | 0.x: pin exact; its own primitives beside our shadcn parts |
| B. AI SDK `useChat` + a custom `ChatTransport` + shadcn AI patterns | messages, status, stop, tool part states | SDK → `UIMessageChunk` transport | its turn model ends a turn at an approval; Claude Code waits inside the turn (`canUseTool`), so every approval bridges two turns |
| C. shadcn AI patterns only (copy-in, `base`, the portal's `base-nova`) | none: Message Scroller, Tool, Confirmation, Reasoning are visuals | SDK → messages reducer, status, Stop, composer | the state the ask wants gone stays ours |
| D. CopilotKit + AG-UI `@ag-ui/claude-agent-sdk` | all, through its runtime | little | runs the node SDK on a server: replaces Decision 2's relay; heavier; its look |

Ranked by result (states we never write), then risk, then $ (all free). Choice: A, with Streamdown (Apache-2.0, ~10.8M/week) for markdown that streams. The approval card is assistant-ui's tool UI with status `requires-action`, so `canUseTool` stays one turn.

Plan (WA-1053):
- Relay: `GET /setups` (title, models, tools; CORS for the origins). `GET /s/<setup>/sessions` and `/s/<setup>/sessions/<id>`: only sessions the relay started, per person (its own ledger), bodies from the SDK's `getSessionMessages`. `listSessions(dir)` alone would show every Claude session in that folder, William's and the runs session's too. `set_model` takes an alias or its full id. CSP: `http://127.0.0.1:4748`.
- `@wren/ui` `AgentThread`: assistant-ui primitives in design-language CSS (Parts, 14 Loading, 15 Inbox); `DraftTurns` sets the thread look. Parts: user turn, reply (Streamdown), thinking (folded), tool card (input, running, output, error), approval card (Allow once, Deny), turn foot (tokens, cost, time), error line per close code. Story per state, axe.
- Portal `modules/agent`: the adapter (SDK messages → thread messages; unit tests on fixture streams), the runtime hook (`openSetup`, interrupt, model, resume). No token entry (Decision 5).
- Page: Research → Ask birdwatch: past chats on the left, the thread on the right, model pick, New, Stop.
- Check: one live pass (serve, dev, two turns, a prompt, resume with history) from localhost:5173 and once from app.wrenautomation.com (Chrome's local network access rules may block a public origin), then the gate, push.

## Decision 5: who may open a setup (agreed 11-04, WA-1053)
Decision 3 says a grant decides. The relay must check it, not trust the page.

| Option | For | Against |
|---|---|---|
| A. The page sends its sign-in token; the relay asks the page's origin `POST /api/delivery/me` with it and checks `can(who, "run", {app})` | no new secret; one access model; grants read fresh; nothing to paste | one portal call per session (~150 ms); needs the portal up |
| B. The portal mints a short Ed25519 ticket after `can`; the relay checks it offline | no call per session | a new key in prod; a second token kind |
| C. Local token only (built 11-04) | no network | no person and no grant: anyone with the token opens every setup |
| D. The relay reads grants from Postgres | exact | database credentials on every relay host |

Choice: A. The relay asks only an origin on its allow list, so a page cannot point it elsewhere. On app.wrenautomation.com the token is the sign-in's (15 min); on localhost:5173 the dev Worker answers as `WREN_DEV_EMAIL`, on this Mac only. A client with no Origin (`wren agent check`) uses the local token. The target is `{app}` only: Wren's own workspace. A client setup adds `client` when one exists. `research` joins `APPS` so a grant can name it. B is the path for a relay with no route to the portal.

### Built 11-04 (WA-1053)
WA-1052's Built list said "the browser `query()` ran two turns". That ran in Node. In a real page the SDK's browser build failed at once: it reads `process.env`, `.argv` and `.platform` unguarded (0.3.318, latest). Fixed here; see the stub below.
- Relay: `GET /setups`, `GET /s/<setup>/sessions[/<id>]` (per person, from its ledger), `?model=` on the socket (one of the setup's models; else 4400). The CLI starts on the picked model, so no `set_model` runs on a new chat. Chat titles are the first prompt: the CLI's `summary` moves to the latest one.
- Decision 5 built: `pageGrant` in `apps/cli/src/agent.ts`. The ledger `who` is the token's email (better-auth JWT carries it); in dev it is the page host.
- `@wren/ui` `AgentThread` (assistant-ui 0.15.32 `useExternalStoreRuntime`, Streamdown 2.7.1). Turns rise in; a tool card's state cross-fades; the foot fades in; a chat switch dims the last chat and holds Send. Stories per state with play tests and axe, both looks.
- Portal `modules/agent`: `thread.ts` folds SDK frames to thread messages. Its tests run on fixtures cut from real relay captures: stream, ask and deny, Stop, stored history. `use-agent.ts` opens the socket on the first send; a stored chat loads through `useLoad` in a tab scope, so a return to it paints at once. The chat list is a `useCall` kept on the device; it reads again behind itself when a chat starts or a turn ends.
- `nodeStub()` in `connect.ts` sets an empty `process` before the SDK loads, only when none exists. Trade-off: a library that tests `typeof process` now sees one. The portal's own code has no such test. A patch per read would break on each SDK bump.
- The CLI echoes a mid-chat `/model` as a user frame (`<local-command-stdout>`); the fold drops it.
- Live from localhost:5173 (headless Chromium, Haiku, plan): two turns; an ask on `touch $TMPDIR/…` with Deny, which showed Denied; Stop mid-essay, which showed "Stopped"; New chat; reopen of the stored chat with its denied tool and stopped reply; resume and one more turn. Relay down: one sentence and Try again.
- Stored chats have no foot: the CLI stores no `result` frames.
- Not done: the try from app.wrenautomation.com (Chrome's local network access prompt), which waits on William's browser.

## Decision 6: the agent as a shell panel (agreed 11-04, WA-1066)
William: the chat is not a section. It is one panel in the shell, open on any page, for any LLM step (research, drafts, video edits). Research → Ask stays as the test bed.

| Option | For | Against |
|---|---|---|
| A. A docked column at the window's right, in `AppShell` (`aside` slot); the portal mounts it outside the page's keyed tree | the page stays usable beside it; the session lives across pages (the panel never unmounts); one place for every app | the page loses width while open; one `claude` child stays open while a chat is live (relay cap 3, a few hundred MB each) |
| B. A floating sheet over the page (support-widget style) | no layout change | covers the page it talks about; a second scroll layer; DESIGN.md's side sheet is for short tasks |
| C. Chat on its own page per app only (today) | none new | leaving the page ends the chat; no page context |
| D. A pop-out window | full width for both | two windows to manage; lost on a phone |

Ranked by result (the chat sees and keeps the page), then risk, then $. Choice: A. Under 900 px it is a full-screen sheet with Close. Opener: one quiet button (chat icon, ⌘J) that the shell draws in each frame (AppShell `agent`): the sidebar's foot, the folded column (in sight, not behind "…"), a phone's top bar. Not an "Ask AI" button on pages (DESIGN.md's rule stands for pages). The Ask page hides the opener: it is the same chat, full size.

- Setup: the one whose `app` is the open app, else the first the relay lists. The picker shows when there are more.
- Page context: each turn sent from a page carries one line, `[Page: <app> › <page> (<path>)]`. The composer shows it as a chip; Close on the chip drops it. A page may add a record or a selection later through `useAgentPage` (built, unused yet). The thread hides the line and shows the page as a small label on the turn.
- Open state and width on the device; the chat id per tab, so a reload reopens it.

## Decision 7: files in a chat (agreed 11-04, WA-1066)
Framework: assistant-ui's attachment adapter (composer chips, add, remove, paste, drop). The adapter routes each file:
- Images (PNG, JPEG, GIF, WebP) up to 3.75 MB and PDFs up to 10 MB: inline API content blocks (`image`, `document`, base64). The model sees them at once.
- Anything else, or larger (video, audio, CSV, docs): `POST /s/<setup>/files` on the relay (bearer, 500 MB cap). It lands in `~/.config/wren/agent-uploads/<person>/<id>/<name>`, never in a repo folder. The child gets `--add-dir` on that person's folder only. The turn names the path. The research setup reads video with `birdwatch watch`, PDF and HTML with `birdwatch text`, the rest with Read.
- A text block "Attached: <name>" goes beside each inline block (API blocks carry no file name), so a stored chat shows the names.

## Decision 8: a client's own key (agreed 11-04, WA-1065)
William: clients bring their own Anthropic API key, or their own Claude Code sign-in. He prefers a worker that hands out a short-lived credential over a private key on this Mac.

Terms limit the second: Wren may not hold or route a client's claude.ai sign-in. A client's plan runs only as the unmodified CLI with their own `/login`, in their own sandbox (WA-1051, `terminal`). So this decision is about API keys.

| Option | Key exposure | For | Against |
|---|---|---|---|
| A. Gateway: the child gets `ANTHROPIC_BASE_URL` = a wren route and `ANTHROPIC_AUTH_TOKEN` = a 15-min ticket bound to client and session. The gateway checks the ticket, takes the key through `vendorKey(db, client, "anthropic", {why, by})` (one ledger row), and streams the call on | none: the real key never leaves the server; a leaked ticket dies in 15 min and works for one client | an audit row and usage per call; works the same for a relay in a client's container | one more hop on every model call; a streaming route to run (Lambda function URL with response streaming, or the portal Worker) |
| B. A worker hands the decrypted key per session; the relay keeps it in memory and in the child env | the child holds the real key for the session; a prompt-injected `echo` can leak it | least code | the leak path above; audit per session, not per call |
| C. The keystore private key on this Mac (Keychain) | one master key on a laptop opens every client's key | no network | worst blast radius |
| D. A self-hosted LLM gateway (LiteLLM virtual keys: TTL, budgets, spend logs) | as A | framework, not custom code | a Python service and its own database to run; needs a security vetting pass before adoption |

Ranked by risk (key exposure), then $, then result. Choice: A, with D checked first as the framework for its proxy part; build A only if D fails the vetting. Not built: wren may be rebuilt (WA-1065 stays the record). To verify at build: what `apiKeySource` the init reports with `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL` set, since `credentialBreach` keys on it. Two prerequisites stand: the `anthropic` vendor needs a client-key mode (today `own: null`, Wren only), and the gateway, not the Mac, holds the keystore key.
