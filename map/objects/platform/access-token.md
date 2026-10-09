---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-09 @ 54861284
entity: packages/core/src/clients/schema.ts:351
---

# access-token

A person's token for AI tools: the `wren` CLI and its skill (designs/2026-10-09-ai-tools.md). Table `access_tokens` in main; Restate service `Tokens`; the portal Worker's `/api/agent`. Account > AI tools for a client login, Handlers > AI tools for the team.

## Why this shape

A token acts as its person and nothing more: the Worker reads who it is, then forwards each tool to the console route the portal itself uses, with that viewer. One guard for every door, so removing a person or a grant shrinks their tokens at once, and nothing an agent does is something the portal can't. Main keeps the SHA-256 only; the token shows once.

## Shape

- `access_tokens`: `id` uuid, `email`, `name`, `hash` (SHA-256 hex, unique), `prefix` (first 9 chars, to tell them apart), `client` (the pin; FK clients, cascade), `created_at`, `last_used_at` (written once a minute at most), `expires_at` (1 to 365 days, or null), `revoked_at`. At most 20 live per person (`TOKENS_MAX`).
- Token: `wren_` + 32 random bytes base64url (43 chars). `packages/core/src/tokens.ts`: `makeToken`, `listTokens`, `revokeToken`, `checkToken` (operator read fresh from `operators`).
- Console routes `tokens`, `tokenMake`, `tokenRevoke` (need `read`; the viewer's own email only). Made with a request client (a client's host, or a client's Account) it's pinned there; a pin needs membership or an operator.
- `Tokens/check {token}`: public on ingress (zod input), so only the Worker, holding the ingress token, reaches it.
- `/api/agent` (`apps/portal/src/agent.ts`): plain HTTP. `GET /api/agent` lists the tools; `POST /api/agent/<tool>` with a JSON object runs one: `types`, `list` (50 max), `get`, `handlers` and `describe` (team only), `call` (`console/call`; an effect needs `confirm`). A guard's refusal keeps its status as `{error}`. A bad token is 401 with `WWW-Authenticate: Bearer`. A pinned token goes as `{client, asClient: true}`; on a client's host, a token pinned elsewhere is refused. None on the demo.
- `/agent/wren.mjs` and `/agent/SKILL.md` (`apps/portal/web/public/agent/`): the CLI (one file, no dependencies) and the skill an agent reads. `wren login` keeps the token in `~/.config/wren/agent.json` (0600).

Citations: `packages/core/src/clients/schema.ts:351`, `packages/core/src/tokens.ts:1`, `apps/portal/src/agent.ts:1`, `apps/portal/web/public/agent/wren.mjs:1`, `apps/portal/web/src/modules/account/AiTools.tsx:1`

## Connected to

- **owns:** `access_tokens`
- **owned-by:** [[platform/restate-services]]
- **joins:** [[clients/client]] by `client` (cascade); [[clients/client-member]] decides a pin
- **looks-like-but-is-not:** the door's hook tokens ([[platform/spine]]); sign-in sessions (`@wren/auth`); webhook secrets ([[platform/webhook-subscription]])

## If you change this

- **Hits:** every AI tool holding a token: the `wren_` format, the tool names, their inputs and the CLI's commands are a contract; an old `wren.mjs` keeps calling them. A route a tool forwards to changing shape changes what the model reads.
- **Does not hit:** portal sign-in; the console's own guards (the tokens only pass through them).

## Surfaces

| Surface | Role |
|---|---|
| Account > AI tools, Handlers > AI tools (`AiTools.tsx`) | list, make (shown once, lasts 30/90/365 days or until removed), remove, the two lines that install the skill and sign the CLI in |
| portal Worker `/api/agent`, `/agent/` | the tools over HTTP; the CLI and skill files |
| worker (`apps/worker/src/services.ts`) | serves `Tokens` |
