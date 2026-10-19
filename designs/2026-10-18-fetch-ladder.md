# Fetch ladder (2026-10-18)

Bead wa-59d. Idea from Context.dev's automatic anti-bot escalation. No hosted scraper
(Firecrawl, Context.dev, Apify): William's rule is free, self-hosted, vetted open source.

## Answer first

- The crawl's hot path is unchanged. A blocked page fails once, with today's retries, and no
  extra request. The crawl records why (`block_reason`).
- Only the batch render pass climbs. It takes blocked companies beside the JS shells. A blocked
  one gets one ladder call: `impersonate`, then `render` on the Mac's desk, then `exit` only when
  `EGRESS_SITES` names one (prod has none: a no-op seam).
- A per-domain memory (`fetch_tiers`) decides the next try. A domain that worked only at a render
  tier skips the plain fetch on later crawls and goes to the render pass. A domain where render
  failed too is `dead` for 30 days: no more tries.
- Each render pass caps its extra requests and logs the count in its stats.
- The ladder lives in autobrowse (`src/reach/ladder.ts`), served as `web GET /fetch`. `web GET
  /read` is not changed.

## Rescope, 2026-10-18

The first cut climbed inline, inside each crawl fetch. William: retry storms and slower runs.
Rules now:

1. Hot path unchanged. A block (403, 429, 503) fails once, as the current retry logic does. No
   extra request inside that fetch.
2. Record it: `block_reason` on the document, the domain in `fetch_tiers`.
3. Batch only. The render pass takes recorded blocks, at most once per domain per 30 days. The
   impersonated fetch is one try before the render, inside that pass.
4. Memory: a domain that worked only at a render tier goes straight to the render pass. Render
   failed too: `dead` for 30 days.
5. The `exit` rung runs only when `EGRESS_SITES` maps `fetch@exit`. Not a build focus.
6. `/read` stays as it was: the ladder adds latency to a failed read.

## Where it lives, and why

Two repos, no shared code; they meet over Restate. autobrowse has the browsers, stealth and
egress exits, so the ladder lives there: capability. wren keeps policy and record: which
companies to try, the memory, the documents.

## The ladder (autobrowse)

`climb(url, { from, max }, rungs)` in `src/reach/ladder.ts`. Rungs are injected; tests use fakes.

| Rung | What | Where |
|---|---|---|
| `plain` | `fetch` with autobrowse's `UA` | sites worker (the Mac) |
| `impersonate` | Chrome TLS and HTTP/2 fingerprint and headers, through `impit` | same |
| `render` | full page in a stealth browser (`openSession`), profile `fetch` | the Mac's own line |
| `exit` | same, profile `fetch@exit` | the exit `EGRESS_SITES` maps to `fetch@exit`; none = stop, `no-exit` |

Next rung after a block: `shell` → `render`; else the next in order; after `exit`, stop.

### Block signals (`blockOf`)

A marker wins over a bare status. Markers count only at status 400 or more, or when the visible
text is under 1500 characters. `401`, `404` and `410` are answers.

| Block | Signal |
|---|---|
| `cloudflare` | `cf-chl-`, `cf_chl_opt`, `/cdn-cgi/challenge-platform/`, `Just a moment...`, `Attention Required! \| Cloudflare` |
| `turnstile` | `challenges.cloudflare.com/turnstile` on a page with little text |
| `akamai` | 403 with `Reference #` and `Access Denied`, or `errors.edgesuite.net` |
| `datadome` | `captcha-delivery.com`, `datadome` |
| `perimeterx` | `px-captcha`, `_pxhd`, `Press & Hold` |
| `imperva` | `_Incapsula_Resource`, `Incapsula incident ID` |
| `sucuri` | `sucuri_cloudproxy_js`, `Sucuri WebSite Firewall` |
| `aws-waf` | `awswaf.com`, `aws-waf-token` |
| `vercel` | `Vercel Security Checkpoint` |
| `kasada` | `x-kpsdk` |
| `status-403`, `status-429`, `status-503` | that status, no marker |
| `shell` | a JS shell (port of wren `looksLikeJsShell`) |
| `reset` | plain rung only: connection reset or TLS handshake failed |
| `unreachable` | DNS, refused, timeout: a dead host; stop |

### Render rung

`openSession` on `fetch` / `fetch@exit`, kept in the `SessionPark`, one render at a time per
profile, no resource blocking. A challenge page gets up to 15 s to clear itself. An interactive
captcha stays a block. The rung reaches the browser through optional `ApiLeg.render`.

### Route

```
GET web /fetch?url=<http(s) url>&from=<plain|impersonate|render|exit>&max=<chars>
```

```ts
type Tier = "plain" | "impersonate" | "render" | "exit";
interface Fetched {
  url: string; finalUrl: string; status: number | null; type: string | null;
  html: string; cut: number;
  tier: Tier;            // the rung that answered (the last one tried)
  block: string | null;  // null: a usable page
  tries: { tier: Tier; status: number | null; block: string | null; ms: number }[];
}
```

A block is data, never a thrown error. Cap bucket `fetch`: 1500 calls a day. At least 2 s
between two requests to one host.

### Library

`impit` (Apify, Apache-2.0), pinned `0.14.5`: Rust under N-API, Chrome's TLS and HTTP/2
fingerprint and header order, a `fetch`-shaped API, prebuilt for darwin-arm64 and linux. Crawlee's
default HTTP client. Rejected: `got-scraping` (Node's own TLS, so the JA3/JA4 stays Node's; Apify
moved off it), `curl-impersonate` bindings (few users, a native curl build to keep), `tls-client`
wrappers (Go library behind FFI, unvetted).

## wren

### Crawl (hot path)

- Fetch as today: `PoliteFetcher`, same retries. No ladder call.
- The homepage tombstone gets `block_reason` from the refusal: `status-403`, `status-429`,
  `status-503`. No other change.
- Before a company's first fetch, read its domain's memory:
  - `dead` and fresh: no fetch. Tombstone, `block_reason` `dead`. Stats `dead_skipped`.
  - a render tier (`browser`, `impersonate`, `render`, `exit`) and fresh: no fetch. Tombstone,
    `block_reason` `remembered`. The render pass takes it. Stats `remembered_skipped`.
  - none or stale: fetch as today.

### Render pass (batch)

Targets: today's (a shell, no rendered document) plus companies with a blocked tombstone
(`block_reason` `status-*` or `remembered`) and no rendered document, whose domain is not `dead`.
A rendered document is one at `browser`, `impersonate`, `render` or `exit`.

- A shell: today's box renderer (CDP), unchanged.
- A blocked or remembered company: one `web GET /fetch` for the homepage, `from` = the
  remembered tier, else `impersonate`. The people pages then go at the tier that answered.
  Documents keep `fetch_tier` = the ladder's tier, `block_reason` = the block that sent it
  here, `fetch_steps` = the ladder's tries.
- After a company: a page came → learn its tier. Nothing came → `dead` for the domain, and a
  tombstone at the last tier tried with the final block, so the pass never selects it again.
- No `ladder` dep (no autobrowse): blocked companies wait; shells render as today.
- Cap: `ladderLimit` extra requests a run (default 40: each `/fetch` call is one). Past it the pass
  stops taking blocked companies. Stats: `ladder_requests`, `ladder_pages`, `ladder_dead`.

### Memory (`fetch_tiers`, main database)

`domain` (PK, lowercase hostname, no `www.`), `tier` (`browser`, `impersonate`, `render`, `exit`
or `dead`), `block` (the signal that sent it up), `learned_at`.

- A row older than 30 days (`FETCH_TIER_DAYS`) is ignored. `learned_at` moves only when the tier
  changes, so a busy domain still decays.
- Main only: a domain is the same fact for every client.

### Documents

| Column | |
|---|---|
| `fetch_tier` | new values `impersonate`, `render`, `exit` (from the ladder). `httpx` and `browser` unchanged |
| `block_reason` | text: the block that sent this company to the render pass, or the one that stopped it |
| `fetch_steps` | jsonb: the ladder's tries, `[{ tier, status, block }]`; null without the ladder |

`sharedPages` also serves kept pages at the ladder's tiers (status 200, not a shell).

## Not in this

- Marker detection on the crawl: the crawl sees the status only. The ladder names the WAF when
  the render pass tries. A 200 challenge page that is not a shell is stored as a page, as today.
- Captcha solving on the render rungs.
- HTTP rungs through an exit.
- `/read` and studies on the ladder.
- Buying an exit: money, William's call.

## Decision log

- Rescoped (above): inline climbing cut. The crawl pays nothing; the render pass pays a capped
  number of calls.
- Posture change, on purpose: rungs 2 to 4 pass for a browser (wa-59d). Robots warn mode stays.
- Memory in wren, ladder stateless: the ladder never knows who asks.
- `dead` is a memory tier, not a separate flag: one row, one decay rule.
- Shell skips `impersonate` inside the ladder: TLS cannot run JavaScript.
