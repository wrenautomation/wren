---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-07 @ 56605488
entity: packages/sites/src/schema.ts:150
---

# page-split

An A/B split on a Sites page: the page's address (arm A) shared between it and up to four live pages of the same owner (B to E), by weight. Tables `site_splits`, `site_split_arms`; the call in page detail; "Make B the page" through a yes.

## Why this shape

Many landers per offer and per client need a fair test with a plain call. The arm is picked at the edge and kept by one cookie that holds only the arm, so each arm can still be cached. The math reuses `@wren/experiments` `pBest`, not its `flags` tables: those are Wren's only, have no owner, and their bandit moves the shares. Shipping copies B onto A as a version, so the winner goes live through the same yes as any copy change.

## Shape

- `site_splits`: `client` (null is Wren), `page` (A), `state` running|shipping|shipped|stopped, `goal` forms|books|won, `winner`, `ship_version`, `started_*`, `ended_*`. One live split per page (partial unique on running|shipping).
- `site_split_arms`: `(split, label)` key, `page` (unique per split), `weight` 1..100.
- `site_events.split` and `site_forms.split`: set only when the arm's page matches. Migration `0187_sites_splits`.
- `site_hops`: a client host's `/go/` clicks (`link`, `channel`, utm, `to`, `page`). Same migration. Wren's (no client) come from the lander's `clicks` log: SearchWatch reads `/api/export?table=clicks` each pass into it (`importLanderClicks`, `packages/sites/src/store.ts`; 0194 counts them and adds `owner_name`; 0196 adds it to pages, forms and entries).
- Call: `splitCall` (`packages/sites/src/split-call.ts:49`): Beta(1 + goals, 1 + visits - goals) per arm; under 100 visits on any arm it says "Too early"; 95% is "wins".
- Serve: `armToServe` (`split.ts:241`) behind `Sites/serve` with `arm`, `bot`, `roll`; the Worker's `page` (`apps/portal/src/sites.ts:270`) sets `wab`, keys the cache per arm, bots get A.
- `site_links` (0189): tracked `/go/` links, one per page and utm, made in Sites → Links (`packages/sites/src/links.ts`); `site_link_records` counts each one's clicks, visits, forms and bookings. QR codes from `packages/sites/src/qr.ts`.
- Retire an arm: after the split stops, `askRetire` (`store.ts`) sets `site_pages.retire_by`/`retire_at`; the yes (`approveRetire`, To approve id `retire:<id>` or the client's) retires it (410). Refused while a split runs and for A.
- Ship: `shipSplit` (`split.ts:199`) saves and asks; `settleShip` (`store.ts:249`) ships on the yes, runs again on the no.

Citations: `packages/sites/src/schema.ts:150`, `packages/sites/src/schema.ts:190`, `packages/sites/src/schema.ts:376`, `packages/sites/src/split.ts:104`, `packages/sites/src/split.ts:297`, `packages/sites/src/hops.ts:57`, `packages/sites/src/store.ts:731`, `apps/portal/src/sites.ts:312`

## Connected to

- **owns:** `site_splits`, `site_split_arms`, `site_hops`, `site_links`
- **owned-by:** `@wren/sites`
- **joins:** [[clients/client]] by `client` (approver); [[platform/hosted-form]] (forms counted per arm); `call_bookings` for won deals (Wren's pages only); [[leads/touch]] through the door's utm
- **looks-like-but-is-not:** `flags` / `flag_experiments` (Wren's lander bandit); Sites variants (copies with no traffic split)

## If you change this

- **Hits:** the Worker's edge cache keys for `/o/<slug>` (`?arm=`, `?bot=1`), the `wab` cookie of visitors mid-split, the kit's `data-split`, To approve (a ship is a waiting version), a client's approver checks.
- **Does not hit:** pages with no split (served and cached as before), hosted forms at `/o/f/<slug>`.

## Surfaces

| Surface | Role |
|---|---|
| Sites → Pages → a page → A/B split (`apps/portal/web/src/modules/sites/split.tsx`) | start, call, weights, stop, Make B the page |
| a client's Sites (`clientSites`) | its pages, splits, Approve and Decline by its approver |
| portal Worker `/o/<slug>`, `/go/*` on client hosts | arm and cookie; counted hop and 302 |
| Sites → Links (`apps/portal/web/src/modules/sites/links.tsx`) | make a tracked link, copy it and its QR, each link's numbers |
| Marketing → To approve (`retire:<id>`) | yes or no on taking a split's arm down |
| `wren sites scan` | live pages missing from the list (read only) |

## See

- Source: `packages/sites/src/split.ts`, `packages/sites/src/split-call.ts`, `packages/sites/src/hops.ts`, `packages/sites/src/scan.ts`
- Design: `designs/2026-10-07-sites.md` (Phase 2)
