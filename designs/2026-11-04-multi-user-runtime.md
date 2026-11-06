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

- Setup (changed 11-05, WA-1119): the one whose title is the page's `product` (Research → Birdwatch, Variants → Vireo), else the last used, else the first the relay lists. A pick holds for that product. A running chat holds its setup. A page can hand the chat a turn (`handToChat(setup, text)`): the panel opens on that setup and sends it. The picker shows when there are more.
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

## Decision 9: the agent's choices, links and progress in a chat (agreed 11-04, WA-1068)
William asked for three upgrades from a reel: options as buttons, a sent URL as a card, and a working line with commands folded.

How the agent offers choices:

| Option | For | Against |
|---|---|---|
| A. The SDK's own AskUserQuestion tool. It reaches the page through `canUseTool`; the pick goes back as `updatedInput.answers` | native: the model already knows when to ask; the answer is the tool result, so the turn continues with it; no parser | the tool must be in `tools` and out of `allow`, so it always asks |
| B. Parse the reply's markdown lists into buttons | no tool change | guesses which lists are choices; a click becomes a new turn, not an answer |
| C. A custom MCP tool with a choices schema | full control of the shape | custom code for what A does; one more server per setup |

Choice: A. Proven 11-04 on a Haiku turn: card, click, `"Q"="A"` in the result, the pick kept on reload (read back from the result text).

- The card: one question with one pick sends on the click. Otherwise the person picks, then Send. "Something else…" takes their own words. Skip denies.
- Links: each http(s) address in a turn shows as a card (site, path, new tab). Titles and images (an unfurl) wait: they need a relay endpoint that fetches only public addresses (a private-address guard such as `request-filtering-agent`).
- Steps: a run of tool calls is one folded line. It names the live step and its time ("Plan the run · 12s"). A click opens it; an ask opens it.

## Decision 10: steps append, as in the reel (agreed 11-04, WA-1069)
William: steps must append, not overwrite; the reel's chat is the bar. Decision 9's one folded line hid each step behind the next. The reel was watched frame by frame this time (the 11-04 build used its speech and text only).

What the reel shows, now built:
- Each named call is its own row, in order: a ring while live, then a green check. The title shimmers while live. A mono stat and the time sit on the right. A click opens the call and its output.
- Plain shell commands in a row fold into one "Ran 3 commands" block, closed by default, with the summed time. Open, it is a dark terminal: `$` in orange, the command, a dim stat on the right ("200", "2.1k words"), a block caret on the live line.
- While the turn runs, its foot shows a ring, what it does now ("Plan the run", "Thinking", "Waiting on you") and the turn time.
- A finished turn with steps ends on "Done · 24s" (or Stopped, Failed). The usage line then drops its time.
- Options: full-width rows with a number key (1–9 picks), the label and its note, an arrow. The pick fills ink. One pick sends and gives the keys back to the message box.
- Times come from each frame's own clock (`timestamp`), so a stored chat shows the same times on reload.

## Decision 11: rename, effort, mode, Fable and the status line (agreed 11-04, WA-1070)
William asked to rename chats, see and change the effort, set bypass as his default, use Fable, and see his terminal's status line in the chat.

Who may drop the permission prompts:

| Option | For | Against |
|---|---|---|
| A. The Mac's owner only (a Wren admin, or the local token) may pick bypass, at launch (`?mode=`) or mid-chat (`set_permission_mode`) | William gets his terminal's mode; every other person keeps the prompts | the owner check must come from the sign-in, never the address |
| B. A fixed mode per setup (`mode: bypassPermissions` in setups.ts) | no new check | every person on that setup runs unprompted |
| C. Widen each setup's allow list (`Bash(*)`) | no new mode | the same as B for everyone, and the asks for other tools go too |

Ranked by risk, then result. Choice: A. Tested 11-04 with stream-json and `--permission-prompt-tool stdio`: under bypass, `touch` runs with no ask, and AskUserQuestion still reaches the page, so the choices card keeps working.

- Owner: `pageGrant` returns `{who, owner}`. Owner is `local` (no Origin, the local token) or `delivery/me` with team role `admin`. The page shows the bypass option from the same role; the relay decides.
- Launch: `--permission-mode <mode>`; the owner also gets `--allow-dangerously-skip-permissions`, which the CLI needs before a mid-chat switch to bypass. A setup's own `mode` wins and gets no flag.
- Effort: `?effort=` (low, medium, high, xhigh, max) becomes `--effort`. Mid-chat, `apply_flag_settings` passes only when its settings hold exactly `effortLevel`, a level or null. The same request carries permissions, hooks and models, so any other key is refused (unit tested).
- Picks: model, effort and mode are menus in the box's foot (`AgentPick`). Effort and mode stay on the device; the owner's mode starts on bypass.
- Status line: model, effort, context used/window (%), 5h %, 7d %, as `~/.claude/statusline-command.sh` shows it. It comes from init, then `getContextUsage` and the SDK's `/usage` call after each turn. On an API key the 5h and 7d parts stay hidden. 80% reads amber, 95% red.
- Rename: `PATCH /s/<setup>/sessions/<id>` with `{title}`, the asker's own sessions only, through the SDK's `renameSession`. The title in the chat's head is the edit field.
- Fable: in the birdwatch setup's models (`claude --model fable` is valid).
- Relay changes take effect after the relay restarts.

## Decision 12: link previews (agreed 11-04, WA-1071)
A web address a person sends shows its image, icon, site, title and one line, as in Claude and ChatGPT.

| Option | Private-address guard | Ships | Against |
|---|---|---|---|
| A. Portal Worker `GET /api/unfurl` | Cloudflare refuses private addresses; we refuse IP literals and odd ports | on push | any signed-in person can call it: per-person cap |
| B. Relay on the Mac | ours: resolve, check, pin the IP (DNS rebinding) | after the relay restarts | the Mac's network is one bug away |
| C. Browser fetch | none needed | on push | CORS blocks most pages; CSP blocks their images |

Chosen: A. The guard comes free and it ships without a relay restart. The page's head is parsed with htmlparser2 (already locked at 12.0.0). HTML is capped at 512 KB, the image at 300 KB, the icon at 50 KB, 5 s in all. Images come back as `data:` URLs, so the portal CSP stays as it is and the viewer's browser never calls the site. Cached 1 h per address. The preview is display only: never in the turn the agent reads. Dev with writes off refuses it (it reaches out).

Files by path (same task). An image or video a turn names by path (absolute or `~/`) shows under it. Only the relay can read the Mac, so it answers `GET /s/<setup>/file?path=`: images and videos by the real file's extension (after links), 50 MB at most. The owner may preview any file of theirs; anyone else only their own uploads and the setup's folder (realpath inside one). The page reads the bytes over connect-src and shows a `blob:` URL; img-src and media-src now take `blob:`, which the video chip's first frame also needs. Needs the relay restarted.

## Decision 13: typed slash commands (11-04, WA-1076)
William asked for every slash command. The headless CLI already runs about 30, `/model`, `/effort`, `/clear`, `/context`, `/usage` and `/config` among them, and answers each as markdown. A typed command is a user turn, so it went around the relay's control checks: `/model` skipped the setup's model list, `/config` changed settings, and `/usage` showed the whole Mac's use.

| Option | Gate | Keeps | Against |
|---|---|---|---|
| A. The relay reads a user turn's leading `/name` | the relay, as for control requests | every CLI command, its own output | one more parse in the filter |
| B. The page maps commands to its pickers | none: a crafted client skips it | page look | not a gate |
| C. `--disable-slash-commands`, the page rebuilds each one | the relay | nothing native | `/compact` and `/context` rebuilt by hand |

Chosen: A. The owner runs every command, as in their terminal. Anyone else runs `compact`, `context`, `clear`, `rename`, `model`, `effort`, `recap` and the setup's skills. `/model` and `/effort` arguments get the same checks as the pickers, for the owner too. A refusal comes back as a turn, so the SDK's turn ends and the page shows why. The `/` menu (initialize's and `commands_changed`'s lists) carries only what that person may run.
- `get_settings` now passes, and its answer is cut to `applied`: the full answer holds env and hooks. Before this, the page's effort default never loaded.
- `/clear` starts a new session in the same child. The ledger records each session id, so a cleared chat stays the person's and can be resumed.
- The page follows: after `/model` or `/effort` the pickers show what the CLI applies; after `/clear` the thread empties and the chat id moves. A stored chat shows a command as typed (`/model sonnet`), never its tags.
- `wren agent serve --tape <dir>` writes each session's frames, both ways, for story fixtures. The auth frame is never taped.

## Decision 14: story parity by replayed tapes (11-04, WA-1076)
William: the story may look worse than the live page, never better. Part stories drifted. They showed features with hand data that the live page dropped or broke.

| Option | Drift caught | Cost | Against |
|---|---|---|---|
| A. The real page (`/research/ask`) over a fake relay that replays real tapes | code: none, it is the same code; data: re-record | fixtures in git, a recorder | tapes go stale when the CLI changes its frames |
| B. Hand fixtures, part stories | only what we thought to write | low | the old drift: the story looks better |
| C. Pixel compare against live | layout | a live session per run | rejected: no pixel compare |
| D. Record from the portal dev page | the same as A | none | rejected: the dev Worker can reach prod |

Chosen: A. The story "Revamp/Agent chat" (`pages-agent.stories.tsx`) runs the real page, SDK and thread fold. msw `ws.link` stands in for the relay.
- `packages/agent/scripts/record-tape.mjs` drives the relay as the page does: settings at init, context after each result, task output on a task, settings after `/model` and `/effort`. So a re-record is deterministic.
- `scrub-tape.mjs` makes a tape public: home paths, account, ids and emails go. It fails if any is left.
- The fake answers each control call by the next reply in the same turn. Turns replay at the recorded pace, each gap at most 400 ms. An approval waits for the page; Stop jumps to the recorded cut.
- Play tests assert each feature. A story fails when the page drops one.
- The first replay found 4 bugs the part stories hid: typed command answers never showed, the `/model` refusal named a model twice, "Load the a skill" while the input streamed, and a second click on Allow threw.
- Re-record when the CLI or SDK changes: `record-tape.mjs`, then `scrub-tape.mjs` into `mocks/data/agent/`.

## 11-05: chat polish (WA-1082)

- Terminal block: by day `#17161b` → `#3b3942`, a soft charcoal; at night `#070708` → `#121116`, still under the paper. It stays dark in both looks so commands read apart from words. Dim text `#b5b3ab`: 5.4:1 by day, 9:1 at night.
- Tighter chat: turns 32 → 24 px apart, steps 12 → 8 px, text line 1.6 → 1.55; paragraphs, lists and headings lose 2 px each. Streamdown's 4 px padding on each list item is gone.
- The panel opens and closes with motion (motion.dev). It stays mounted when closed, so the chat keeps its session. Its room grows from 0 as the card slides in 24 px on the ease (0.34 s), and the page gives way. It leaves on an accelerating curve (0.24 s), since an ease-out exit drops in one frame. On a phone the sheet slides up and down. Reduced motion: no animation.

## Decision 12: commands open as in Claude's history (11-05, WA-1092)
William: copy Claude's history view for commands and outputs more closely. The open "Ran N commands" block was a dark terminal of `$` lines; each output took a second click. Now each command shows its description, its stat and time, then one box: the command, a rule, the output (64 lines high, then it scrolls). An open block shows every output. Named steps keep their row; a click opens the call and output, as before. Stored chats carry the output too (`thread.ts` maps each tool_result).

## Decision 13: the `/` menu before the first turn (11-06, WA-1131)
William: the side chat had no `/` menu. A chat learned its commands only from its own session's init, so a new chat or a reload showed none.
- The relay keeps each setup's last full command list, from `commands_changed` and from any control answer that carries `commands`. A file in `~/.config/wren/agent-commands.json` keeps it across restarts.
- `GET /s/<setup>/commands` gives the list cut to what the asker may run, as the socket does. Before any session it gives `[]`.
- The page keeps the list per setup in localStorage, then asks the relay. The next session's list replaces both.
- William: the composer's note "Claude agent · <tools>" goes. The `/` menu shows the skills. The page's setup type drops `tools`; `/setups` still lists them.

## Decision 14: context meter, `/compact`, auto-compact (11-06, WA-1137)
William: show the context window in the chat, let him set auto-compact and run `/compact`, and keep a long chat whole.

What already worked: `/compact` passes through the relay to the CLI. The meter showed `16k/1M (2%)` after each turn.

What was missing, now built:
- A reopened chat lost every turn before its last compaction. The SDK's `getSessionMessages` (0.3.318) starts at the boundary and drops its numbers and the summary's flag.
- No sign that a compaction ran. Now a rule between turns reads "Compacted: 12k to 1.2k tokens", "Auto-compacted…" or "Compaction failed: <error>". While it runs, the step line reads "Compacting context". The summary turn stays hidden.
- No meter before a chat's first turn. Now each chat keeps its last meter.
- No auto-compact control. Now a click on the meter opens a menu: tokens used, where auto-compact fires, an "Auto-compact" check and "Compact now". The filter lets `autoCompactEnabled` through `apply_flag_settings`, beside the effort.

How the relay reads a compacted chat:

| Option | Gives | Against |
|---|---|---|
| A. Read the CLI's JSONL when it holds a `compact_boundary`; walk `parentUuid`, across each boundary by `logicalParentUuid` | every turn, boundary numbers, summary flag | ties to the CLI's file shape |
| B. The SDK reader only | stable API | turns before the boundary gone, no marker |
| C. The relay keeps its own copy of each frame | full control | a second store that can drift from the CLI's |

Chosen (session): A. A chat with no boundary still reads the SDK's way, so a change in the file shape hits only compacted chats. `packages/agent/src/transcript.ts`; drop it when the SDK reads across a boundary.

Session choices:
- The meter cache lives in localStorage per session (`agent-status:<session>`), without the plan limits.
- The auto-compact pick is per device, with the model and effort picks. Unset leaves the CLI's own setting.
- The menu sits on the meter, not in the `/` menu: the meter is where the number is.
- The story "Compacted" replays a scrubbed real Haiku chat (`mocks/data/agent/compacted.json`).

Run sessions (William, 11-06): a stopped run goes on in its own chat when it can, since that chat holds what the person said. A fresh chat starts from `brief <run>`. Birdwatch 0.46.1 skill text; engine log 11-06.
