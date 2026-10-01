# 5. Cold SMS

The SMS channel: a number pool, contacts with their consent basis, a send loop
with quiet hours and ramps, an inbox on your phone. With no provider set (the
default, and prod until Telnyx) texts queue and nothing is sent, looked up or
synced. Telnyx is settings. Why and what is owed: `designs/2026-09-27-phone-channel.md`.

## Try it locally (fake provider, nothing leaves)

    export WREN_SMS_PROVIDER=fake           # local only; refused on Lambda
    pnpm db:migrate                         # adds the sms tables (0013)
    pnpm worker && pnpm register            # SmsSender, SmsEvents, SmsDesk, SmsWatch bound
    wren sms numbers sync                   # the fake's one number, (201) 555-0100
    wren sms templates                      # the empty slots; fill them first
    wren sms templates set agencies-sms#1 "…"   # your words, STOP line included
    wren sms add "(212) 555-0101" --why "my own phone, test"
    wren sms enroll --sequence agencies-sms --limit 1
    wren sms queue tick                     # one pass: sends inside the window only
    wren sms threads
    wren sms thread 1
    wren sms stats

The fake "sends" instantly and records a fake id; receipts and replies only come
from a real provider's webhooks.

## Real texts (after William's registration)

    WREN_SMS_PROVIDER=telnyx
    WREN_TELNYX_API_KEY=…
    WREN_TELNYX_MESSAGING_PROFILE_ID=…
    WREN_TELNYX_CAMPAIGN_ID=…               # the 10DLC campaign; US numbers wait for it
    WREN_SMS_BASES=opt_in                   # exactly what the registered campaign covers
    WREN_SMS_LIVE=true                      # only after approval

    wren sms numbers sync                   # the pool, at most 5
    wren sms lift --niche agencies          # published numbers from crawled pages (free)
    wren sms enroll --sequence agencies-sms --limit 50   # one lookup each
    wren sms queue start                    # the loop; `stop` to halt
    wren sms watch start                    # labels, health, site applicants every 30 min

## Site applicants

An application on the site with the texts box ticked gets a text about 20 minutes
later, unless they booked on cal.com by then. Fits get `form-fit#1`, the rest
`form-not-fit#1`. Both are empty until you write them, and an empty one sends nothing.
Needs `WREN_SITE_EXPORT_TOKEN` and `WREN_CALCOM_API_KEY`. `wren sms forms` runs a pass now.

## On the phone

`phone.wrenautomation.com`, deployed per `deploy/phone.md`. Add each device once
with the setup link, then Add to Home Screen. Inbox, reply, label, pause a number,
templates, stats.

## Knobs

`WREN_SMS_WINDOW` (10:00-17:00 lead's clock), `WREN_SMS_DAYS` (1-5),
`WREN_SMS_DAILY_CAP` (1000), `WREN_SMS_NUMBER_CAP` (200),
`WREN_SMS_RAMP_START`/`_STEP`/`_EVERY_DAYS` (20/20/2), `WREN_SMS_GAP_SECONDS` (20),
`WREN_SMS_MAX_FAIL_RATE` (0.15), `WREN_SMS_MAX_OPT_OUT_RATE` (0.03),
`WREN_SMS_LOW_BALANCE_USD` (5), `WREN_SMS_HELD_NICHES` (sec_ria),
`WREN_SMS_MONTHLY_PER_CONTACT` (4 in any 31 days, never more).
