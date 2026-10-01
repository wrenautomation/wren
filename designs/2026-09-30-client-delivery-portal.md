# Client delivery portal (2026-09-30)

`app.wrenautomation.com` becomes every client's one door: the plan, the work log, the deliverables, and each service they bought. Its job is to kill buyer's remorse and churn. A client can always see what we did, what's next and what we need from them.

## What William asked

- A full client delivery portal on our domain ("portal.wrenautomation.com"?), with CI/CD, a database and per-user accounts.
- An easy way for whoever fulfils the work to post events and deliverables.
- Sign-in with email links, email + password, OAuth and SSO. The best UX for clients, and reusable by other systems.
- "app.wrenautomation.com could be the client portal and extend into the full suite of all services. Check me if I'm wrong."

## Verdicts

- **app. as the door to every service: yes.** It is already wired: Worker route, CI deploy, docs. One login and one bookmark per client. Every client gets Delivery; each service they bought adds its module (portal-product P1). Services they didn't buy don't show. `portal.` becomes an optional redirect to `app.`.
- **New repo: no.** The portal, client registry, per-client databases, Restate worker, kit and CI all live in wren. A new repo would copy all of that. The layers rule (lint enforced) keeps the monorepo clean. Other repos reuse sign-in over HTTP (JWKS/OIDC), not by importing code.
- **Sign-in: replace Cloudflare Access with our own service at `auth.wrenautomation.com`.** Access has no passwords and no magic links (codes only), shows Cloudflare's page, and charges per seat past 50.

## What exists vs what's new

| Area | Exists | New or extended |
|---|---|---|
| Edge | `apps/portal` Worker on `app.` + `demo.`: SPA assets, JSON-only POSTs, 16 KB body cap, demo edge cache (`apps/portal/src/worker.ts`) | `/api/<service>/<route>` for several services; our token check replaces Access |
| Look | `packages/ui`: `AppShell`, themes as data, Table, Drawer, StatStrip, Tabs, Tag, Empty, Loading | Timeline, deliverable card, plan (gantt), ask list, composer, file drop |
| Modules | `module.ts` contract; `reactivation` module | `delivery` module (every client); `ops` module (operators only) |
| API | `ReactivationPortal` Restate service; viewer, pick, read-only read, write (`packages/reactivation/src/portal/service.ts`) | Generic viewer/pick/read/write move to `@wren/core/clients`; new `DeliveryPortal` service |
| Who sees what | `clients.portal_emails`, `OPERATOR_EMAILS`, `wren clients set --portal-email` | `client_members` (user, role, notification prefs, invited, joined, last seen) replaces `portal_emails`; operator becomes a role |
| Identity | Access JWT check (`apps/portal/src/access.ts`); hand-rolled passkeys in KV for the phone (`apps/phone/src/passkeys.ts`) | `@wren/auth` + `apps/auth` (Better Auth), shared by portal, phone and later systems |
| Delivery data | none | schema `delivery`: engagements, milestones, updates, deliverables, asks, results, pulses |
| Plan templates | offers hold stages, client inputs, measures and guarantee as prose (`packages/offers`, `catalog/operations.ts`) | `offer.plan`: phases with weeks, deliverables and asks. Same shape as the pitch-page gantt (stage, from week, to week), so the weeks we promise are the weeks we show |
| Files | private S3 media bucket with signed GETs (`deploy/terraform/media.tf`, `packages/content/src/media.ts`) | private `files` bucket, `clients/<id>/` prefix, signed PUT and GET |
| Video | autobrowse `loom` site: upload returns a share link | deliverable kind `video` from a Loom link |
| Meetings | autobrowse `calcom` site, bookings API | check-in booking on Home; bookings as timeline events (later) |
| Client mail | channel-email `Transport` (Gmail API), `ReportScheduler` weekly mail, reactivation `forward.ts` | sign-in mail, "needs you" nudges, Friday digest, from a main-domain address, never a cold-sending domain |
| Operator pings | `Notifier` → Discord (`packages/core/src/notify.ts`) | client actions, stale alerts, low pulse |
| Loops | loop objects (`packages/core/src/restate/loop.ts`) | `DeliveryWatch/fleet` |
| Product events | runs ledger (`packages/core/src/runs.ts`), reactivation stages, handoffs (bookings are billed) | one update per product run; results fill themselves (meetings booked, fee meter R18) |
| CLI + skill | compiled `wren`, `.claude/skills/wren` | `wren delivery …`; skill learns it |
| DB + migrations | Drizzle, one migrations folder, CI migrates main + every client DB (`packages/db/src/migrate-cli.ts`); `books` already uses its own schema | schemas `auth` + `delivery` the same way; no CI change |
| CI/CD | `ci.yml` gates; `deploy.yml`: migrate, Lambda, Restate register, phone + portal Workers; AWS by OIDC; terraform | auth Lambda + function URL (terraform), auth Worker deploy step, files bucket, auth + OAuth secrets |
| Demo | `demo.` host, server-side mask, edge cache | delivery module shows a sample engagement, labeled as a sample |

## Sign-in

- **A1. Our own auth service on Better Auth** (1.7.7, MIT, TypeScript). Its Drizzle adapter wants drizzle-orm 0.45.2, which is what we pin. Users live in our Postgres, not a vendor's.
  - Not Clerk or WorkOS. Both are good, but custom domains and enterprise SSO are paid add-ons, the users live with them, and it's less to learn.
  - It becomes Wren's identity provider: one account across every Wren system.
- **A2. Methods.** Magic link, with a 6-digit code in the same email. Google. Microsoft. Email + password. Passkeys. Enterprise SSO (SAML/OIDC, `@better-auth/sso`) per client, once one asks. Two-factor optional.
- **A3. One account per email.** A verified email links every method to the same person.
- **A4. Invite-only.** There is no public sign-up. An operator, or a client's owner, invites an email. The invite signs them straight into that workspace.
- **A5. Where it runs.** On `auth.wrenautomation.com`, a Worker serves the sign-in pages (the kit, in the client's theme when the link names the client). It forwards `/api/auth/*` to an auth Lambda.
  - The Lambda already reaches Postgres, Gmail and our secrets. Password hashing is too heavy for a free-plan Worker's CPU limit.
  - The tables go in schema `auth` in the main database. The Lambda refuses calls that don't come through the Worker (edge secret).
- **A6. Reuse.** An app gets a short-lived signed token and checks it against `auth.wrenautomation.com/api/auth/jwks`. That's the same check `access.ts` does for Access today.
  - An app on another domain (a client's own domain, later) uses OIDC (`@better-auth/oauth-provider`).
  - The phone moves its passkeys onto it.
- **A7. Auth answers who; the registry answers what they see.** Memberships live in `client_members`, not in auth.
- **A8. Sign-in mail goes out through Gmail** (the existing transport) from `portal@wrenautomation.com`, a send-as alias on william@, so replies reach him.
  - The link opens a page with a button, so a corporate link scanner can't burn it. The code is the fallback.
- **A9. Sessions last 30 days**, extended on use. Operators can "view as" a client login, and every such view is logged.

## Delivery

- **D1. An engagement is one bought offer for one client**: the offer id, a start date, the plan and a status. A client can have several (reactivation plus an ops build).
- **D2. The plan comes from the offer** (`offer.plan`) and gets dates on start. Each milestone has planned dates, a done date and a state. A slip shows as a slip, with a reason.
- **D3. Updates are the timeline**: what we did, what's next, what we need. Each has an author, a milestone and a visibility (client or internal).
- **D4. Deliverables** are a file, link, Loom or doc, with versions. The client approves or asks for changes, and that's recorded.
- **D5. Asks** are what we need from the client, with a due date. The client answers or uploads in place. "Waiting on you" shows on Home and in the digest.
  - The Setup page from portal step 2 turns its missing items into asks.
- **D6. Results** are the offer's measures (hours saved a week, meetings booked, the fee meter), shown against the promise. Products fill them, or an operator does by hand.
- **D7. Home answers five things on open**: where we are (phase, % done, next date), what we did lately, what's next, what we need from you, and results so far.
  - Day 0 is a welcome: the dated plan, who's on it, the kickoff booking and the guarantee. That's the first 72 hours, when remorse peaks.
- **D8. Never silent.** `DeliveryWatch/fleet` pings the operator when:
  - a client has had no client-visible update in 3 business days
  - a milestone slips
  - an ask is overdue
  - a pulse is low
  - the client hasn't looked in 14 days
- **D9. Client mail.** "Needs you" and new deliverables go out right away, batched hourly. Everything else waits for the Friday digest. Each person picks their level.
- **D10. Pulse.** A one-tap weekly "how's it going" (1–5), in the digest and on Home. A 3 or lower pings the operator.
- **D11. Storage.** Schema `delivery` goes in the main database. It's the relationship, like the registry, and the operator board is one query. Files go in the private bucket under `clients/<id>/`. Both drop with the client.
- **D12. Truth.** Nothing auto-posted claims more than the data shows. The demo's sample says it's a sample. Internal notes never reach a client, and a test walks every route to check that, like the mask test.

## Fulfiller tools

- **In the portal.** Operators see every client. On the client's own pages they get a composer: post an update, add a deliverable, add an ask, mark a milestone done, record a result. Plus "view as client".
- **Ops board** (`/ops/clients`). Every client with their phase, last update age, open asks, next milestone, last seen, pulse and an at-risk flag.
- **CLI.** Every command takes `--engagement <id>` when a client has several, and `--by <email>` (an operator; defaults to the only one).
  - `wren --client <id> delivery start <offer> --on <date>`
  - `wren --client <id> delivery post "…" [--step s] [--internal]`
  - `wren --client <id> delivery deliver "<title>" --link|--loom|--doc <url> | --file <path> [--step s] [--replaces id]`
  - `wren --client <id> delivery ask "…" [--due <date>] [--step s]`
  - `wren --client <id> delivery done <step> [--on <date>] [--undo]`
  - `wren --client <id> delivery slip <step> --to <date> --reason "…"`
  - `wren --client <id> delivery result <key> <value> [--note "…"]`
  - `wren --client <id> delivery hide <update id>`
  - `wren --client <id> delivery status [--json]`
- **Skill.** "Tell <client> the SOPs are done, attach sops.pdf" becomes a post.
- **Products.** One summary update per run, never one per row. An operator can hide any update.

## Client screens

Home, Plan, Updates, Deliverables, Needs you and Results, then each bought service's module (Reactivation, …). Settings has three parts: people (an owner invites teammates), notifications and sign-in methods. Every screen works at 375px.

## Hosts

| Host | Role |
|---|---|
| `app.wrenautomation.com` | the portal, sign-in required |
| `auth.wrenautomation.com` | sign-in for every Wren system (new) |
| `demo.wrenautomation.com` | the demo, unchanged |
| `portal.wrenautomation.com` | optional redirect to `app.` |

## Build order (commit and push each)

0. Land portal-product step 2 first. Its uncommitted files (`api.ts`, portal `service.ts` and `routes.ts`, the ui kit) are the ones this build touches.
1. **Auth.** `@wren/auth` + `apps/auth`, schema `auth`, invite-only, magic link + code, Google, Microsoft, password, JWKS. Terraform + CI. The portal Worker checks our token and Access goes. `client_members` replaces `portal_emails`, and operator becomes a role.
2. **Delivery data + API.** Schema `delivery`, `offer.plan`, `DeliveryPortal`, the generic viewer moved into core, `/api/<service>/<route>`.
3. **Fulfiller tools.** `wren delivery`, the skill, the portal composer, the files bucket and uploads.
4. **Client screens.** Home, Plan, Updates, Deliverables, Needs you, Results, Settings.
5. **Mail + watch.** Sign-in mail, nudges, the Friday digest, `DeliveryWatch`, pulse, Discord pings.
6. **Products feed it.** Reactivation run summaries, results and the fee meter.
7. **Ops board**, passkeys, the phone on shared auth, the demo's sample engagement.

Later: enterprise SSO, OIDC for client domains, client custom domains, a billing page (invoices), comment threads.

## Setup chores (autobrowse can drive)

- A Google OAuth client (consent screen: name, logo, `auth.` redirect) and a Microsoft Entra app (any org plus personal accounts).
- The `portal@` send-as alias on william@.
- Cost: no new vendor. Workers, Lambda and S3 stay in free tiers or cents.

## Where to attack

1. **Auth is ours now.** Session theft, forged tokens, open redirects on `next=`, invite reuse. Allowlist redirect hosts, make invites single-use, rate-limit at the edge and in Better Auth, check passwords against known breaches, log sign-ins.
2. **Link scanners burn magic links** (Microsoft Safe Links opens every link). A button page plus the code fallback (A8). Test with an Outlook inbox.
3. **Internal notes reaching a client.** Visibility filters in one place, with a test that walks every route.
4. **Cross-client leaks.** Every read picks the client through the membership check. Test with two clients and one shared email.
5. **Alert fatigue.** If `DeliveryWatch` pings too often it gets ignored. Few rules, real thresholds, one message a day.
6. **Auto-post noise.** One summary per run; an operator can hide any update.
7. **One door, one blast radius.** A bad deploy hides every client's view. A module's error stays in its page, and rollback is `wrangler rollback` plus the previous Lambda version.
8. **Uploads.** Size cap, type allowlist, signed URLs that expire in minutes, nothing public.

## Decision log

- **2026-09-30** Researched what exists. The portal, kit, registry, per-client databases, CI and mail are already there. New: auth, delivery data, fulfiller tools, client screens, watch. Decided: `app.` is the door to every service, no new repo, and our own auth on Better Auth at `auth.` (Access can't do passwords or magic links). Delivery goes in the main database; its files go in S3.
- **2026-10-01** Step 1 built. `@wren/auth` (Better Auth 1.7, drizzle, schema `auth`; emailed code + link button, Google, Microsoft, password with breach check; EdDSA tokens, 15 min, aud `wren`; DB rate limit keyed on the edge's IP header). `apps/auth`: Worker on `auth.` (pages + `/api/auth/*` proxy, CORS on `token` for app. only) → Lambda `wren-prod-auth` by function URL, locked by an edge secret. `client_members` + `operators` replace `portal_emails` (migration 0032 copies every portal email in as an owner). The portal checks our token; Access was never set up, so nothing to remove. Known gap: Microsoft sign-up needs a verified-email claim; a Microsoft account with no claim is told to use a code.
- **2026-10-01** Step 1 tested on prod for real: a code emailed to william@, read from the inbox, signed in, operator token, and the portal answered. Step 2 built.
  - **Schema.** `delivery` (migration 0034) with six tables. Pulses wait for step 5.
  - **`offer.plan`.** Phases are given in weeks. On start they become dated milestones, and their asks open, due at the end of the phase's first week. `reactivation` and `ops-automation-build` have plans.
  - **Shared viewer.** The viewer, client pick and `me` now live in `@wren/core/portal`, shared with `ReactivationPortal`. The Worker routes `/api/<service>/<route>`.
  - **`DeliveryPortal`.** Clients answer asks and decide on deliverables. The rest is team-only.
  - **Refusals.** Another client's id returns "not found". Links must be https; Loom links must be on a Loom host. Files only from `clients/<id>/`.
  - **Visibility.** Internal and hidden updates are filtered in one place (`seenBy`). A test walks Home and the timeline as a client to check it.
  - **No idempotency key yet.** Like the other portal services, there's no Restate journal. A lost reply after commit can double a post. Add a key if that ever happens.
- **2026-10-01** Steps 3 and 4, first cut. `wren delivery` (above) and the `wren` skill's delivery section. The portal's `work` module ("Your project"): Home, Plan, Updates, Deliverables, Needs you, Results, every one at 375px. Operators get the composer in place on each page (post, deliver, ask, done, move a date, record a result, hide); clients approve or ask for changes and answer asks. "View as client" is a header switch: it sends `asClient`, and `seesInternal` in core drops internal and hidden updates for that view, so it shows exactly what the client sees. Still to do in these steps: Settings (people, notifications, sign-in methods) and the files bucket with uploads (both below).
- **2026-10-01** Settings, people part. `delivery/people`, `invite`, `remove`: any member reads the list, an owner or Wren changes it, a project always keeps an owner, and a removed person loses it at once (membership is checked on every call, not baked into the token). The demo lists nobody. Notifications wait for step 5. Sign-in methods need no screen: the sign-in page already offers code, Google, Microsoft and "set or reset my password".
- **2026-10-01** Files bucket and uploads; step 3 done. `deploy/terraform/files.tf`: private bucket, SSE, CORS for `app.` PUTs only, the worker role on `clients/*`. `delivery/upload` signs a PUT for one type from the list and the exact size (50 MB cap, 10 min); the browser sends the bytes straight to S3, so the Worker's 16 KB body cap never sees them. `delivery/file` signs a 10-minute GET, longer than the demo's 5-minute edge cache so a cached link never arrives dead. Deliverables take kind `file`; an answer takes text, a file, or both; `wren delivery deliver --file` uploads with the machine's AWS login. Checked on the real bucket: a PUT with another type or more bytes is refused, an unsigned GET is refused. The CSP allows `*.s3.us-east-1.amazonaws.com` for the PUT. Applied by target (bucket + policy only); `WREN_FILES_BUCKET` went into the SSM env, since targeting the Lambda would have pulled in unrelated roster drift. Open: a file uploaded and never attached stays (sweep against the rows if it piles up), and files drop with the client once a client delete exists.
- **2026-10-01** Step 5 built. `DeliveryWatch/fleet` (hourly, off until `wren delivery watch start`) does the mail and the pings in one pass; the demo is never mailed or pinged.
  - **Mail** goes from `portal@` (`WREN_PORTAL_FROM`, sent through `WREN_PORTAL_MAILBOX`). A new person gets one welcome naming who added them; an invite kicks a pass so it lands in seconds. New asks and deliverables go out in one message per person per pass. The Friday digest goes after 15:00 send-zone time: the week's updates, steps done, deliverables, what's next, open asks, results and five pulse links. Everyone on a project before this got no welcome (migration 0035 marks them told).
  - **Levels** (`delivery/mail`, Settings → Email from us): everything, Friday recap only, none. Each person sets their own; Wren can't set it for them.
  - **Pulse** (`delivery/pulse`, Home or a digest link `?pulse=N&e=ID`): one tap a week per person, changeable that week. Only the client's people rate; Wren's team sees the taps.
  - **Pings**, one notifier message per pass listing what's new: 3 business days with nothing new for the client, a step past due, an ask overdue, a pulse of 3 or lower, nobody signed in for 14 days (or nobody on their side at all). Each problem pings once, again after 7 days if still there, and clears when fixed (`delivery.pings`). A ping that fails to send is retried next pass.
  - **Open.** A mail that fails is retried next hour; a box down all Friday afternoon skips that digest. Per-person queries are fine at this size.
- **2026-10-01** Step 6 built. DeliveryWatch started on prod. Each reactivation pass feeds the client's active reactivation engagements (`feedDelivery`): contacts reached, replies and meetings booked as results, counted the way the Replies page counts so both show the same bill; the meetings note is the bill. A result is written only when it changes, so the audit log stays quiet. One timeline line a day ("Yesterday: 38 contacts reached, 2 replies"), only when something moved, which also keeps the quiet ping honest. A meeting marked in the portal feeds at once; a feed that fails never fails the pass. Job orders and fees stay manual: the client tells us. Open: a meeting marked by `wren crm book` while the client's loop is off waits for the next pass.
- **2026-10-01** Step 7, ops board. `/ops/clients` in the portal, operators only (a module flagged `team`: off the sidebar and unreachable outside team view, and `delivery/board` refuses anyone else). One row per running engagement, plus clients with nothing running: phase (first open step, steps done), next due date, last client-visible update, open asks, last seen, latest pulse within a week, and risks. The risks are DeliveryWatch's own `problems`, so the board and the pings agree. The demo isn't on it. At risk sorts first.
- **2026-10-01** Step 7, the demo's sample. `seedSample` (`packages/delivery/src/sample.ts`) gives the demo a reactivation project 23 days in: two steps done, sending under way, six updates, two approved deliverables that link to the demo's own People and Emails pages, every opening ask answered, one open, and results with the bill. Every work page on the demo heads it with a "Sample" note (D12). DeliveryWatch reseeds it when missing or a week old, so nothing on it runs late; `wren --client demo delivery sample` does it now. Refuses any client that isn't the demo.
