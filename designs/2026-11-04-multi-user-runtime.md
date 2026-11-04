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

## Decision 2: the agent in the birdwatch UI (open)
Options put to William 11-04. Logged here when he picks.
