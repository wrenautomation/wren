# Fetch ladder (2026-10-18)

Bead wa-59d. Idea from Context.dev's automatic anti-bot escalation. No hosted scraper
(Firecrawl, Context.dev, Apify): William's rule is free, self-hosted, vetted open source.

## Answer first

- One ladder, four rungs: `plain` → `impersonate` → `render` → `exit`. It lives in autobrowse
  (`src/reach/ladder.ts`), the one place that has browsers, stealth and egress exits.
- autobrowse serves it as `web GET /fetch?url=&from=`. Its own `web GET /read` climbs the same
  ladder in process (its `fetch` backend).
- wren's crawler keeps its own polite fetch as rung 1 (`PoliteFetcher`, on the box). On a block
  it hands the URL to `web GET /fetch` (through the ingress). wren keeps the per-domain memory.
- A fetch climbs only on a block signal. A 404 is an answer, not a block.
- Each stored document records the rung that answered, the block that made it climb and every
  rung it tried.

## Where it lives, and why

Two repos, no shared code. They meet over Restate only (`restateSites`, `ingressSites`).

| Choice | Result |
|---|---|
| Ladder in wren `packages/research/src/fetch/` | autobrowse `/read` cannot use it. Rungs 3 and 4 are autobrowse calls anyway. wren would grow its own TLS impersonation and stealth. |
| Ladder in autobrowse, every crawl fetch through it | All crawling moves to the Mac's line. A Mac that is off stops the pipeline. |
| **Ladder in autobrowse; wren's rung 1 stays local; wren holds the memory** | One ladder. Plain fetches stay on the box. Only blocked pages go to the Mac. wren owns what it stores. |

The third. autobrowse = capability (how to get a page past a block). wren = policy and record
(where to start, what it got).

## The ladder (autobrowse)

`climb(url, { from, max })` in `src/reach/ladder.ts`. Rungs are injected; tests use fakes.

| Rung | What | Where |
|---|---|---|
| `plain` | `fetch` with autobrowse's `UA` | sites worker (the Mac) |
| `impersonate` | Chrome TLS and HTTP/2 fingerprint and headers | same, through `impit` |
| `render` | full page in a stealth browser (patchright, `openSession`), profile `fetch` | the Mac's own line |
| `exit` | same, profile `fetch@exit` | the named exit `EGRESS_SITES` maps to `fetch@exit` |

Next rung after a block: `shell` → `render` (TLS cannot run JavaScript); anything else →
the next rung in order. After `exit`, stop. `exit` with no mapping for `fetch@exit` stops with
block `no-exit`. Map `fetch@exit` only: a `fetch` entry sends rung 3 out the exit too.

### Block signals (`blockOf`)

A page is blocked when one of these holds; a marker wins over a bare status.

| Block | Signal |
|---|---|
| `cloudflare` | `cf-chl-`, `cf_chl_opt`, `/cdn-cgi/challenge-platform/`, title `Just a moment...`, `Attention Required! \| Cloudflare` |
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
| `shell` | a JS shell (port of wren `looksLikeJsShell`, `packages/research/src/fetch/htmltext.ts:206`, cited) |
| `reset` | plain rung only: the connection reset or the TLS handshake failed (a WAF that drops non-browser TLS) |
| `unreachable` | DNS fails, refused, timeout: a dead host. Stop, do not climb |

Markers count only when the status is 400 or more, or the page's visible text is short
(under 1500 characters). A contact form with Turnstile on a real page is not a block.
`401` and `404`/`410` are answers.

### Render rung

- `openSession(profile, browserOptions)` with `fetch` or `fetch@exit`: the same launch, identity
  and egress as every autobrowse browser. Kept warm in the `SessionPark` under its profile key.
- One render at a time per profile (in-process queue). The Mac holds one browser per profile.
- No resource blocking: the page must look like a person's.
- After load, a challenge page gets up to 15 s to clear itself (Cloudflare's JS check and
  non-interactive Turnstile do). An interactive captcha stays a block. No solver here.
- The rung reaches the browser through a new optional `ApiLeg.render`
  (`(url, { profile }) => Promise<RenderedPage>`), wired in `src/app/services.ts`. An api leg
  that has no `render` stops at `impersonate` with block as found.

### Pacing and budget

- At least 2 s between two requests to one host, across rungs (in process).
- `web` gets a cap bucket `fetch`, 1500 a day, metered 1 per `/fetch` call. Over the cap the
  facade answers 429 and nothing runs. `/read` is not metered on it (it never was).

### Route

```
GET web /fetch?url=<http(s) url>&from=<plain|impersonate|render|exit>&max=<chars>
```

`from` defaults to `plain`. `max` cuts `html` (default 2 000 000, 10 000 to 5 000 000).

```ts
type Tier = "plain" | "impersonate" | "render" | "exit";
interface Fetched {
  url: string;            // asked
  finalUrl: string;       // after redirects
  status: number | null;  // the answering rung's HTTP status
  type: string | null;    // content-type
  html: string;           // the answering rung's body, cut to `max`; "" when none
  cut: number;            // characters cut
  tier: Tier;             // the rung that answered (the last one tried)
  block: string | null;   // null: a usable page; else the signal the last rung still hit
  tries: { tier: Tier; status: number | null; block: string | null; ms: number }[];
}
```

A block is data, never a thrown error. A bad request is a 400.

### `/read`

`READ_ORDER` stays `jina`, then `fetch`. The `fetch` backend becomes `climb`. A final block throws
inside the backend (`firstOf` keeps it in `tried`). `/read` takes `from` too. Its answer adds
`tier`.

### Library

`impit` (Apify, Apache-2.0), pinned `0.14.5`. Rust (reqwest with patched rustls) under N-API.
It sends Chrome's TLS and HTTP/2 fingerprint and header order, and has a `fetch`-shaped API.
Prebuilt for darwin-arm64 and linux. Crawlee's default HTTP client.

| Rejected | Why |
|---|---|
| `got-scraping` | Fakes headers and cipher order on Node's TLS only. The JA3/JA4 is still Node's. Apify itself moved to `impit`. |
| `curl-impersonate` bindings (`cuimp`, `node-libcurl` forks) | Small, few users, a native curl build to keep. |
| `tls-client` wrappers | A Go shared library behind FFI; unvetted wrappers. |

## The caller (wren)

### `LadderFetcher` (`packages/research/src/fetch/ladder.ts`)

A `Fetcher` decorator: `new LadderFetcher(inner, sites, memory)`. Robots stays on `inner`
(`robots.txt` passes through, as in `sharedPages`). For one URL:

1. Start rung = the domain's memory if fresh, else `plain`.
2. `plain`: `inner.get(url)`. A 403, 429 or 503 (an answer, or a `FetchError` with that status)
   is a block `status-<n>`. A page under 400 that `looksLikeJsShell` is block `shell`. No block:
   return it, tier `httpx`.
3. On a block, or a remembered rung above `plain`: call `web GET /fetch` with `from` (`shell` →
   `render`, else `impersonate`; or the remembered rung).
4. The ladder answered a page: return it with its tier. Learn the tier.
5. The ladder still blocked, over its cap (429 → `cap`) or not reachable (→ `offline`): return
   step 2's answer (or throw its `FetchError`), now carrying the block and every step.
   A remembered start that fails this way falls back to step 2.

Robots warn mode is unchanged: the crawler checks robots before it asks for a page, at any rung.
The per-host throttle in `PoliteFetcher` is unchanged; autobrowse paces its own rungs.

`FetchResponse` and `FetchError` gain optional `tier`, `block` and `steps`
(`{ tier, status, block }[]`).

### Memory (`fetch_tiers`, main database)

| Column | |
|---|---|
| `domain` | text, primary key: the hostname, lowercase, no leading `www.` |
| `tier` | the lowest rung that worked: `impersonate`, `render` or `exit` |
| `block` | the signal that made it climb |
| `learned_at` | when this tier was learned |

- A row older than 30 days is ignored (`FETCH_TIER_DAYS = 30`): the next fetch starts at `plain`
  and learns again. A success at the same tier does not move `learned_at`, or the memory never
  decays for a domain we fetch often.
- A higher rung worked: the row moves up. `plain` worked over a stale row: the row is deleted.
  `plain` with no row writes nothing (most domains never get a row).
- Main only: a domain is the same fact for every client.

### Documents

| Column | |
|---|---|
| `fetch_tier` | unchanged column. New values `impersonate`, `render`, `exit`. `httpx` = wren's own plain fetch. `browser` = the box render pass (unchanged) |
| `block_reason` | new, text: the block that made this fetch climb, or the one that stopped it |
| `fetch_steps` | new, jsonb: every rung tried, `[{ tier, status, block }]` |

The homepage tombstone keeps its status and adds `block_reason` and `fetch_steps`.
`sharedPages` also serves kept pages at the ladder's tiers (status 200, not a shell).

### Wiring

`makeEnrichment` gets `ladder?: SiteClient | null`: `ingressSites(..., { caller: "wren:crawl",
timeoutMs: 120_000 })` (the crawl runs inside a unit's `ctx.run`). None = today's crawl.
The box render pass (`Enrichment.render`, CDP) stays: it still renders shells the ladder could
not reach (Mac off).

## Not in this

- Captcha solving on the render rungs (autobrowse has `fp.captcha`). Add it when blocks show it pays.
- HTTP rungs through an exit (`impit` takes a proxy). The egress design said: add when a caller needs it.
- Memory for `/read` and studies. They start at `plain` each time.
- Buying an exit (4G modem, proxy): money, William's call. Today rung 4 stops with `no-exit`.

## Decision log

- Posture change, on purpose: `render.ts` said "rendering is capability, not evasion". Rungs 2 to 4
  pass for a browser. William asked for it (wa-59d). Robots warn mode stays.
- Memory in wren, ladder stateless: the ladder never knows who asks; wren stores the pages.
- `learned_at` never refreshes on the same tier: decay must happen even for busy domains.
- Shell skips `impersonate`: a different TLS fingerprint gets the same shell.
- Long transactions: an escalated page holds the crawl unit's transaction while the Mac renders
  (up to ~60 s). Accepted at today's volume (1057 shelled companies in prod; no recorded 403s).
