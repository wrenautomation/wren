---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-11 @ 030b9ff5
entity: packages/core/src/cache.ts:13
---

# cache

The shared read cache: Valkey on the box (`WREN_CACHE_URL`), else memory per process. `@wren/core/cache`.

## Why this shape

Postgres is the truth; a key only saves a read (`designs/2026-10-11-cache.md`). Read-through with a TTL, and the write that changes the truth deletes the key. Never write-back, never a secret (it sits outside the key store's encryption). A failing cache is a miss, so Valkey down costs speed, not answers.

## Shape

- `Cache` (`cache.ts:13`): `get`, `set` with a TTL, `del`. Keys under `wren:v1:`
- `memoryCache` (`:26`, LRU, 2000 keys), `valkeyCache` (`:53`), `cacheFrom(url)` (`:70`)
- `readThrough` (`:89`): one load per key per process at a time, JSON, a failed load not kept; `invalidate` (`:121`)
- `respClient` (`resp.ts:28`): RESP2 over TLS, pins the cert's SHA-256 (`?fp=`), password sent after the pin matches
- Box: `deploy/scripts/box-valkey.sh` (64 MB, LRU, no disk, one ACL login: GET SET DEL PING on `wren:*`), CI step in `deploy.yml`
- Setting `cacheUrl` (`packages/config/src/index.ts:45`)

Citations: `packages/core/src/cache.ts:13`

## Connected to

- **owned-by:** [[platform/worker]] (`services.ts:489`)
- **looks-like-but-is-not:** the portal Worker's `caches.default` (Cloudflare edge, per colo); per-process OAuth token maps (secrets, never here)

## If you change this

- **Hits:** `restateAdminGet` (`console.ts`, first user, `services.ts:2169`); the box's Valkey config; a change in what a key holds bumps `PREFIX`
- **Does not hit:** any truth: everything here can be thrown away

## Surfaces

| Surface | Role |
|---|---|
| Console admin reads (Restate services, OpenAPI) | read-through, 5 min |

## See

- Source: `packages/core/src/cache.ts`, `packages/core/src/resp.ts`, `designs/2026-10-11-cache.md`
