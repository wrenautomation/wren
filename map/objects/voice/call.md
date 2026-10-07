---
type: object
cluster: voice
universe: live
status: verified
verified: 2026-10-06 @ ec9b48a
entity: packages/voice/src/schema.ts:32
---

# call (voice)

A phone call the voice agent handled, or a test call from the portal (designs/2026-10-06-voice-agent.md): table `voice_calls`, one row per call, its turns in `voice_turns`. Product word: Voice. In development: no phone line until setup, so every row today is a test.

## Why this shape

Vendors sit behind five interfaces (`Transport`, `Ears`, `Brain`, `Mouth`, optional `Hosted`, `types.ts`), so any vendor is one adapter and pipelines compare on numbers. The loop (`runCall`, `call.ts:133`) is isomorphic: the portal's test call runs the same code in the browser on fakes at $0, and the box runs it on Telnyx's media stream. Each turn keeps five stage times in ms after the caller stopped (`voice_turns`), so `voice_latency` reads p50 and p95 per stage per pipeline. The brain starts on a final transcript and holds the answer until the pause ends the turn. An AI voice is an artificial voice under the TCPA, so `placeCall` is the only dial and asks `mayDial` first: the agent's `outbound` yes, written consent naming an AI voice in `phone_consents`, no phone suppression, quiet hours (`consent.ts:60`).

## Shape

- `voice_calls`: `whose`, `direction` (inbound | outbound | test), `pipeline` ("text · scripted"), `ref`, numbers, `sms_contact_id` (the texting contact by number), `lead_name`, `outcome` (booked | transferred | message | ended | hung_up | timed_out | failed), `transcript` jsonb, `booking_id`, `message`, `by` (`schema.ts:32`)
- `voice_turns`: `call_id`, `n` (0 is the opener), caller and agent text, `tools`, `speculative`, `barged`, `final_ms`, `end_ms`, `token_ms`, `audio_ms`, `heard_ms` (`schema.ts:76`); audit-skipped
- `phone_consents`: `e164`, `whose`, `source`, the consent `text` and version, `ai_voice`, `evidence`, `revoked_at` (`schema.ts:112`)
- views `voice_call_records`, `voice_latency` (`schema.ts:142`); records `voice.call`, `voice.latency` (`records.ts`)
- the agent: the `voice.agent` part's settings in `wren_settings` (`agent.ts:55`), planned, edited in Loops > Settings
- Call now (`call-now.ts`, part `voice.call_now`): speed to lead's call step on a [[sms/speed-run]]. A lead who booked is skipped (leaves `booked`); with no dialer (every client today) it marks `alerted` "voice not set up" and the rep sees Call now on Texts > Speed to lead; with one it goes through `placeCall` and a refusal marks `alerted` with why. Once per run.
- services: `VoiceConsole{saveTest}` (`console.ts:60`); the box server `startVoiceServer` (`box/server.ts:38`) with unit `deploy/voice/wren-voice.service`, not installed

Citations: `packages/voice/src/call.ts:133`, `packages/voice/src/consent.ts:60`, `packages/voice/src/store.ts:14`

## Connected to

- **joins:** [[calendar/booking]] (`calendarIn` claims and mirrors, `ports.ts:68`), [[sms/sms-contact]] (lead lookup by number, `ports.ts:29`), [[platform/records]]
- **looks-like-but-is-not:** `call_bookings` (a booking, whatever booked it); the phone Worker (texts and the booking webhook, not voice)

## If you change this

- **Hits:** `apps/portal/web/src/modules/voice` (the test call builds `saveTest`'s input), `apps/worker/src/services.ts` (binds `VoiceConsole`, serves the records), `apps/portal/src/services.ts`
- **Does not hit:** Lambda (the loop runs on the box only), the SMS sender

## Surfaces

| Surface | Role |
|---|---|
| portal Voice app (Wren's team) | test calls write; Calls and Latency read |
| box `wren-voice` (port 8790) | answers calls once set up; refuses every call until then |

## See

- Source: `packages/voice/src/`
- Design: `designs/2026-10-06-voice-agent.md`
