# Fewer portal Worker requests

2026-10-14. Cloudflare warned that `wren-portal` used 97% of the free plan's 100k requests a day.
On the free plan, requests past the cap fail, so the portal would go down for clients.

## What used them

Last 24 h: 116k requests. Restate's `sys_invocation` shows which calls:

- About 100k came from scans run against prod. B3's axe contrast scan (`scripts/contrast.ts --url https://app.wrenautomation.com`)
  walked every page in every look, at about 9 `prefs` calls a second. Earlier screenshot runs made the
  4k spikes on 10-11, 10-13 and 10-14.
- One normal page load makes about 10 API calls. `prefs` alone fires once per list bar and per customize
  panel (`packages/ui/src/list-bar.tsx`, `customize.tsx`, `App.tsx` favorites), each for one key.
- `run_worker_first = true` sends every static file (27 chunks in `dist/assets`) through the Worker.
- On 10-12 there was a steady ~490 requests an hour all night with no Restate calls behind them.
  We can't see the paths: the API token lacks zone analytics, and the Worker has no logs.

## Build

1. **No scans on prod.** `contrast.ts` and any shots or scan script refuse a prod host unless `--allow-prod` is passed.
   They run on the preview (`:8788`) or in CI.
2. **Static files skip the Worker.** `run_worker_first = ["/*", "!/assets/*"]`. Hashed files under `/assets/`
   get `cache-control: public, max-age=31536000, immutable`. Every other path still goes through the Worker,
   so host routing, `/o/*`, sign-in and the SPA fallback don't change.
3. **One prefs read per load.** The kit reads all prefs once at start, keeps them in memory, and serves
   `prefs([key])` from that copy. Writes update the copy and send one call. Same for `me`, `recordsTypes`
   and `savedViews`: one read per load, shared.
4. **One pulse instead of many timers.** `waiting.ts` (60 s), the Learn bell (120 s), Notes mentions and the
   counts merge into one call each minute, sent only while the tab is visible and the window is focused,
   plus once on return. Other timers (`workflows.tsx`, `editor.tsx` 2 s, `Domain.tsx`, `learn/item.tsx`)
   stop when hidden and when their job is done.
5. **Logs.** `[observability] enabled = true`, so the next spike shows its paths. Sampling was 0.1; 1 since 10-16 (wa-ovo) so every refused send is kept.

## Done when

- On the preview, count `/api/*` calls with Playwright: one page load and one idle visible minute,
  before and after. Write both numbers in the commit. Target: load ≤ 4 calls, idle minute ≤ 1, hidden tab 0.
- Asset requests on prod no longer show in `workersInvocationsAdaptive`.
- A day later, `wren-portal` requests stay under 20k/day.

## Not now

Paid Workers plan ($5/mo). Cheap, but only needed if real use passes 100k/day after this.
