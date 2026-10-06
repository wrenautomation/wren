# Voice agent: one interface, our own pipeline

2026-10-06. William: "voice agent scaffolding should be built but defer setup. universal
interface for the input output. considering creating our own hosted infra for that to remove
latency issues that current market solutions have."

Replaces the end-goal call "buy the voice (Retell, Vapi)": we build the interface and the
loop, and any vendor becomes one adapter behind it.

## Answer first

- **Build now:** the interface, the call loop, the agent's tools, fakes for every piece, a typed
  and a browser test call in the portal, and per-stage latency on every turn. $0.
- **Deferred to his yes:** vendor accounts and keys, a voice-enabled number, live calls, any GPU.
- **Self-hosting:** most of the delay in hosted platforms comes from hops between vendors in
  different places and from waiting on each stage to finish before the next starts. Running our
  own loop in one process, near the phone network's media, with every stage streaming, fixes
  that with no GPU. Running our own speech and language models on GPUs is a later step, only
  if the measured numbers say the vendors' models are the slow part. A GPU running all day is
  money, so it's his call.

## The interface

A call is a session: a transport carries the caller in and our voice out; three stages sit in
between. Each is an interface with a fake and, later, real adapters.

| Piece | In | Out | Adapters |
|---|---|---|---|
| `Transport` | the caller's audio frames, or text turns; start, keypad, hang-up | our audio or text; clear (barge-in), transfer, hang-up | fake, text (portal), browser (mic and speaker), Telnyx media stream (written, unconfigured) |
| `Ears` | audio frames | partial and final words, with end of turn | fake; vendors at setup |
| `Brain` | the transcript so far, the lead's context, tools | streamed reply and tool calls | `@wren/llm` (already swappable, Claude Code for tests at $0) |
| `Mouth` | text, a sentence at a time | audio frames | fake; vendors at setup |
| `Hosted` | the agent definition | a whole call through a vendor (Retell, Vapi) | optional, for comparison only |

A transport that carries text (the portal's typed call, or the browser's own speech in and out)
skips Ears and Mouth. The same agent runs on every pipeline.

**The agent** is a Shop part's settings: first line, prompt, voice, tools, turn rules (how long
a pause ends a turn, whether the caller can interrupt), hours, and transfer number. Tools: look
up the lead, offer times and book on our calendar (`2026-10-06-calendar.md`), transfer to
William, take a message, end the call.

**Output:** the transcript and outcome go into the lead's thread; a booking goes through
`CallBookings`; the recording goes to S3 like screenshots; latency per stage per turn goes to a
`voice_turns` table.

## Latency

Each turn is timed by stage: end of speech, words final, first reply token, first audio out,
and audio reaching the caller. The Voice app shows p50 and p95 per stage, per pipeline, so
pipelines are compared on numbers.

How the loop stays fast:

- Everything streams.
- The brain starts on a likely final transcript and drops the answer if the caller keeps going.
- The first sentence goes to the mouth before the reply ends.
- Barge-in clears our audio at once.
- Filler lines are cached as audio.

The loop is a long-lived process holding the call's socket, so it can't run on Lambda. It runs
on the box (us-east-1) beside Restate, as a box service. A bigger or second box, nearer the
media, if the numbers ask for it.

## Rules the code enforces

- An AI voice counts as an artificial voice under the TCPA (FCC, 2024). Outbound AI calls go
  only to a number with prior express written consent saved in `phone_consents` (a form that
  says so); otherwise the call is refused in code. Inbound calls and test calls are fine.
- The agent says it's an AI assistant in its first line, and asks before recording where the
  state needs both sides' consent.
- Quiet hours and suppressions from the phone channel apply to every outbound call.
- Nothing dials out without his yes per agent.

## Portal

A Voice app with these pages:

- **Agents:** settings and tools.
- **Test call:** typed, or spoken through the browser at $0.
- **Calls:** empty until setup, each one with its transcript, recording and outcome.
- **Latency:** per stage.

Its Shop part reads "In development" until setup.

## Build order

1. Interfaces, fakes, the session loop with barge-in and turn timing, `voice_turns`. Tests on
   fakes.
2. The agent as a Shop part, its tools against our calendar and the lead's thread, the portal's
   typed test call.
3. Browser test call (the browser's speech in and out), and the Telnyx media-stream transport
   written against its docs and left unconfigured.
4. Setup, on his yes: pick ears and mouth vendors by measured latency, a voice number, consent
   wording on forms, live calls, then speed to lead dials with it.

## Decision log

- 2026-10-06: William asked for the scaffold now, setup deferred, and our own infra over market
  platforms. Building steps 1 to 3.
