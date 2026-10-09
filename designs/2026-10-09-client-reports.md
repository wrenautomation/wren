# Client reports: the Marketing numbers, mailed on a schedule (2026-10-09)

## Answer first

An owner sets up a report on Marketing → Reports: a name, which numbers, weekly (Monday) or
monthly (the 1st), and who gets it. At 9:00 in the report's zone Wren reads the closed period
(last Monday to Sunday, or last month) against the one before and keeps it. Each recipient gets
it by mail from portal@, with the numbers their access reaches and a link to the portal. Every
run stays on the page, so a missed mail is never a missed report.

GHL's version is a custom dashboard with scheduled delivery. Ours is the Marketing Overview's
numbers. A custom dashboard can come later. The same numbers, read the same way
(`recordsStats`), so the mail and the Overview never disagree.

## Shape

| What | Where |
|---|---|
| The numbers a report can carry (the Overview's) | `packages/content/src/client-reports/tiles.ts` |
| Reports and their runs (main) | `client_reports`, `client_report_sends` (0223) |
| Save, list, run one period, the mail text | `packages/content/src/client-reports/store.ts` |
| `ClientReport/<id>`: wakes when due, runs, sleeps till the next | `packages/content/src/restate/reports.ts` |
| Portal: `reports`, `reportSave`, `reportDelete`, `reportRun` | MarketingConsole |
| Marketing → Reports | `apps/portal/web/src/modules/marketing/reports.tsx` |

- **Who:** `manage` at the client to see and change reports. Recipients are the workspace's
  members, ten at most. Each recipient's numbers are read through their own access (`reach`), so
  someone scoped to Texts gets the text numbers only.
- **Periods:** a stat read with `now` at the period's last instant: `period: 7` on Sunday 23:59
  is Monday to Sunday; `"month"` on the month's last day is the whole month. The prior is the
  same stretch before.
- **When:** next run is the next Monday (or 1st) at 9:00 in the report's zone (default the
  send zone, Toronto). A saved change restarts the chain; an old chain's turn does nothing, as
  ConnectorSync's.
- **Run now** reads the period so far (the last 7 days, or this month) and keeps it. It mails nobody.
- **Mail held:** `WREN_CLIENT_REPORTS_MAIL=on` sends. Off (the default while nothing goes
  out), each run is kept and says "Kept, mail is off".

## Not now

- Custom dashboards (any record, any view). The tiles table is the seam.
- Wren's own reports: the Friday report is Wren's.
- A PDF. The portal page is the full view.

## Log

- 10-09: Overview numbers only, members only, mail held behind a switch. My calls.
