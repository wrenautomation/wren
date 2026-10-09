# Follow-up and Nurture (2026-10-07)

Both parts sit in `apps/worker/src/planned.ts` as "In development", wired into `keep_warm`
(follow → nurture → replies). This makes them run.

## Answer first

- Follow-up works a quiet lead: a text, a DM, a text, each followed by a wait. A reply or a
  booking on any channel ends it at once, out `replied`. No answer after the last wait: out
  `quiet`.
- Nurture keeps a not-yet lead warm: one touch a month for four months, text and DM in
  turn. A reply ends it. After the last: out `quiet`.
- Both are workflows of steps that exist: Text step (`sms.touch`), DM step (`reach.touch`),
  Email step (`email.touch`) and Wait (`logic.wait`, until a reply or a booking).
- Nothing sends unless the global gate and the client's sends flag for that part are both on.
  Off, each touch records "would send" and the lead moves on. Nothing sends in tests.
- The last touch is an email in our own thread. It drafts into To approve; a person's yes sends
  it. Calls and voicemail stay "In development".

## Inside

| Part | Steps (defaults) | Out |
|---|---|---|
| Follow-up (`follow_up.touches`) | text 1 · wait up to 2 days · DM 1 · wait up to 3 days · text 2 · wait up to 4 days · email | `replied`, `quiet` |
| Nurture (`nurture.touches`) | wait up to 30 days · text · wait 30 · DM · wait 30 · text · wait 30 · DM · wait 30 · email | `replied`, `quiet` |

- Each wait is a Wait until "a reply or a booking". Both ways out (`out` when one comes,
  `timeout` when time runs out) go to the next touch. The touch first checks whether they
  answered, so an answer leaves by `replied` at once. A Wait's out port carries a lead and the
  part's `replied` carries a reply, so the touch does the conversion.
- The last step is the Email step (built 10-09). It drafts the node's copy (`email:follow/
  follow-up`, `email:follow/nurture`) as an asked reply in To approve, on the lead's text or DM
  thread, else on our email thread (`outbound:<enrollment>`). Approve sends it in reply to the
  last email we sent, from that thread's inbox (`Disposition.followUp`). Out `quiet` either way;
  a reply later still ends the lead.
- It skips a thread whose sequence still sends, one that bounced, was opted out or stopped by
  hand, a suppressed address, and copy needing a fact they lack. Settings: `emails` (default on).
- A touch node with no `step` setting is one follow-up touch. It reads its own copy
  (`node.template`, now on `StepAt`) and finds the lead's thread on its channel.
- Each touch first asks: did this lead answer on any channel, or book? Then out `replied`. Is
  the lead in an active sequence anywhere? Then it skips, so no lead gets two cadences at once.
- A reply on one channel lets go of a wait held on another: the spine maps the reply's thread
  to its lead (`lead_channels`) and frees every wait about any of that lead's threads.

## Knobs

- Copy: each touch's template, edited in the Library, per client.
  - Defaults ship as files: `sms:texts/follow-up#1..2`, `dm:reach/follow-up#1`,
    `sms:texts/nurture#1..2`, `dm:reach/nurture#1..2`.
  - Installing the part imports them, as for every part.
- Timing: each wait's "at most", edited in the editor. A save may now change a built-in
  Wait's settings (`WorkflowEdits.settings`), not just added nodes.
- Channel order: the wires, edited in the editor. Add, drop or reorder touches.
- Part settings: which channels it may use (texts, DMs). A touch on a channel turned off
  passes the lead on.

## Sends gates

Every touch, in order:

1. Answered or booked on any channel: out `replied`, nothing sent.
2. Consent.
   - Text: only a contact who asked to be texted (form or door).
   - DM: a contact we already wrote to, not opted out, blocked or unreachable.
   - No such thread: skip and pass on.
3. Gate. The global env gate (`WREN_SMS_LIVE`, `WREN_REACH_LIVE`) AND the client's
   `clients.sends` flag for the part (`follow_up` or `nurture`, set by an admin from the CLI).
   - Either off: "would send", pass on.
   - Wren's own runs have no client flag. The global gate alone decides.
4. Queue. One message of kind `follow_up`, due now. The channel's sender sends it:
   - texts: quiet hours with the 20:00 cutoff, STOP, the monthly cap;
   - DMs: the window, the account's caps.
   - A reply before it leaves skips it.
5. Copy. Only live words go. New copy for a part that sends waits in To approve for the
   client's approver, as every sending template does.

What each touch did is kept on its output (`data.follow`): the part, channel, `queued`,
`would send` or `skipped`, and why.

## Records

- Executions: a follow-up lead's title names who it is and the channel ("Dana Lee: DM
  lead"). "Now at" names the step it waits at.
- Journey: a person's page gets a Follow-up lane: each touch, and the wait it is in now.

## In development

- Calls and voicemail: listed on both parts. They wait on voice; the vendor is William's
  call.

## Decision log

- 2026-10-07: written. Touches stay the existing steps, with a second mode (no `step`) rather
  than new parts, so the editor's palette and the Library work unchanged.
- 2026-10-07: Wait until gains "a reply or a booking" (`answer`), since both end a follow-up.
- 2026-10-07: cross-channel release goes in `Spine.fire`. A reply frees every wait about the
  same lead. This also applies to waits in other workflows; it was the intent there too.
- 2026-10-07: email to quiet leads deferred. It needs a send path for finished threads
  (approval, inbox choice, threading), which is its own build.
- 2026-10-09: email to quiet leads built on the Inbox's asked replies, not a new queue. To
  approve, Approve, Drop and the approver rules stay one path. The Inbox also offers "Email
  <address>" on our thread when they never wrote back.
- 2026-10-07: a step's kept output that runs past 32 KB still keeps `data.follow`, since the
  journey reads it.
