# effects: I am changing X, what do I open?

A catalog, not a waterfall. Each row names the cards whose **If you change this** applies. When this file and a card disagree, fix the card.

## Inside the tree

| Changing | Open first | Then |
|---|---|---|
| a column on `companies`, `people`, `leads` | [[leads/company]], [[leads/person]], [[leads/lead]] | `packages/core/src/views.ts`, [[processes/import]], [[processes/migrate]] |
| which firms are no buyer (`decline_reason`, chains, a niche's screen rule) | [[leads/company]] | `packages/core/src/ingest/screen.ts`, [[platform/niche]], [[processes/import]], [[processes/pool-feed]] (`inPlay`) |
| how titles rank (`role_rank`) | [[leads/person]] | `packages/core/src/views.ts`, [[processes/compose]], [[processes/migrate]] |
| who may get marketing | [[leads/consent]] | [[leads/suppression]], [[platform/phone-worker]] |
| what counts as suppressed | [[leads/suppression]] | [[processes/inbox-sync]], [[processes/sms-tick]], `packages/channel-email/src/guards.ts` |
| a research stage or its spend | [[processes/pool-feed]] | [[research/enrichment]], [[research/contact-candidate]], [[research/verification]], [[research/lead-check]], [[platform/settings]] (`WREN_POOL_MODEL_STAGES`) |
| an `.email` file or a `{key}` | [[email/template]] | [[email/sequence]], [[processes/compose]] |
| a copy experiment, its settings or the bandit | [[email/experiment]] | [[processes/evolution]], [[processes/compose]], [[email/template]], `packages/experiments` |
| a sequence, arm or plan rule | [[email/sequence]] | [[platform/niche]], [[processes/compose]] |
| who sends, from which inbox | [[email/roster]] | [[email/send-policy]], [[processes/deploy]] (SSM roster), [[platform/loop-object]] (keys) |
| caps, windows, ramp | [[email/send-policy]] | [[processes/send-tick]], [[processes/compose]] |
| seed placement checks (plain + real, auth, verdict) | [[email/placement-check]] | [[email/roster]] (ramps), [[email/transport]], [[email/sender-pause]], the digest |
| spam score | [[email/spam-score]] | [[email/template]], the gates |
| message or enrollment states | [[email/message]], [[email/enrollment]] | `packages/channel-email/src/state.ts`, [[processes/send-tick]], every view in `packages/channel-email/src/views.ts` |
| a call booked on cal.com | [[email/call-booking]] | [[platform/phone-worker]], [[email/enrollment]], `packages/books/src/economics.ts`, `evolve/stats.ts` |
| how a call went, or its pre-call brief | [[email/call-booking]], [[email/call-brief]] | [[calendar/booking]] (mirror and view), [[platform/spine]] (`close`, `onboarding`), `packages/core/src/calls.ts`, `apps/portal/web/src/modules/calls` |
| what a reply means | [[email/thread-event]] | [[processes/inbox-sync]], [[platform/llm-client]] |
| kill switches | [[email/sender-pause]] | [[processes/send-tick]], [[platform/notifier]] |
| the wire (Gmail) | [[email/transport]] | [[processes/send-tick]], [[email/report]] |
| a platform's API shape or limits | [[content/platform]] | [[content/draft]], [[processes/content-loop]], `apps/worker/src/services.ts` |
| drafting, voice, slots | [[content/draft]] | [[content/idea]], [[content/content-metric]], [[content/playbook]], [[processes/content-loop]], [[content/draft-event]] |
| a draft's record: who wrote it, reject reasons, training export, pairs, backfill | [[content/draft-event]] | [[content/draft]], [[content/comment]], [[content/reddit-thread]], [[platform/records]] (JSONL export), `designs/2026-10-07-training-record.md` |
| comments, activity or followers on our own posts (Marketing → Inbox) | [[content/comment]], [[content/platform]] | `packages/content/src/social/`, `packages/content/src/restate/social.ts`, [[platform/records]], [[platform/loop-object]] |
| what a record lets a person or Claude edit (`edits`, `changes`, History, Undo, Ask Claude) | [[platform/edits]] | [[platform/records]], [[ledger/run]], `packages/ui/src/edits.tsx` |
| what a viewer keeps of a list (saved views, last view, columns) and his prefs | [[platform/saved-views]] | [[platform/records]], `packages/ui/src/list-bar.tsx` |
| media hosting | [[content/media]] | [[content/platform]], `deploy/terraform` |
| video editing: cuts, captions, looks (`wren video …`) | [[content/video-edit]] | `packages/studio/`, [[platform/settings]] (`studio.cuts`), `packages/research/src/sops/index.ts` (`askGemini`) |
| Meta ads | [[ads/ad-launch]] | [[processes/ads-launch-watch]], [[content/idea]] |
| what a firm's site publishes (phones, LinkedIn, socials) | [[research/contact-point]] | [[research/document]], [[sms/sms-contact]], `lead_sheet` |
| a firm's public team (one people search per firm) | [[research/team-search]] | [[leads/person]], [[processes/pool-feed]] |
| a signal collector, a signal kind, or how signals are dated | [[research/signal]] | `packages/research/src/signals/`, [[processes/pool-feed]], [[processes/migrate]] (`research_signals`), [[platform/records]] |
| SMS numbers, contacts, texts | the `sms/` cards | [[processes/sms-tick]], [[platform/phone-worker]] |
| the carrier | [[sms/sms-provider]] | [[sms/sms-event]], [[platform/phone-worker]], [[platform/settings]] (`WREN_SMS_*`) |
| a `WREN_*` key | [[platform/settings]] | [[platform/worker]] (SSM), [[processes/deploy]] |
| a niche or a new one | [[platform/niche]] | [[email/template]], [[email/sequence]], [[platform/offer]], [[processes/migrate]] (facts view), [[email/roster]] |
| an offer | [[platform/offer]] | the lander snapshot (below) |
| a client, its database or its settings block | [[clients/client]] | [[processes/reactivation-pass]], `apps/worker/src/services.ts` (key routing), [[processes/migrate]] (every client database) |
| the audit log, its seals or eras | [[platform/audit-log]] | [[processes/migrate]] (install), [[clients/client-login]] (who may write it), `packages/core/src/audit.ts` (the sealer) |
| a client's Postgres login or grants | [[clients/client-login]] | [[clients/client]], [[processes/migrate]], [[platform/audit-log]] |
| what we deliver: plan, timeline, deliverables, asks, results | [[clients/engagement]] | [[platform/offer]] (`plan`), the portal Worker routes, [[processes/migrate]] |
| client mail, the pulse, or when the operator is pinged | [[clients/engagement]] | [[processes/delivery-watch]], `apps/worker/src/services.ts` |
| CRM formats, import, scoring | [[reactivation/crm-contact]] | [[processes/reactivation-pass]] |
| recruiters, firm facts | [[reactivation/client-profile]] | [[reactivation/handoff]], compose (`packages/reactivation/src/compose.ts`) |
| forwarding, meetings, the bill | [[reactivation/handoff]] | [[platform/offer]] (`perUnit`), the portal (`packages/reactivation/src/portal/`) |
| a record type, a field kind, or a portal table | [[platform/records]] | [[processes/migrate]] (its view), [[reactivation/crm-contact]], the portal Worker routes (`packages/reactivation/src/portal/routes.ts`) |
| a bill, a vendor's rules, or how bills post | [[books/bill]], [[books/vendor]] | [[processes/books-import]], [[books/entry]], [[processes/migrate]] |
| unit economics: spend buckets, invoices, an engagement's end or source | [[books/entry]], [[clients/engagement]] | `packages/books/src/economics.ts`, [[processes/migrate]] |
| a keyword, the engine checks, or how proposals reach the site | [[search/keyword]], [[search/proposal]] | [[processes/search-loop]], [[processes/migrate]] |
| a Restate service name or handler | [[platform/restate-services]] | [[platform/loop-object]], [[platform/cli]], [[platform/phone-worker]], `docs/restate-operations.md` |
| the loop primitive | [[platform/loop-object]] | every scheduler |
| a table (any) | [[platform/db-schema]] | [[processes/migrate]], the table's card |
| the worker or its build | [[platform/worker]] | [[processes/deploy]] |
| CLI commands | [[platform/cli]] | `README.md`, `walkthrough/` |

## Outside the tree (what points in)

Nothing in this repo references these; they break silently.

| Consumer | Points at | Recorded on |
|---|---|---|
| `../lander` (`README.md:11`, `src/data/offers.json`, `PRODUCT.md`) | `packages/offers` via `pnpm offers:export`; `scripts/gates.sh:13` checks the snapshot | [[platform/offer]] |
| `../lander/functions/api/subscribe.ts`, `../lander/functions/prefs/` (`WREN_MARKETING_URL` in `wrangler.toml`, `EXPORT_TOKEN`) | `phone.wrenautomation.com/marketing/<handler>` → `Marketing`; the signup signature and the link key both derive from `WREN_SITE_EXPORT_TOKEN` | [[leads/consent]], [[platform/phone-worker]] |
| `../lander/functions/_shared/door.ts` (from `api/lead.ts`, `api/apply.ts`; Pages secret `WREN_DOOR_URL`) | `phone.wrenautomation.com/hooks/<token>` → `Spine/hook`; the payload is what `HOOK_PRESETS.site` reads (`packages/core/src/door.ts`), id `site:<table>:<row id>` | [[platform/spine]], [[sms/speed-run]] |
| `../lander/functions/v/[id].ts` (`VIDEOS_ORIGIN` in `wrangler.toml`) | `<VIDEOS_ORIGIN>/v/<id>.json` as `packages/video/src/publish.ts` writes it; the CloudFront domain from `deploy/terraform/videos.tf` | [[reactivation/demo-video]] |
| `../autobrowse/walkthrough/03-meta-app.md` | `walkthrough/02-meta-ads.md` (link) | [[ads/ad-launch]] |
| autobrowse's `sites` service (same Restate, on the box) | called by name from `packages/core/src/content/restate.ts:21`; Meta, LinkedIn, YouTube, X, TikTok, Instagram go through it | [[content/platform]] |
| autobrowse's `gmail` site, each seed's Gmail consent | `PlacementScheduler` reads `/gmail/v1/users/me/messages` as the seed (`restate/placement-scheduler.ts:72`) | [[email/placement-check]] |
| the channel readers `activity`/`audience` (O1-O4, each `channel-*` over autobrowse `sites`/`desk`) | `ContentChannel.activity?`/`audience?` in `packages/core/src/content/index.ts`; `SocialWatch` reads them | [[content/platform]] |
| Restate registrations | every service and handler name in `apps/worker/src/services.ts` | [[platform/restate-services]] |
| SSM `/wren/prod/env`, `/wren/prod/senders_config` | `deploy/prod.env`, `senders_config.toml` via `deploy/scripts/push-secrets.sh` | [[platform/settings]], [[email/roster]] |
| GitHub `production` environment | `deploy.yml` secrets (AWS, Restate, Cloudflare token) | [[processes/deploy]] |
| Telnyx portal | webhook URL on `phone.wrenautomation.com`, public key | [[platform/phone-worker]] |
| `../lander/functions/{book,booking,api/slots,api/book,api/booking}` (`WREN_CALENDAR_URL`, `BOOKING` in `wrangler.toml`, `EXPORT_TOKEN`) | `phone.wrenautomation.com/calendar/<handler>` → `Calendar`; `bookSig` and the manage token both derive from `WREN_SITE_EXPORT_TOKEN` | [[calendar/booking]], [[platform/phone-worker]] |
| cal.com webhook (Wren's account, beside the lander's) | `phone.wrenautomation.com/webhooks/calcom`, `CALCOM_WEBHOOK_SECRET` | [[email/call-booking]], [[platform/phone-worker]] |
| GCP project of the service account: Pub/Sub topic `gmail-push` (Gmail's push account may publish), push subscription `gmail-push-phone` | `GmailClient.watch` (`send/gmail.ts`) names the topic from the key's project; the subscription posts to `phone.wrenautomation.com/webhooks/gmail?token=` | [[processes/inbox-sync]], [[platform/phone-worker]] |
| Google Postmaster, Gmail domain-wide delegation | the service account in `WREN_GOOGLE_SERVICE_ACCOUNT` and `WREN_SEND_TRANSPORT` | [[email/transport]], [[email/postmaster-day]] |
| mailifier VPS (`deploy/prober`) | `WREN_VERIFIER` + `WREN_SMTP_PROBE_URL` and token | [[research/verification]] |
| `deploy/pixel` Cloudflare Worker | the open export read by `inbox/opens.ts` | [[email/open-event]] |
| `~/.local/bin/wren` on William's Mac | `bin/wren` | [[platform/cli]] |
| `walkthrough/demos/prod.sh` | CLI commands by name against prod | [[platform/cli]] |
| S3 `legacy/` and `wrenautomation/legacy-private` | the Python era's data; `scripts/import-legacy.sh` | [[ledger/import]] |
