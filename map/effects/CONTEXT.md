# effects: I am changing X, what do I open?

A catalog, not a waterfall. Each row names the cards whose **If you change this** applies. When this file and a card disagree, fix the card.

## Inside the tree

| Changing | Open first | Then |
|---|---|---|
| a column on `companies`, `people`, `leads` | [[leads/company]], [[leads/person]], [[leads/lead]] | `packages/core/src/views.ts`, [[processes/import]], [[processes/migrate]] |
| what counts as suppressed | [[leads/suppression]] | [[processes/inbox-sync]], [[processes/sms-tick]], `packages/channel-email/src/guards.ts` |
| a research stage or its spend | [[processes/pool-feed]] | [[research/enrichment]], [[research/contact-candidate]], [[research/verification]], [[platform/settings]] (`WREN_POOL_MODEL_STAGES`) |
| an `.email` file or a `{key}` | [[email/template]] | [[email/sequence]], [[processes/compose]], `sops/cold-email-copy.md` |
| a sequence, arm or plan rule | [[email/sequence]] | [[platform/niche]], [[processes/compose]], `sops/campaign-ramp.md` |
| who sends, from which inbox | [[email/roster]] | [[email/send-policy]], [[processes/deploy]] (SSM roster), [[platform/loop-object]] (keys) |
| caps, windows, ramp | [[email/send-policy]] | [[processes/send-tick]], [[processes/compose]] |
| message or enrollment states | [[email/message]], [[email/enrollment]] | `packages/channel-email/src/state.ts`, [[processes/send-tick]], every view in `packages/channel-email/src/views.ts` |
| what a reply means | [[email/thread-event]] | [[processes/inbox-sync]], [[platform/llm-client]] |
| kill switches | [[email/sender-pause]] | [[processes/send-tick]], [[platform/notifier]] |
| the wire (Gmail) | [[email/transport]] | [[processes/send-tick]], [[email/report]] |
| a platform's API shape or limits | [[content/platform]] | [[content/draft]], [[processes/content-loop]], `apps/worker/src/services.ts` |
| drafting, voice, slots | [[content/draft]] | [[content/idea]], [[content/content-metric]], [[processes/content-loop]] |
| media hosting | [[content/media]] | [[content/platform]], `deploy/terraform` |
| Meta ads | [[ads/ad-launch]] | [[processes/ads-launch-watch]], [[content/idea]] |
| SMS numbers, contacts, texts | the `sms/` cards | [[processes/sms-tick]], [[platform/phone-worker]] |
| the carrier | [[sms/sms-provider]] | [[sms/sms-event]], [[platform/phone-worker]], [[platform/settings]] (`WREN_SMS_*`) |
| a `WREN_*` key | [[platform/settings]] | [[platform/worker]] (SSM), [[processes/deploy]] |
| a niche or a new one | [[platform/niche]] | [[email/template]], [[email/sequence]], [[platform/offer]], [[processes/migrate]] (facts view), [[email/roster]] |
| an offer | [[platform/offer]] | the lander snapshot (below) |
| a client, its database or its settings block | [[clients/client]] | [[processes/reactivation-pass]], `apps/worker/src/services.ts` (key routing), [[processes/migrate]] (every client database) |
| CRM formats, import, scoring | [[reactivation/crm-contact]] | [[processes/reactivation-pass]] |
| recruiters, firm facts | [[reactivation/client-profile]] | [[reactivation/handoff]], compose (`packages/reactivation/src/compose.ts`) |
| forwarding, meetings, the bill | [[reactivation/handoff]] | [[platform/offer]] (`perUnit`), the portal (`packages/reactivation/src/portal/`) |
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
| `../autobrowse/walkthrough/03-meta-app.md` | `walkthrough/02-meta-ads.md` (link) | [[ads/ad-launch]] |
| autobrowse's `sites` service (same Restate Cloud) | called by name from `packages/core/src/content/restate.ts:21`; Meta, LinkedIn, YouTube, X, TikTok, Instagram go through it | [[content/platform]] |
| Restate Cloud registrations | every service and handler name in `apps/worker/src/services.ts` | [[platform/restate-services]] |
| SSM `/wren/prod/env`, `/wren/prod/senders_config` | `deploy/prod.env`, `senders_config.toml` via `deploy/scripts/push-secrets.sh` | [[platform/settings]], [[email/roster]] |
| GitHub `production` environment | `deploy.yml` secrets (AWS, Restate, Cloudflare token) | [[processes/deploy]] |
| Telnyx portal | webhook URL on `phone.wrenautomation.com`, public key | [[platform/phone-worker]] |
| Google Postmaster, Gmail domain-wide delegation | the service account in `WREN_GOOGLE_SERVICE_ACCOUNT` and `WREN_SEND_TRANSPORT` | [[email/transport]], [[email/postmaster-day]] |
| mailifier VPS (`deploy/prober`) | `WREN_VERIFIER` + `WREN_SMTP_PROBE_URL` and token | [[research/verification]] |
| `deploy/pixel` Cloudflare Worker | the open export read by `inbox/opens.ts` | [[email/open-event]] |
| `~/.local/bin/wren` on William's Mac | `bin/wren` | [[platform/cli]] |
| `walkthrough/demos/prod.sh` | CLI commands by name against prod | [[platform/cli]] |
| S3 `legacy/` and `wrenautomation/legacy-private` | the Python era's data; `scripts/import-legacy.sh` | [[ledger/import]] |
