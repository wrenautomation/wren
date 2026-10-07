---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-06 @ HEAD
entity: packages/content/src/media.ts:45
---

# media

A file a post carries: uploaded from the laptop into a private S3 bucket under its content hash, handed to platforms as a day-long signed URL.

## Why this shape

Graph, TikTok and the box take URLs, not bytes, and the worker has none of the laptop's files (`media.ts:1`). So `uploadMedia` (CLI) answers `s3://bucket/key`, which the draft carries, and `s3MediaHost` (worker) signs it at publish time. A local path the worker doesn't have stays a path: it is the desk's (a rendered video on the Mac), and the desk reads its own disk (`media.ts:73`).

## Shape

- `uploadMedia`, `putMedia` (bytes in hand), `s3MediaHost`, `parseStored` (`media.ts:45`, `:60`, `:39`); `Media` on ideas and drafts (`schema.ts:44`, `:67`)
- bucket from `WREN_MEDIA_BUCKET` in settings

Citations: `packages/content/src/media.ts:45`

## Connected to

- **owned-by:** [[content/idea]], [[content/draft]]
- **joins:** [[content/platform]] adapters needing `MediaHost`

## If you change this

- **Hits:** every URL-taking adapter (`channel-meta`, `channel-tiktok`, `channel-youtube`, `channel-x`), `wren content add --media`, the bucket policy in `deploy/terraform`
- **Does not hit:** text-only drafts

## Surfaces

| Surface | Role |
|---|---|
| `wren content add` | uploads |
| `ContentDesk.attach` (`attachFile`, `packages/content/src/attach.ts`) | stores a draft field's file: thumbnail, Reel cover, subtitles; magic bytes checked, 2 MB |
| `marketing.draft`/`approval`/`post` loads (`shapeView`) | sign a GET per stored field file |
| `Content.publish` | signs |

## See

- Source: `packages/content/src/media.ts`
