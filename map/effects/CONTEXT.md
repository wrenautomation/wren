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
| an email template (a store row, no file) or a `{key}` | [[email/template]] | [[email/sequence]], [[processes/compose]] |
| a sequence, arm or plan rule | [[email/sequence]] | [[platform/niche]], [[processes/compose]] |
| who sends, from which inbox | [[email/roster]] | [[email/send-policy]], [[processes/deploy]] (SSM roster), [[platform/loop-object]] (keys) |
| caps, windows, ramp | [[email/send-policy]] | [[processes/send-tick]], [[processes/compose]] |
| seed placement checks (plain + real, auth, verdict) | [[email/placement-check]] | [[email/roster]] (ramps), [[email/transport]], [[email/sender-pause]], the digest |
| spam score | [[email/spam-score]] | [[email/template]], the gates |
| message or enrollment states | [[email/message]], [[email/enrollment]] | `packages/channel-email/src/state.ts`, [[processes/send-tick]], every view in `packages/channel-email/src/views.ts` |
| a call booked on cal.com | [[email/call-booking]] | [[platform/phone-worker]], [[email/enrollment]], `packages/books/src/economics.ts` |
| a call's recording, its notes, or Record now | [[email/call-recording]] | [[email/call-booking]], [[leads/profile]] (timeline line), autobrowse `src/calls/` (outside the tree), `deploy/terraform/files.tf` (`calls/*`) |
| how a call went, or its pre-call brief | [[email/call-booking]], [[email/call-brief]] | [[calendar/booking]] (mirror and view), [[platform/executor]] (`close`, `onboarding`), `packages/core/src/calls.ts`, `apps/portal/web/src/modules/calls` |
| what a reply means | [[email/thread-event]] | [[processes/inbox-sync]], [[platform/llm-client]] |
| kill switches | [[email/sender-pause]] | [[processes/send-tick]], [[platform/notifier]] |
| the wire (Gmail) | [[email/transport]] | [[processes/send-tick]], [[email/report]] |
| a client's connected mailboxes, Google trust, Microsoft consent | [[email/mail-access]] | [[platform/account-setup]], [[watch/mail]] (the client reader), Account → Mail, `apps/portal/src/oauth-landing.ts` |
| a platform's API shape or limits | [[content/platform]] | [[content/draft]], [[processes/content-loop]], `apps/worker/src/services.ts` |
| drafting, voice, slots | [[content/draft]] | [[content/idea]], [[content/content-metric]], [[content/playbook]], [[processes/content-loop]], [[content/draft-event]] |
| a post's funnel stage, target or link; promo drafts; comment examples | [[content/funnel]] | [[content/draft]], [[content/video-edit]], [[content/comment]], [[content/draft-event]], `lander/src/data/links.json`, `designs/2026-10-07-content-funnel.md` |
| which model writes reach drafts, the A/B split, its scorecard | [[content/reach-post]] | [[content/draft-event]] (`meta.arm`), [[platform/llm-client]], `designs/2026-10-14-draft-models.md` |
| a draft's record: who wrote it, reject reasons, training export, pairs, backfill | [[content/draft-event]] | [[content/draft]], [[content/comment]], [[content/reddit-thread]], [[platform/records]] (JSONL export), `designs/2026-10-07-training-record.md` |
| a machine call (Jev, Laya, the gateway), a kind's mode, his calls beside it, the distill export | [[platform/decide]] | [[content/draft-event]], [[learn/item]], [[platform/llm-client]], [[platform/settings]], `designs/2026-10-16-decide.md` |
| comments, activity or followers on our own posts (Marketing → Inbox) | [[content/comment]], [[content/platform]] | `packages/content/src/social/`, `packages/content/src/restate/social.ts`, [[platform/records]], [[platform/loop-object]] |
| a post, comment or group's canonical ref, its aliases, a spelling rule (`canonRef`), or linking two spellings (`wren objects`) | [[content/platform-object]] | [[content/comment]], [[content/reach-post]], [[content/reddit-thread]], [[research/social-group]], [[content/draft-event]], `packages/channel-reddit/src/content.ts` (`commentRef`), `designs/2026-10-20-platform-objects.md` |
| what a record lets a person or Claude edit (`edits`, `changes`, History, Undo, Ask Claude) | [[platform/edits]] | [[platform/records]], [[ledger/run]], `packages/ui/src/edits.tsx` |
| what a viewer keeps of a list (saved views, last view, columns) and his prefs | [[platform/saved-views]] | [[platform/records]], `packages/ui/src/list-bar.tsx` |
| media hosting | [[content/media]] | [[content/platform]], `deploy/terraform` |
| video editing: cuts, captions, looks (`wren video …`) | [[content/video-edit]] | `packages/studio/`, [[platform/settings]] (`studio.cuts`), `@wrenautomation/falcon/video` (`askGemini`, `watch`, Cohere; `../falcon`) |
| Meta ads | [[ads/ad-launch]] | [[processes/ads-launch-watch]], [[content/idea]] |
| what a firm's site publishes (phones, LinkedIn, socials) | [[research/contact-point]] | [[research/document]], [[sms/sms-contact]], `lead_sheet` |
| a firm's public team (one people search per firm) | [[research/team-search]] | [[leads/person]], [[processes/pool-feed]] |
| a signal collector, a signal kind, or how signals are dated | [[research/signal]] | `packages/research/src/signals/`, [[processes/pool-feed]], [[processes/migrate]] (`research_signals`), [[platform/records]] |
| the fetch ladder, a document's tier, `block_reason` or steps, a domain's memory, the crawl's skips, the render pass's blocked companies | [[research/fetch-tier]], [[research/document]] | `packages/research/src/enrichment/render.ts` (`climbCompany`), `crawler.ts`, `sharedPages`, weaver `src/fetch/ladder.ts` (`fetchLadder`, `LADDER_TIERS`), autobrowse `src/reach/ladder.ts` (both outside the tree), `designs/2026-10-18-fetch-ladder.md` |
| SMS numbers, contacts, texts | the `sms/` cards | [[processes/sms-tick]], [[platform/phone-worker]] |
| missed-call text back (call events, the text back, replies) | [[sms/missed-call]] | [[sms/sms-event]], [[sms/speed-run]], [[platform/executor]] (`onlyLive`), `designs/2026-10-07-missed-call-and-reviews.md` |
| review requests (asks, the reminder, `/r/` links, feedback) | [[sms/review-ask]] | [[platform/phone-worker]], [[email/call-booking]] (outcomes enter it), [[platform/executor]] |
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
| a message's state, or what People → Sent shows | [[leads/sent-log]] | [[email/message]], [[email/email-click]], [[sms/sms-message]], [[content/comment]], [[processes/migrate]] (its views), `apps/portal/web/src/modules/people/sent.tsx` |
| email link clicks, the hourly click pull, or `?r=` / `hits.r` on the lander | [[email/email-click]] | [[leads/sent-log]] ("clicked"), [[email/message]] (`link_code`), `wren email clicks`, `../lander/functions/api/export.ts` (outside the tree, push there is deploy) |
| how one person's addresses tie together, what People → People, Timeline, Data show, or what "Research this person" finds and keeps | [[leads/profile]] | [[leads/profile-key]], every address writer (`noteProfile`), [[processes/migrate]] (its views), `apps/portal/web/src/modules/people/`, `ProfileResearch` ([[platform/restate-services]]), the Google and LinkedIn day budgets ([[processes/pool-feed]]) |
| who is warm, a person's stage or persona, or the warm gate before an opener | [[leads/people-map]] | [[leads/profile]], [[leads/segment]], `leadRefusal` (`packages/core/src/leads.ts`), email `sendDue` (`packages/channel-email/src/send/deliver.ts`), `apps/portal/web/src/modules/people/` |
| a record type, a field kind, or a portal table | [[platform/records]] | [[processes/migrate]] (its view), [[reactivation/crm-contact]], the portal Worker routes (`packages/reactivation/src/portal/routes.ts`) |
| the operator's API keys, the Accounts page's key rows, or `VaultKeys` | [[platform/vault-key]] | [[platform/vendors]] (`usageByKey`, `key_id`), [[platform/loop-object]], `wren accounts keys`, autobrowse `src/sites/keys.ts` (outside the tree) |
| a bill, a vendor's rules, or how bills post | [[books/bill]], [[books/vendor]] | [[processes/books-import]], [[books/entry]], [[processes/migrate]] |
| Wren's own invoices, how clients pay us, Wise credits or matching | [[clients/invoice]] | [[processes/billing-watch]], [[processes/delivery-watch]], `WISE_*` in `/wren/prod/env-2` (outside the tree), [[processes/migrate]] |
| unit economics: spend buckets, invoices, an engagement's end or source | [[books/entry]], [[clients/engagement]] | `packages/books/src/economics.ts`, [[processes/migrate]] |
| a keyword, the engine checks, or how proposals reach the site | [[search/keyword]], [[search/proposal]] | [[processes/search-loop]], [[processes/migrate]] |
| a Restate service name or handler | [[platform/restate-services]] | [[platform/loop-object]], [[platform/cli]], [[platform/phone-worker]], `docs/restate-operations.md` |
| the loop primitive | [[platform/loop-object]] | every scheduler |
| a board, a card, a column, the Timeline, or the CSV a board exports | [[platform/boards]] | [[platform/notes]] (a card is a note), [[platform/records]] (`notes.task`), `wren tasks`, `apps/portal/web/src/modules/notes/` |
| a table (any) | [[platform/db-schema]] | [[processes/migrate]], the table's card |
| the worker or its build | [[platform/worker]] | [[processes/deploy]] |
| CLI commands | [[platform/cli]] | `README.md`, `walkthrough/` |
| a hosted form's spec, consent words, serving or door payload | [[platform/hosted-form]] | [[platform/executor]] (`HOOK_PRESETS.site`), [[platform/webhook-subscription]] (`form.submitted`), embeds on client sites, `apps/portal/src/sites.ts` |
| pay links, Stripe's webhook or the `pay` text | [[platform/pay-link]] | [[sms/sms-message]], [[sms/sms-contact]], [[platform/vendors]], To approve in `packages/content/src/social/records.ts`, `apps/portal/src/pay.ts` |
| a shape's nodes, edges or Advance triggers; how a journey moves, skips, loops or drops; a version carry or ghost; the journeys board | [[platform/shape]], [[platform/journey]] | [[platform/executor]] (`ExecutorDeps.shapes`, `StepAt.fire`: a step can fire triggers once its result is kept; the shape workflow is generated per version, so a new version changes what runs; `trigger.journey` facts `{node, change, sale?}`, the `journey:` branch of `executions`), [[platform/webhook-subscription]] (`journey.moved`, `deal.won`), [[leads/segment]] (the `journey` rule reads `node` and `trail`; the editor reads `segmentContext.shape`), workflows naming a node id, `apps/portal/web/src/modules/deals`, `packages/pipeline/src/workflow.ts`, `apps/worker/src/services.ts`, `designs/2026-10-19-business-map.md` |
| a shape's draft, tag, blame, undo or git mirror (`shape_drafts`, `shape_tags`, `shape_mirrors`; `wren shape draft|blame|undo|tag|tags|mirror`; the console `shapeDraft*`, `shapeBlame`, `shapeUndo*`, `shapeTag`; the commit path and message) | [[platform/shape]] | [[platform/settings]] (`WREN_SHAPES_GITHUB_TOKEN`, `WREN_SHAPES_GITHUB_REPO`), [[content/blog-post]] (the shared `packages/core/src/github.ts`), `apps/portal/web/public/agent/SKILL.md`, `apps/portal/web/src/map/`, the private sops repo (outside the tree), `designs/2026-10-19-business-map.md` |
| a shape file (`wren shape import` and `export`): the nodes, edges, `moves` and `terms` it writes; `wren shape start` (the starter, only with no shape) | [[platform/shape]], [[platform/journey]], [[platform/terms]] | `packages/pipeline/src/shape-file.ts`, `packages/pipeline/src/starter.ts`, `packages/pipeline/src/starter.yaml`, a seed file with names and amounts lives in the private sops repo (never in this repo), `wren offers sync` must run first (by hand: the deploy no longer runs it) |
| a card's `entity:`, a row of this table, a component's `services` or `loops`, where tests live | [[platform/scorecard]] | `scripts/gates.sh` (`map` step prints the worst rows) |

## Outside the tree (what points in)

Nothing in this repo references these; they break silently.

| Consumer | Points at | Recorded on |
|---|---|---|
| the private sops repo (`wrenautomation/sops`, default of `WREN_SHAPES_GITHUB_REPO`) | `shapes/<workspace>.yaml`, one commit per shape version: `mirrorShapes` (`packages/pipeline/src/mirror.ts:43`) writes the file and the message `shape <workspace> v<n>: <note>`; William reads it with `git log` and `git blame`. The token (contents only) is `WREN_SHAPES_GITHUB_TOKEN` in prod's SSM env | [[platform/shape]] |
| `../lander` (`README.md:11`, `src/data/offers.json`, `PRODUCT.md`) | `packages/offers` via `pnpm offers:export`; `scripts/gates.sh:13` checks the snapshot | [[platform/offer]] |
| `../lander/functions/api/subscribe.ts`, `../lander/functions/prefs/` (`WREN_MARKETING_URL` in `wrangler.toml`, `EXPORT_TOKEN`) | `phone.wrenautomation.com/marketing/<handler>` → `Marketing`; the signup signature and the link key both derive from `WREN_SITE_EXPORT_TOKEN` | [[leads/consent]], [[platform/phone-worker]] |
| `../lander/functions/_shared/forms.ts` (from `api/apply.ts`; `WREN_FORMS_URL` in `wrangler.toml`, `EXPORT_TOKEN`) | `phone.wrenautomation.com/webhooks/site` (HMAC of `{application, at}`, Worker secret `SITE_EXPORT_TOKEN` = `WREN_SITE_EXPORT_TOKEN`) → `SmsForms/applied`; wren reads the row from `/api/export` | [[sms/speed-run]], [[platform/phone-worker]] |
| `../lander/functions/_shared/door.ts` (from `api/lead.ts`, `api/apply.ts`; Pages secret `WREN_DOOR_URL`) | `phone.wrenautomation.com/hooks/<token>` → `Executor/hook`; the payload is what `HOOK_PRESETS.site` reads (`packages/core/src/door.ts`), id `site:<table>:<row id>` | [[platform/executor]], [[sms/speed-run]] |
| `../lander/functions/go/[[path]].ts` (`?v=<YouTube id>`) | `targetLink` in `packages/content/src/funnel.ts` writes `/go/<code>/<stage>/<id8>?v=<id>` on Wren's video posts; the lander records a `hits` row (page `youtube:<id>`) and 302s to YouTube. Deploy the lander first | [[content/funnel]] |
| `../lander/functions/v/[id].ts` (`VIDEOS_ORIGIN` in `wrangler.toml`) | `<VIDEOS_ORIGIN>/v/<id>.json` as `packages/video/src/publish.ts` writes it; the CloudFront domain from `deploy/terraform/videos.tf` | [[reactivation/demo-video]] |
| `../autobrowse/walkthrough/03-meta-app.md` | `walkthrough/02-meta-ads.md` (link) | [[ads/ad-launch]] |
| autobrowse's desk `calls` service and recorder (`src/calls/`) | `CALL_RECORDER` handlers status/start/stop (`packages/calendar/src/recorder.ts`); `wren calls upcoming` JSON and `wren calls add` args (`apps/cli/src/calls.ts`) | [[email/call-recording]] |
| autobrowse's `./oauth` (`src/oauth/`, `@wrenautomation/autobrowse@0.5.0`): the wire of every sign-in | `packages/content/src/connect/oauth.ts`, `packages/channel-email/src/access/access.ts`, `packages/connectors/src/connectors.ts` call it for authorize links, a code's exchange, a refresh and Meta's Pages. A URL, form field, header or error code change there changes a live token refresh. `OAuthError` (`code`, `revoked`) is the one class wren tests with `instanceof`. Wire tests pin each caller: `connect/wire.test.ts`, `access/oauth.wire.test.ts`, `connectors/src/oauth.wire.test.ts`. Social URLs also sit in `platforms.ts` (import-free, for the portal Worker); `connect/provider-table.test.ts` keeps them equal to the piece's table. Deploy order: publish autobrowse, bump the pin | [[content/social-connection]], [[email/mail-access]], [[platform/connector]] |
| autobrowse's `sites` and `desk` services (same Restate, on the box) | called by name from `packages/core/src/content/restate.ts:21`; Meta, LinkedIn, YouTube, X, TikTok, Instagram go through them. A write that must land once sends `sendKey` (1-200 chars) with Restate's idempotency key set to it, and reads back a `SendVerdict` (`sent`, `not_sent`, `unknown`); a killed call asks `verdict {sendKey}`; the journal keeps a verdict 30 days and an unseen key writes. Deploy autobrowse first (`autobrowse/designs/2026-10-16-send-verdicts.md`) | [[content/platform]], [[content/send-attempt]] |
| autobrowse's `sites` handlers `keys`, `keySpend`, `keyRevoke` and `desk` `keyRotate` (`src/sites/keys.ts`) | `VaultKeys/box` calls them by name and copies the `KeyRow` shape by hand (`packages/core/src/vault-keys.ts`); a row with a `secret` is dropped | [[platform/vault-key]] |
| autobrowse's `web` site, `GET /fetch` (`src/reach/ladder.ts`) | `Enrichment.render` (`climbCompany`) calls, through weaver's `fetchLadder` (`@wrenautomation/weaver/fetch`), `sites.call("web", "GET", "/fetch", { url, from })` for blocked companies and reads `Fetched`: `finalUrl`, `status`, `html`, `tier` (`impersonate`, `render`, `exit`), `block`, `tries`. `from` is the remembered rung or `impersonate`. A block name (`cloudflare`, `shell`, `no-exit`) lands in `documents.block_reason` on a dead company's tombstone as given; a 429 from the facade is the cap and stops the run's ladder calls. The ingress client's caller is `wren:render`. Deploy autobrowse first (`designs/2026-10-18-fetch-ladder.md`) | [[research/document]], [[research/fetch-tier]] |
| autobrowse's `gmail` site, each seed's Gmail consent | `PlacementScheduler` reads `/gmail/v1/users/me/messages` as the seed (`restate/placement-scheduler.ts:72`) | [[email/placement-check]] |
| the channel readers `activity`/`audience` (O1-O4, each `channel-*` over autobrowse `sites`/`desk`) | `ContentChannel.activity?`/`audience?` in `packages/core/src/content/index.ts`; `SocialWatch` reads them | [[content/platform]] |
| autobrowse's `sites` and `desk` post, comment and group ids (every platform's raw spelling) | `canonRef`, `fromUrl` in `packages/core/src/objects/canon.ts` read them into `platform_objects`; a new id shape or URL form in autobrowse needs a rule there, else `resolveObject` throws `CanonError` | [[content/platform-object]] |
| Restate registrations | every service and handler name in `apps/worker/src/services.ts` | [[platform/restate-services]] |
| Documenso (self-hosted, `deploy/documenso/`; the host is William's to pick): REST API v2 and webhooks | `packages/documents/src/documenso.ts` (`create`, `distribute`, `look`, `sealed`, `withdraw`, `eventOf`); the phone Worker's `/webhooks/documenso` (header `X-Documenso-Secret`, Worker secret `DOCUMENSO_WEBHOOK_SECRET`) into `Documents.signed`. Config `WREN_DOCUMENSO_URL`/`_TOKEN` in SSM `/wren/prod/env-3`. Pinned to 2.21.0: an upgrade can change the envelope, recipient or webhook shapes, which `documenso.test.ts` copies | [[platform/document]] |
| Listmonk (the box, `lists.wrenautomation.com` through Caddy to 127.0.0.1:9000, `deploy/scripts/box-listmonk.sh`): REST API and the postback messenger | `packages/channel-email/src/listmonk/client.ts`; Listmonk posts each message to `ListmonkIntake` on the box's Restate ingress (loopback, no secret). Config `WREN_LISTMONK_URL`/`_USER`/`_TOKEN` in SSM `env-2`; admin login in SSM `/wren/prod/listmonk`. Pinned to 6.2.0 | [[leads/consent]] |
| SSM `/wren/prod/env`, `/wren/prod/senders_config` | `deploy/prod.env`, `senders_config.toml` via `deploy/scripts/push-secrets.sh` | [[platform/settings]], [[email/roster]] |
| SSM `/wren/prod/owners/<client>/keys/MAIL_*`, Google OAuth client and Entra app "Wren mail" (William creates them) | mailbox refresh tokens and Wren's app ids; Google and Microsoft redirect to `/oauth/mail/<provider>` | [[email/mail-access]] |
| GitHub `production` environment | `deploy.yml` secrets (AWS, Restate, Cloudflare token) | [[processes/deploy]] |
| the lake bucket and `wren_lake` catalog (`deploy/terraform/lake.tf`) | table and column names as the lake stores them; `lake/models/*.sql` reads them | [[processes/lake-sync]] |
| autotrack's bucket (`autobrowse-prod-track-<acct>`, read-only for the `ci_lake` role) | `<device>/<session>/<segment>/events.jsonl.gz` and `labels/<device>/<session>.json` as autotrack writes them; `WREN_LAKE_TRACK_PATH`; `lake/models/autotrack_*.sql` read them | [[processes/lake-sync]] |
| Telnyx portal | webhook URL on `phone.wrenautomation.com`, public key; a client number's voice connection must post call events to `/webhooks/telnyx/<client>` for missed-call text back (setup `setup.call_routing`) | [[platform/phone-worker]], [[sms/missed-call]] |
| texts sent to a client's customers | `phone.wrenautomation.com/r/<client>/<token>` (the host is `LINK_ORIGIN`, `packages/channel-sms/src/reviews.ts:40`); old texts keep working only while that path does | [[sms/review-ask]], [[platform/phone-worker]] |
| `../lander/functions/{book,booking,api/slots,api/book,api/booking}` (`WREN_CALENDAR_URL`, `BOOKING` in `wrangler.toml`, `EXPORT_TOKEN`) | `phone.wrenautomation.com/calendar/<handler>` → `Calendar`; `bookSig` and the manage token both derive from `WREN_SITE_EXPORT_TOKEN` | [[calendar/booking]], [[platform/phone-worker]] |
| cal.com webhook (Wren's account, beside the lander's) | `phone.wrenautomation.com/webhooks/calcom`, `CALCOM_WEBHOOK_SECRET` | [[email/call-booking]], [[platform/phone-worker]] |
| GCP project of the service account: Pub/Sub topic `gmail-push` (Gmail's push account may publish), push subscription `gmail-push-phone` | `GmailClient.watch` (autobrowse `./google`; wren's subclass in `send/gmail.ts`) and `gmailPushTopic` name the topic from the key's project; the subscription posts to `phone.wrenautomation.com/webhooks/gmail?token=` | [[processes/inbox-sync]], [[platform/phone-worker]] |
| Google Postmaster, Gmail domain-wide delegation | the service account in `WREN_GOOGLE_SERVICE_ACCOUNT` and `WREN_SEND_TRANSPORT`; token code in autobrowse `./google`, IMAP and Instantly reads in `./mail` (`@wrenautomation/autobrowse@0.5.0`) | [[email/transport]], [[email/postmaster-day]] |
| mailifier VPS (`deploy/prober`) | `WREN_VERIFIER` + `WREN_SMTP_PROBE_URL` and token | [[research/verification]] |
| `deploy/pixel` Cloudflare Worker | the open export read by `inbox/opens.ts` | [[email/open-event]] |
| `~/.local/bin/wren` on William's Mac | `bin/wren` | [[platform/cli]] |
| `walkthrough/demos/prod.sh` | CLI commands by name against prod | [[platform/cli]] |
| S3 `legacy/` and `wrenautomation/legacy-private` | the Python era's data; `scripts/import-legacy.sh` | [[ledger/import]] |
| each client's Stripe account (webhook endpoint for checkouts, refunds and disputes; `PayReconcile` reads sessions, payments, disputes daily) | `https://app.wrenautomation.com/__pay/stripe/<client>`, signed with that client's secret (`STRIPE_WEBHOOK_SECRET` beside its key) | [[platform/pay-link]] |
| client sites embedding a form | `/o/f/<slug>?embed=1` and `/o/__kit.js` with `data-embed` | [[platform/hosted-form]] |
