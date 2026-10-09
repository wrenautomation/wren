---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-09
entity: packages/content/src/client-reports/schema.ts:21
---

# client report

A client's Marketing numbers mailed to its members every Monday or 1st at 9:00, each against the period before; every run kept (designs/2026-10-09-client-reports.md). Tables `client_reports`, `client_report_sends` on main, migration 0223.

## Why this shape

The Overview's tiles, read through the same `stats` on the same views, so the mail never disagrees with the portal. Each recipient's numbers go through their own access (`reach`), so scoped people get only theirs. Mail is held behind `WREN_CLIENT_REPORTS_MAIL=on`; until then a run is kept and says so.

## Shape

- Catalog `packages/content/src/client-reports/tiles.ts` (no imports; the web reads it): ten tiles, `changeOf`, `shown`.
- `client_reports`: client, name, tiles, every week|month, zone, recipients (members, 10 at most), on, `next_at`. `client_report_sends`: report (cascade), from, to, closed, lines, `sent_to`, why.
- Store `packages/content/src/client-reports/store.ts`: `nextRunAt`, `periodOf` (a closed run ends at the midnight that started its day), `saveReport`, `runReport`, `reportText`.
- `ClientReport/<id>` (`packages/content/src/restate/reports.ts`): a self-scheduling chain; a save restarts it, an older chain's turn does nothing.
- MarketingConsole `reports`, `reportSave`, `reportDelete`, `reportRun` (`manage`). Run now reads the last 7 days or this month and mails nobody.

Citations: `packages/content/src/client-reports/store.ts:1`, `packages/content/src/restate/reports.ts:1`, `apps/portal/web/src/modules/marketing/reports.tsx:1`

## Connected to

- **owns:** `client_reports`, `client_report_sends`
- **reads:** the client's Marketing records (`marketing.post`, `link_day`, `ad_day`, `search_day`, `site_day`)
- **joins:** `client_members` by email (recipients)
- **looks-like-but-is-not:** Wren's Friday report (Wren's own numbers, to William)

## If you change this

- **Hits:** the Overview tiles (keep the catalog in step), the mail from portal@, Marketing → Reports.
- **Does not hit:** the spine: a run fires no trigger.

## Surfaces

| Surface | Role |
|---|---|
| Marketing → Reports | owners set up, run now, read past runs |
| mail from portal@ | each recipient's numbers, once mail is on |

## See

- Source: `packages/content/src/client-reports/store.ts`
