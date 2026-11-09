# Chromium in Lambda (WA-1244)

## Goal

No browser on the box. Every page render and slide paint runs in a Lambda that exists only while it works, inside the free tier.

## Today

- browserless (`wren-browser`) on the t4g.small, beside Postgres. Idle 161 MB; its cap is 1.8 GB on a 1.8 GB box with 500 MB free.
- Callers, both through `WREN_CDP_URL`: the research render step (`Renderer`: url → html, final url, status), used by CompanyEnrich on the box lane; the slide painter (`SlidePainter`: html, count → JPEGs + PDF), on the Lambda lane.
- Use: 0 browserless sessions in 21 days (its own metrics, 11-09).

## Free tier

400k GB-s a month, always free. Used: about 42k a month (worker 35k, turbo cache 7k, auth 0.5k; 11-01 to 11-09). A render at 2 GB for 5 s is 10 GB-s: about 35k free renders a month. Past that, about $0.00017 a render (x86_64).

## Options

| Option | How | For | Against |
|---|---|---|---|
| **A. Render Lambda (picked)** | `wren-prod-render`: `@sparticuz/chromium` + playwright-core, 2 GB, x86_64. Ops `read` (url → page) and `paint` (html, count → images, pdf). Box and worker invoke it | Both lanes; sized only for Chromium; box RAM freed; no idle cost | A new function; 6 MB response cap |
| B. Chromium in the worker Lambda | Worker launches `@sparticuz/chromium` itself | No new function | The box lane (CompanyEnrich) has no browser; +65 MB on every worker cold start; worker memory sized for Chromium |
| C. Keep browserless, cap at 600 MB | `--memory 600m` | No work | Box RAM still shared with Postgres; one browser for every caller |
| D. Browserbase | Hosted sessions | No ops | Paid, hosted (frameworks rule: self-hosted only) |

Ranked: no browser on the Postgres box, $0 in the free tier, both lanes served, fewest new parts. A holds all four. x86_64, not arm64: the npm package carries the x64 binary; arm64 needs a hosted pack.

## Shape

- `apps/render`: one handler. `read`: fresh context per URL, the caller's User-Agent, images/media/fonts blocked, 20 s page timeout, html gzipped in the response. `paint`: 1080 square viewport, JPEG per slide, one PDF. The response stays under 6 MB: a larger result fails with its size.
- Callers: `WREN_RENDERER=lambda` + `WREN_RENDER_FUNCTION`. `lambdaRenderer` (research) and `slidePainter({ lambda })` (starling) invoke it with the AWS SDK.
- Errors: a Lambda error or timeout is `RenderUnavailable` / `PaintUnavailable`, as today.
- Deploy: `deploy.sh` builds the zip, puts it in the box bucket, `update-function-code --s3-key`. Terraform holds the function, its role and logs, and the invoke grant for the worker role and the box role.
- Then: browserless leaves `user-data.sh` and the box after one week with renders that work.

## Decision log

- 2026-11-09: A, a render Lambda both lanes invoke ("Options"), not Chromium in the worker, a capped browserless or Browserbase. Ranked: no browser on the Postgres box, $0 in the free tier, both lanes, fewest parts. William: "as long as it reasonably fits in our free plan, go for it."
