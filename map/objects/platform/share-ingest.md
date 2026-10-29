---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-29 @ ef481a93
entity: apps/share/src/worker.ts:1
covers: ["@wren/share"]
stamp: 5232ec59
---

# share-ingest

share.wrenautomation.com: where autobrowse installs send scrubbed run traces and flow packs for the shared library (autobrowse designs/2026-10-24-shared-library.md). A Cloudflare Worker over the R2 bucket `autobrowse-share`, app `@wren/share` (`apps/share`).

## Why this shape

Uploads come from installs we do not run, so the public side only takes files into a private `inbox/` prefix, under a size cap and two rate caps: one per install id and one per IP, so a fresh id buys nothing. Nothing in `inbox/` is read by a model or a person: the second scrub (Presidio, on the desk) reads it through the admin routes and writes `kept/`. The admin may write only `kept/`, `flows/` and `gate/`. The admin bearer is compared by digest in constant time.

## Shape

- `PUT /v1/traces/<name>.zip` (8 MB, must start as a zip), `PUT /v1/flows/<name>.json` (1 MB, must parse), header `x-install`: the install's random UUID
- key `inbox/<day>/<install>/<kind>/<name>`
- `GET /admin/list?prefix=&cursor=`, `GET|PUT|DELETE /admin/object/<key>`: bearer `ADMIN_TOKEN`
- `GET /health`

Citations: `apps/share/src/worker.ts:44`, `apps/share/wrangler.toml`

## Connected to

- **joins:** autobrowse `src/share/` (the install side and the desk's second scrub)
- **looks-like-but-is-not:** [[platform/library]] (wren's own library); the screenshots bucket

## If you change this

- **Hits:** autobrowse `src/share/share.ts` and `fetch.ts` (routes, headers, caps)
- **Does not hit:** wren's database (R2 only)

## Surfaces

| Surface | Role |
|---|---|
| autobrowse installs | write `inbox/` |
| the desk's second scrub | reads `inbox/`, writes `kept/`, `flows/`, `gate/` |

## See

- Source: `apps/share/src/worker.ts`
- Design: autobrowse `designs/2026-10-24-shared-library.md`
