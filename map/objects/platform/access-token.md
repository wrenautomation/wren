---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-09 @ 54861284
entity: packages/core/src/clients/schema.ts:351
---

# access-token

A person's token for AI tools over MCP (designs/2026-10-09-mcp.md). Table `access_tokens` in main; Restate service `Tokens`; the portal Worker's `POST /api/mcp`. Account > AI tools for a client login, Handlers > AI tools for the team.

## Why this shape

A token acts as its person and nothing more: the Worker reads who it is, then forwards each tool to the console route the portal itself uses, with that viewer. One guard for every door, so removing a person or a grant shrinks their tokens at once, and nothing an agent does is something the portal can't. Main keeps the SHA-256 only; the token shows once.

## Shape

- `access_tokens`: `id` uuid, `email`, `name`, `hash` (SHA-256 hex, unique), `prefix` (first 9 chars, to tell them apart), `client` (the pin; FK clients, cascade), `created_at`, `last_used_at` (written once a minute at most), `expires_at` (1 to 365 days, or null), `revoked_at`. At most 20 live per person (`TOKENS_MAX`).
- Token: `wren_` + 32 random bytes base64url (43 chars). `packages/core/src/tokens.ts`: `makeToken`, `listTokens`, `revokeToken`, `checkToken` (operator read fresh from `operators`).
- Console routes `tokens`, `tokenMake`, `tokenRevoke` (need `read`; the viewer's own email only). Made with a request client (a client's host, or a client's Account) it's pinned there; a pin needs membership or an operator.
- `Tokens/check {token}`: public on ingress (zod input), so only the Worker, holding the ingress token, reaches it.
- `/api/mcp` (`apps/portal/src/mcp.ts`): stateless Streamable HTTP, one JSON-RPC message per POST, no SSE. Tools `list_record_types`, `list_records` (50 max), `get_record`, `list_handlers` and `describe_handler` (team only), `call_handler` (`console/call`; an effect needs `confirm`). A guard's refusal is a tool result with `isError`. A bad token is 401 with `WWW-Authenticate: Bearer`. A pinned token goes as `{client, asClient: true}`; on a client's host, a token pinned elsewhere is refused. None on the demo.

Citations: `packages/core/src/clients/schema.ts:351`, `packages/core/src/tokens.ts:1`, `apps/portal/src/mcp.ts:1`, `apps/portal/web/src/modules/account/AiTools.tsx:1`

## Connected to

- **owns:** `access_tokens`
- **owned-by:** [[platform/restate-services]]
- **joins:** [[clients/client]] by `client` (cascade); [[clients/client-member]] decides a pin
- **looks-like-but-is-not:** the door's hook tokens ([[platform/spine]]); sign-in sessions (`@wren/auth`); webhook secrets ([[platform/webhook-subscription]])

## If you change this

- **Hits:** every AI tool holding a token: the `wren_` format, the tool names and their inputs are a contract. A route a tool forwards to changing shape changes what the model reads.
- **Does not hit:** portal sign-in; the console's own guards (the tokens only pass through them).

## Surfaces

| Surface | Role |
|---|---|
| Account > AI tools, Handlers > AI tools (`AiTools.tsx`) | list, make (shown once, lasts 30/90/365 days or until removed), remove, setup snippets for Claude Code and other clients |
| portal Worker `/api/mcp` | MCP for AI tools |
| worker (`apps/worker/src/services.ts`) | serves `Tokens` |
