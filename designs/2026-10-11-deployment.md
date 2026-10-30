# Deployment options

2026-10-11. William's temp note: "deployment options? especially for the api".

## Decision: keep the three homes

| Home | What | Why there |
|---|---|---|
| Lambda `wren-prod-worker` | every Restate handler, the portal's API (`ConsolePortal`) | bursty, $0 idle, a version per push, Restate drives it |
| The box (EC2) | Postgres, PgBouncer, Redis, Restate, browser, the long or always-on services | state and steady load; one box, no egress fees |
| Cloudflare | portal, phone, sign-in front, LLM gateway, lander, media | edge, free tier, TLS and CDN in one |

No ECS, Kubernetes, Fly or Vercel: none of them removes a problem we have. Move a service to
the box when it runs steadily or longer than 15 minutes; to Cloudflare when it is a thin edge
read.

## The API's one measured cost: cold starts

Last 24 hours: 6,752 calls, 56 cold (under 1%), Init 3.2 s average, p95 3.7 s; warm p50 9 ms.
Profiled locally: over half of the module load is V8 compiling the one 20 MB bundle; zod,
drizzle and the AWS SDK follow. Minifying saves 7% and costs readable stack traces: not done.

Done: the five SSM reads at cold start run at once, and "lambda ready" logs `initMs` (`ssm`,
`build`), so the rest of Init is module load.

Next levers, in order:

1. Split the bundle by service (lazy `import()` per service group): a portal call stops paying
   to compile the email and research code. The real fix.
2. More Lambda memory (more CPU, faster compile) or provisioned concurrency for the portal path:
   both cost money, William's call.
