# Health

Signals, not a gate. Package layers and package cycles are the repo's own gate.

| Signal | Count |
|---|---|
| File cycles | 16 |
| Flat folders (over 40 boxes) | 10 |
| Inferred exports | 2632 |
| Duplicated lines | 4549 (0.97%, 498 clones) |
| Unused exports | 317 |
| Unused types | 83 |
| Unused dependencies | 25 |

## File cycles

Each line is one set of files that import each other in a loop.

- `@wren/content/src/restate/desk-approvals.ts`, `@wren/content/src/restate/desk-context.ts`, `@wren/content/src/restate/desk-drafting.ts`, `@wren/content/src/restate/desk-edits.ts`, `@wren/content/src/restate/desk-formats.ts`, `@wren/content/src/restate/desk-swaps.ts`, `@wren/content/src/restate/desk.ts`, `@wren/content/src/restate/planner.ts`
- `@wren/outreach/src/restate/desk.ts`, `@wren/outreach/src/restate/discovery.ts`, `@wren/outreach/src/restate/index.ts`, `@wren/outreach/src/restate/paste.ts`
- `@wren/core/src/profiles-backfill.ts`, `@wren/core/src/profiles.ts`, `@wren/core/src/touches.ts`
- `@wren/outreach/src/comments.ts`, `@wren/outreach/src/discovery/threads.ts`, `@wren/outreach/src/passes.ts`
- `@wren/portal/web/src/modules/index.ts`, `@wren/portal/web/src/modules/settings/Guide.tsx`, `@wren/portal/web/src/modules/settings/index.ts`
- `@wren/ui/src/contrast.ts`, `@wren/ui/src/palette-brand.ts`, `@wren/ui/src/theme.tsx`
- `@wren/channel-reddit/src/content.ts`, `@wren/channel-reddit/src/thread.ts`
- `@wren/content/src/thumbs.ts`, `@wren/content/src/video.ts`
- `@wren/core/src/grants.ts`, `@wren/core/src/portal.ts`
- `@wren/core/src/ingest/google-maps.ts`, `@wren/core/src/ingest/sources.ts`
- `@wren/db/src/clients.ts`, `@wren/db/src/index.ts`
- `@wren/portal/web/src/modules/sites/detail.tsx`, `@wren/portal/web/src/modules/sites/split.tsx`
- `@wren/portal/web/src/modules/wren/index.ts`, `@wren/portal/web/src/modules/wren/workflows.tsx`
- `@wren/sites/src/forms.ts`, `@wren/sites/src/templates/parts.ts`
- `@wren/ui/src/charts/draw.tsx`, `@wren/ui/src/charts/index.tsx`
- `@wren/ui/src/run-graph.tsx`, `@wren/ui/src/run.tsx`

## Flat folders

| Folder | Boxes |
|---|---|
| `@wren/core` | 185 |
| `@wren/ui` | 104 |
| `@wren/portal/web/src/modules/marketing` | 68 |
| `@wren/cli` | 67 |
| `@wren/content` | 55 |
| `@wren/pipeline` | 51 |
| `@wren/portal/web/src` | 47 |
| `@wren/outreach` | 44 |
| `@wren/channel-sms` | 43 |
| `@wren/studio` | 42 |

## Most imported

| File | Imported by |
|---|---|
| `@wren/db/src/index.ts` | 653 |
| `@wren/ui/src/index.ts` | 272 |
| `@wren/portal/web/src/module.ts` | 146 |
| `@wren/core/src/clients/index.ts` | 144 |
| `@wren/core/src/content/index.ts` | 137 |
| `@wren/core/src/restate/index.ts` | 129 |
| `@wren/portal/web/src/api.ts` | 124 |
| `@wren/core/src/index.ts` | 121 |
| `@wren/core/src/records.ts` | 120 |
| `@wren/core/src/access.ts` | 107 |
| `@wren/portal/web/src/load.ts` | 91 |
| `@wren/llm/src/index.ts` | 89 |
| `@wren/core/src/records-serve.ts` | 85 |
| `@wren/core/src/executor.ts` | 81 |
| `@wren/core/src/portal.ts` | 81 |

## Most imports

| File | Imports |
|---|---|
| `@wren/ui/src/index.ts` | 79 |
| `@wren/portal/scripts/preview.ts` | 78 |
| `@wren/cli/src/main.ts` | 64 |
| `@wren/worker/src/services/deps.ts` | 47 |
| `@wren/worker/src/services/executor.ts` | 41 |
| `@wren/channel-sms/src/restate/index.ts` | 40 |
| `@wren/outreach/src/index.ts` | 40 |
| `@wren/content/src/index.ts` | 36 |
| `@wren/portal/web/src/modules/marketing/pages.ts` | 35 |
| `@wren/channel-sms/src/index.ts` | 34 |
| `@wren/content/src/social/records.ts` | 34 |
| `@wren/portal/web/src/App.tsx` | 34 |
| `@wren/ui/src/records-page.tsx` | 31 |
| `@wren/worker` | 31 |
| `@wren/studio/src/index.ts` | 30 |

## Inferred exports

No declared type: a weak interface.

| Package | Inferred | Exports |
|---|---|---|
| `@wren/core` | 577 | 2339 |
| `@wren/ui` | 283 | 704 |
| `@wren/content` | 209 | 632 |
| `@wren/channel-email` | 200 | 840 |
| `@wren/outreach` | 146 | 524 |
| `@wren/research` | 126 | 646 |
| `@wren/studio` | 102 | 358 |
| `@wren/channel-sms` | 100 | 338 |
| `@wren/learn` | 98 | 316 |
| `@wren/pipeline` | 98 | 404 |
| `@wren/notes` | 92 | 235 |
| `@wren/delivery` | 89 | 288 |
| `@wren/sites` | 86 | 250 |
| `@wren/books` | 70 | 180 |
| `@wren/reactivation` | 65 | 266 |
| `@wren/channel-search` | 44 | 105 |
| `@wren/payments` | 40 | 101 |
| `@wren/documents` | 39 | 120 |
| `@wren/voice` | 33 | 137 |
| `@wren/calendar` | 26 | 80 |
| `@wren/watch` | 25 | 44 |
| `@wren/connectors` | 14 | 31 |
| `@wren/auth` | 13 | 20 |
| `@wren/channel-meta` | 13 | 73 |
| `@wren/db` | 9 | 57 |
| `@wren/niches` | 9 | 27 |
| `@wren/channel-reddit` | 6 | 19 |
| `@wren/experiments` | 5 | 26 |
| `@wren/llm` | 5 | 44 |
| `@wren/config` | 4 | 14 |
| `@wren/offers` | 4 | 31 |
| `@wren/channel-youtube` | 2 | 7 |

## Largest clones

| Lines | One | Other |
|---|---|---|
| 27 | `packages/documents/src/console.ts:20-46` | `packages/payments/src/console.ts:25-51` |
| 26 | `packages/channel-email/src/send/policy.ts:87-112` | `packages/channel-email/src/send/policy.ts:128-153` |
| 23 | `packages/channel-email/src/access/console.ts:225-247` | `packages/content/src/connect/console.ts:210-231` |
| 23 | `packages/channel-meta/src/content.ts:19-41` | `packages/channel-meta/src/threads.ts:12-34` |
| 21 | `apps/portal/src/dictate.ts:22-42` | `packages/core/src/http.ts:9-29` |
| 21 | `packages/content/src/restate/auto-reply.ts:129-149` | `packages/content/src/restate/inbox-desk.ts:585-605` |
| 20 | `packages/channel-email/src/access/console.ts:317-336` | `packages/content/src/connect/console.ts:311-330` |
| 19 | `packages/calendar/src/console.ts:23-41` | `packages/channel-sms/src/restate/console.ts:17-35` |
| 19 | `packages/delivery/src/service.ts:38-56` | `packages/reactivation/src/portal/service.ts:20-38` |
| 19 | `packages/offers/src/catalog/operations.ts:49-67` | `packages/offers/src/catalog/recruiting.ts:25-43` |
| 19 | `packages/ui/src/edit-form.tsx:307-325` | `packages/ui/src/edit-form.tsx:341-359` |
| 18 | `packages/channel-sms/src/restate/console.ts:170-187` | `packages/content/src/restate/marketing-console.ts:452-469` |
| 18 | `packages/channel-sms/src/restate/console.ts:170-187` | `packages/documents/src/console.ts:469-486` |
| 18 | `packages/channel-sms/src/restate/console.ts:170-187` | `packages/payments/src/console.ts:485-502` |
| 18 | `packages/content/src/restate/video-desk.ts:489-506` | `packages/content/src/restate/video-desk.ts:542-559` |

## Unused, by package

From knip. Unused files are left out: they need the repo's entries in a knip config.

| Package | Exports | Types | Dependencies |
|---|---|---|---|
| `apps/auth` | 1 | 0 | 8 |
| `apps/cli` | 35 | 2 | 3 |
| `apps/portal` | 86 | 36 | 0 |
| `apps/worker` | 2 | 2 | 1 |
| `packages/books` | 0 | 0 | 1 |
| `packages/calendar` | 0 | 1 | 0 |
| `packages/channel-email` | 7 | 3 | 2 |
| `packages/channel-search` | 3 | 1 | 0 |
| `packages/channel-sms` | 2 | 0 | 0 |
| `packages/channel-tiktok` | 0 | 1 | 0 |
| `packages/connectors` | 0 | 1 | 0 |
| `packages/content` | 51 | 7 | 0 |
| `packages/core` | 12 | 3 | 0 |
| `packages/delivery` | 3 | 0 | 0 |
| `packages/niches` | 8 | 1 | 1 |
| `packages/notes` | 2 | 0 | 0 |
| `packages/outreach` | 7 | 0 | 0 |
| `packages/pipeline` | 8 | 3 | 0 |
| `packages/reactivation` | 10 | 0 | 1 |
| `packages/research` | 19 | 2 | 0 |
| `packages/studio` | 6 | 5 | 6 |
| `packages/ui` | 54 | 15 | 0 |
| `packages/voice` | 0 | 0 | 2 |
| `packages/watch` | 1 | 0 | 0 |

### Unused dependencies

- `@wren/experiments` in `apps/cli/package.json`
- `playwright` in `apps/cli/package.json`
- `playwright-core` in `apps/cli/package.json`
- `@restatedev/restate-sdk-tunnel` in `apps/worker/package.json`
- `@wrenautomation/falcon` in `packages/reactivation/package.json`
- `@wren/config` in `packages/voice/package.json`
- `@wren/llm` in `packages/voice/package.json`
- `@wrenautomation/falcon` in `packages/niches/package.json`
- `@simplewebauthn/browser` in `apps/auth/package.json`
- `@wren/auth` in `apps/auth/package.json`
- `@wren/channel-email` in `apps/auth/package.json`
- `@wren/config` in `apps/auth/package.json`
- `@wren/ui` in `apps/auth/package.json`
- `@wrenautomation/autobrowse` in `apps/auth/package.json`
- `react` in `apps/auth/package.json`
- `react-dom` in `apps/auth/package.json`
- `@wren/experiments` in `packages/channel-email/package.json`
- `@wrenautomation/weaver` in `packages/channel-email/package.json`
- `@remotion/cli` in `packages/studio/package.json`
- `@remotion/google-fonts` in `packages/studio/package.json`
- `@wren/research` in `packages/studio/package.json`
- `react` in `packages/studio/package.json`
- `react-dom` in `packages/studio/package.json`
- `remotion` in `packages/studio/package.json`
- `@wrenautomation/weaver` in `packages/books/package.json`
