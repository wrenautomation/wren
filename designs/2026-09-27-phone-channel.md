# Phone channel: cold calls, SMS, dialer app

**Status:** design 2026-09-27. Nothing built, nothing bought.
**Ask:** cold SMS and calls as cheap as possible. 1000 cold SMS a day without bans.
Branded calling. Looks legit to leads. Use it from the Mac, iPhone and Solana Seeker
(no SIM). Billing connected. Durable workflows, call recording, stats, health checks.
Warmup bought or built.

## Answer first

- **Where:** inside the wren monorepo. New `@wren/channel-phone` package plus an
  `apps/phone` PWA. No new repo (PH-D1).
- **Vendor:** Telnyx, direct. No Twilio (PH-D2). About **$100 a month** at 300 dials a day.
- **Calls are the cold channel.** A human taps each dial, in a power dialer. Legal for
  B2B, and the channel that books meetings.
- **1000 cold SMS a day to US leads: not built** (PH-D3). Carriers require opt-in for
  every registered US sender, and unregistered traffic gets blocked. Spreading texts across
  many numbers to slip under filters ("snowshoeing") is the thing carriers ban numbers and
  brands for, so I won't build it. SMS runs in two lanes instead: **warm** (they replied,
  asked, or said yes on a call) and an optional **Canada B2B** lane under CASL.
  Volume isn't the limit: one registered number carries 2,000+ texts a day. Consent is.
- **Access:** one web app at `phone.wrenautomation.com`, installed to the home screen on
  iPhone and Seeker. The browser is the phone (WebRTC), so the Seeker needs only wifi.
  Sign-in uses passkeys, which are the public/private keypair auth from your snippet,
  built into all three devices (PH-D5).
- **Warmup:** nothing to buy. SMS has no warmup; throughput comes from 10DLC trust
  score. Call numbers need a per-number ramp, free caller registries and real callbacks.
  We build that; it's the email ramp again (PH-D7).

## The legal lines the code enforces

Not legal advice. These are the rules the design hard-codes. Get one hour with a
lawyer before the first SMS lane goes live.

| Rule | What the code does |
|---|---|
| US carriers (CTIA, 10DLC): opt-in for every A2P text | SMS needs a `phone_consents` row. No row, no send. |
| TCPA quiet hours: 8am–9pm at the lead | Dialer and SMS only run 9:30–11:30 and 14:00–16:30 lead local time (reuses `companies.timezone`). |
| FCC 2024: AI voices count as "artificial" | No AI or prerecorded outbound calls. No voicemail drops to mobiles. |
| National DNC covers residential and personal mobiles | Every number gets a line-type lookup. Mobiles are flagged, scrubbed against DNC for the area codes we call, and dialed by hand only. |
| Company-specific DNC (TCPA) | "Don't call me" on a call or STOP in a text writes a `suppressions` row, kind `phone`, immediately. Honored forever. |
| Recording consent: ~12 states need all parties | Every call opens with the script line "I record calls for my notes, that okay?" The app shows it. Recording starts at answer. |
| CASL (Canada): implied consent for a conspicuously published business number, if the message is about their role | The CA lane only texts numbers from the company's own site or listing, with sender name, contact info and STOP in every message. |
| Truth in Caller ID Act | Every number we call from rings back to us, with a Wren greeting. No spoofing. |

## Architecture

```
iPhone / Seeker / Mac ── PWA (WebRTC softphone, passkey sign-in)
        │  HTTPS                         │  SIP over WebRTC
        ▼                                ▼
  Lambda function URL (api)          Telnyx (numbers, Call Control, Messaging, 10DLC)
        │                                │  webhooks (Ed25519-signed)
        ▼                                ▼
  Restate Cloud ◄──────────── Lambda (verify signature, forward event)
   PhoneEvents   (idempotent on Telnyx event id)
   DialSession   (virtual object per operator: queue, current call)
   SmsOutbox     (tick, pacing, consent + suppression gate)
   Recordings    (fetch → S3 → transcribe → classify → note)
   NumberHealth  (daily: answer-rate canary, balance, 10DLC status)
        │
        ▼
  Postgres (EC2 Docker) ── Discord alerts, daily report
```

Same stack as everything else: Restate Cloud → Lambda → Postgres. Nothing new to run.

### Data (one migration)

Phone numbers are already stored: they sit in `sightings.raw` (Google Maps, Clutch
imports). We lift them; we don't re-scrape.

| Table | Holds |
|---|---|
| `phones` | Lead numbers. `e164`, `company_id` / `person_id`, `source_sighting_id`, `line_type` (mobile/landline/voip), `carrier`, `dnc_listed`, `looked_up_at`. Unique on e164 + owner. |
| `our_numbers` | Numbers we own. `e164`, `country`, `roles` (call, sms), `ramp_day`, `daily_cap`, `paused_at` + reason, `cnam`, `registered_with` (fcr, apple, …). |
| `calls` | One row per call leg. Telnyx `call_control_id`, from, to, direction, `started_at`, `answered_at`, `ended_at`, `billed_seconds`, `disposition`, `recording_key`, `transcript`, `summary`, `cost`. |
| `sms_messages` | Direction, body, `template_version_id`, Telnyx id, `status` (queued/sent/delivered/failed), `error_code`, `cost`. |
| `phone_consents` | `e164`, `kind` (email_reply, verbal_on_call, form, casl_published), `evidence` (message id, call id, URL), `at`. |
| `suppressions` | Existing table; `kind` check widened to add `phone`. |

Costs flow into `stage_costs` like every other run. Each Restate handler is a `runs` row.

## Calls

- **Power dialer, not predictive.** The queue screen shows the next lead: company,
  person, their local time, research notes, the email thread so far. One tap dials.
  After hang-up, one tap picks the disposition and the next lead loads. The human starts
  every call.
- **Dispositions:** no answer, voicemail, gatekeeper, wrong number, not interested,
  callback (with time), meeting booked, do not call. "Do not call" writes the suppression.
  "Callback" schedules a Restate timer that puts the lead back at the top of the queue.
- **Queue order:** leads with an email reply first, then fresh leads with a landline or
  main line, then mobiles. Never twice in a day, max 3 attempts per number per week.
- **Recording:** Telnyx records both legs ($0.002/min). The file moves to a private S3
  bucket with SSE-S3 encryption (not KMS: every KMS decrypt counts against the free tier
  we already blew once). The app plays it through a short-lived presigned URL.
- **Transcript and summary** only for calls over 30 seconds. The existing LLM core
  classifies the outcome (same quote-grounding gate as the reply classifier) and writes
  a note on the lead. The human's disposition wins on conflict.
- **Inbound:** a callback rings the PWA and your iPhone's real number at the same time
  (iOS can't ring a closed web app reliably). No answer → voicemail with a Wren greeting
  → transcript to Discord and the app inbox.
- **No answering-machine detection.** The human hears it. Saves money and dead air.

## SMS

| Lane | Who | Default |
|---|---|---|
| Warm | Replied to an email, asked for a text, said yes on a call, filled a form. Consent row points at the evidence. | On once 10DLC is approved |
| Canada B2B | CA companies with a number published on their own site or listing. CASL implied consent. | Off. Behind `WREN_SMS_CA_COLD=1`. |
| US cold | — | Not built (PH-D3) |

- Sent through the same outbox pattern as email: tick, pacing, daily cap, kill switch,
  lead-local send window.
- Every first text names Wren and ends "Reply STOP to opt out". STOP, UNSUBSCRIBE and
  friends suppress at once (Telnyx also blocks at carrier level; we mirror it).
- Inbound texts go through the reply classifier. Positive → Discord ping.
- **One number, one 10DLC campaign.** Registered as "Low volume mixed" first, with the
  consent flows described exactly as built. US and CA both work from a US 10DLC; the CA
  lane uses a Canadian long code so the sender looks local.

## Numbers and branding

The goal: the phone shows "Wren Automation", the callback works, and the number
matches the one on the site.

| Step | Cost | Covers |
|---|---|---|
| Numbers from Telnyx, which owns them, so calls get STIR/SHAKEN "A" attestation | $1/mo each | Carriers trust the caller ID |
| CNAM "WREN AUTOMATION" (exactly the 15-char limit) | Telnyx listing | Landlines and some carriers |
| Free Caller Registry (Hiya, TNS, First Orion) | Free | Keeps "Spam Likely" off AT&T, T-Mobile, Verizon |
| Apple Business Connect → Business Caller ID | Free, 1–2 week review | Name + logo on iPhones (iOS 17+) |
| Number on lander footer, Google Business Profile, email signature | Free | Lead googles the number, finds Wren |
| Paid branded calling (Hiya Connect, BCID) | Per call | Only if connect rate says we need it |

autobrowse does the registry and Apple signups.

**How many numbers.** Start with 3 US + 1 CA. Each call number ramps 20 → 60 dials a
day over two weeks, then holds at 60. One person dials about 300 a day at most, so 5–6
numbers is the ceiling for one caller. 1000 dials a day means about 17 numbers and three
people. Numbers exist to spread honest volume, never to replace a flagged one; a
flagged number gets paused and fixed (registry dispute), not swapped.

## The app (`apps/phone`)

- Static PWA, hosted on the same host as the lander, API on a Lambda function URL.
- **Screens:** Queue/Dial, Inbox (texts, voicemails, missed calls), Lead (history across
  email, calls, SMS), Stats.
- **Auth:** passkeys (WebAuthn). The server stores only public keys. A passkey sign-in
  mints a 12-hour session and a Telnyx WebRTC token. Works the same on Mac, iPhone and
  Seeker from any network, no IP allowlists. Sign-in with Solana (Seed Vault) would work
  on the Seeker only, so no (PH-D5).
- **Seeker without a SIM:** WebRTC over wifi is a full phone line. No eSIM needed.
- Hotkeys on the Mac: space dials, 1–8 disposition, n next.

## Stats

SMS has no "open rate"; nothing reports opens for texts. What we track instead:

| SMS | Calls |
|---|---|
| Delivered % | Dials per hour |
| Reply % | Connect % (a human answered) |
| Positive reply % | Conversation % (talk over 45s) |
| Opt-out % | Meetings per 100 dials |
| Meetings booked | Connect % by hour of day and weekday |
| Cost per meeting | Per-number answer rate, 7-day trend |

Rates come with Wilson intervals from `channel-email/src/report/stats.ts` (move it to
core). Daily report to Discord at 17:00 fleet time. `wren phone stats` prints the same.

## Health checks (NumberHealth, Discord on trip)

| Check | Trip | Action |
|---|---|---|
| Per-number answer rate | Falls below half its 7-day baseline | Pause that number, alert (likely spam label) |
| SMS opt-out rate | Over 3% in a day | SMS kill switch |
| SMS delivery rate | Under 90% in a day | Pause SMS, alert with error codes |
| Telnyx balance | Under $20 | Alert. Auto-recharge set in Telnyx. |
| 10DLC brand/campaign status | Any change | Alert |
| Webhook lag | No events for 10 min while dialing | Alert |
| Recordings stuck | Over 10 unprocessed for an hour | Alert |

## Cost (one caller, 300 dials × 22 days, ~30 texts a day)

| Item | Month |
|---|---|
| 5 numbers | $5 |
| 10DLC campaign | ~$10 (plus $4 brand + $15 vetting, once) |
| Calls: 6,600 × ~1 billed min × ~$0.009 incl. recording | ~$60 |
| Transcripts, calls over 30s only | $2–25 |
| SMS: 660 × ~$0.008 incl. carrier fees | ~$5 |
| Line-type lookups (once per number) | ~$15 once |
| Lambda, S3 | ~$2 |
| **Total** | **~$100/mo** |

Twilio lists outbound voice at twice Telnyx's price. VoIP.ms is close on minutes, but
it has no 10DLC API and no WebRTC SDK.

## Decisions

- **PH-D1 wren monorepo, no new repo.** Leads, people, timezones, suppressions, the
  outbox, the classifier, stats, runs and Restate already live there. The phone is one
  more channel. A new repo would copy all of it or call back into wren for it.
  mailifier and credvault were spun out because they're generic tools with no Wren data;
  if a generic piece shows up here (say, a Telnyx webhook verifier), it goes out the same way.
- **PH-D2 Telnyx.** It's a carrier, so it owns the numbers (A attestation), and it has
  Call Control, Messaging, a 10DLC registration API, a WebRTC SDK, recording, lookups and
  CNAM behind one API and one bill. Rates: $0.004 + carrier fee per SMS, ~$0.007/min
  outbound voice, $1/mo numbers. One adapter file names Telnyx; the port is ours.
- **PH-D3 No US cold SMS.** Carriers require opt-in for all US A2P texting, and campaigns
  get rejected or suspended without it. Unregistered numbers get filtered. Rotating numbers
  to dodge filters gets the brand banned across every number, and it's evasion I won't
  build. Cold calls do the cold job. SMS follows up where there's consent.
- **PH-D4 Human-started calls only.** No predictive dialing, no AI voice, no voicemail
  drops to mobiles. Each of these moves a call into TCPA consent territory.
- **PH-D5 Passkeys over custom keypairs or Sign-in with Solana.** Same security (device
  keypair, server holds the public key), works on all three devices, no key files to manage.
- **PH-D6 PWA over native apps.** One codebase, no App Store review, WebRTC works in
  Safari and Chrome. A native app only if iOS keeps killing calls in the background.
- **PH-D7 Build the ramp, buy no warmup.** SMS warmup doesn't exist. Call reputation comes
  from volume per number, registry entries, answer rate and working callbacks. All free.
  Numeracle-style remediation (paid) only if a number gets labeled and the free dispute fails.

## Build order

1. **Data.** Migration; lift phones from `sightings.raw`; `wren phone lookup` (line type,
   DNC flag) for the next batch only. No spend but lookups.
2. **One number, one call.** Telnyx account (your card; auto-recharge $20 at $10), one US
   number, PWA with passkeys and WebRTC, call one lead, recording lands in S3.
3. **Dialer.** Queue, dispositions, callbacks, suppressions, inbound ring + voicemail.
4. **Branding.** CNAM, Free Caller Registry, Apple Business Caller ID, number on the lander.
5. **SMS warm lane.** 10DLC brand + campaign, consent rows, outbox, STOP, classifier.
6. **Health and stats.** NumberHealth, daily report, `wren phone stats`, more numbers on ramp.
7. **Optional:** Canada B2B lane.

Steps 1–3 are about two days of build. 10DLC approval takes days to weeks, so it gets
filed during step 2.

## Owed by William

1. Yes or no on PH-D3: SMS is warm lane + optional CA lane, no US cold.
2. Telnyx signup with your card (payment flow = your yes). ~$100/mo at full use.
3. The legal entity for 10DLC: US EIN or Canadian business number? Is Wren incorporated?
   Brand name must match the registration exactly.
4. Area codes: which US metro for the first numbers, and 416/647 for CA?
5. Who dials, and how many hours a day. That sets the number count.

## Where to attack

1. **Consent evidence is only as good as the classifier.** An email reply saying "not
   interested, don't contact me" must never become `email_reply` consent. The consent row
   should need a positive classification plus the human's tick.
2. **iOS background calls.** A PWA on iPhone may drop audio when the screen locks. If it
   does, the iPhone dials from a native wrapper or uses the Mac.
3. **Answer-rate canary is noisy** at 60 dials a day per number. A 7-day baseline needs
   ~400 dials before it means anything; until then the check should only alert, not pause.
4. **Line-type data is wrong sometimes.** Ported numbers show the old type. Treat
   "landline" from a lookup older than 90 days as unknown.
5. **Two-party recording.** The disclosure line depends on the human saying it. The app
   could hold recording until a "disclosed" tap, at the cost of one more tap per call.
6. **CASL lane scope creep.** "Published" means on their own site or listing, fetched and
   stored as evidence. A number from a data vendor is not published.
