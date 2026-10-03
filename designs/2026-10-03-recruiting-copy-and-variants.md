# Recruiting copy round 7 and per-variant tracking (2026-10-03)

## What changed

- **Firm names.** `company_short` (derived in `sentenceReady`) is what a person
  says mid-sentence: descriptor tails cut ("Grove Technical Resources" → Grove),
  initials when only plain words are left and there are 3+ ("Superior Resource
  Specialists" → SRS), else the full name. On the 213 queued recruiting firms:
  78 kept, 131 shortened, 4 initials.
- **Subjects.** Curiosity, no pitch: "Jose, something interesting about your
  clients" / "Jose, about your clients"; follow-up "one more thing…" / "still
  curious…".
- **Body.** Casual voice for all four emails (both arms, opener and follow-up):
  college student hook, "resonate", "to be frank" pain line, Waterloo + gov +
  college labs, "know my way around tech", the system sentence (old leads,
  enrichment, open opportunities ASAP, multi-platform in their voice, calls
  booked), guarantee, "30 min call", "Lmk", blank line before "William".
- **Variant report.** `wren email variants [--niche] [--all]`: per template
  version, each `[[ ]]` point's options with sends, human opens, replies,
  interested, and the option's words read back from `template_versions.source`.

- **Queue follows deploys.** Compose saves each sequence's text at enroll, so a
  template edit used to reach queued mail only at the midnight top-up. Deploy
  now calls `QueueRefresh/all` after registering the worker: every niche's
  untouched, unstarted queue re-renders within minutes. `wren email refresh`
  runs it by hand. Refresh only; nothing composed or sent.

## Decision log

- Rules over Haiku for short names: free, deterministic, tested.
- "University of Waterloo" stays (proper name); elsewhere "college" (US reader,
  William 10-03, replacing "uni").
- Sign-off stays "William": the From name already reads "William Jin".
- Picks are independent per point, so options compare within a point; a new
  version starts its count fresh (newest version shown by default).
- Refresh on deploy, not hourly polling: templates only change by deploy, so
  the deploy is the event. Facts and sign-off drift still catch up at midnight.
- No opt-out flag: to run old vs new copy side by side, add the new copy as its
  own arm (or a `[[ ]]` variant). An edit in place means "replace".
- 2026-10-03: the deploy refresh skips messages already on the current template version (`staleOnly`), so a deploy that touched no template reads no facts and writes nothing. The midnight pass still re-renders everything for facts and sign-off drift. The variant report counts replies and opens once per message, then joins, instead of running subqueries per row.
