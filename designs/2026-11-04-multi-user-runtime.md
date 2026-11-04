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
  - Resume recalled the prior session.
  - The browser `query()` ran two turns and a `canUseTool` round trip through the relay.
- Still listed: the CLI's built-in `doctor` and `plugin-authoring` and three `cc-plugin-*` plugins. The skills filter hides them from the model's list; no flag removes them.
- The pnpm root overrides drop the SDK's 300 MB native CLI binaries: the portal needs only `./browser`, and the relay runs the installed `claude`.
- Not built: the portal panel (a separate task, under the design-language artifact), the client `key` source from credvault (the skeleton takes the key from the relay's process), `terminal` (WA-1051).

## Decision 3: product segregation (agreed 11-04)
William: a menu, upsell and prescription framework sells utility products, so tools and services stay apart.

| Option | For | Against |
|---|---|---|
| A. Each setup names a portal app; access is the existing grants: `can(who, "run", {client, app})` | one access model; roles, scopes, `until`, `usesLeft` already built | none now |
| B. A policy engine (Cedar, OpenFGA) | rich rules (ABAC, ReBAC) | a second access model beside `@wren/core/access` |
| C. Per-user skill filters inside a setup | fine grain | prompt and cache vary per user; tests multiply |

Choice: A. Grants are RBAC with scoped attributes. A purchase is a grant on the app, an upsell is another grant, a trial is a grant with `until` or `usesLeft`. A prescription names setups and grants nothing. A setup's record fixes its skills, tools, MCP, env and model, never per user. A smaller offer is a smaller setup (`birdwatch-read` beside `birdwatch`). The catalog waits for the product-lines redesign (WA-1033).
