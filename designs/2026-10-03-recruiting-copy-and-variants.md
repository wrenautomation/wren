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

## Decision log

- Rules over Haiku for short names: free, deterministic, tested.
- "University of Waterloo" stays (proper name); elsewhere "college" (US reader,
  William 10-03, replacing "uni").
- Sign-off stays "William": the From name already reads "William Jin".
- Picks are independent per point, so options compare within a point; a new
  version starts its count fresh (newest version shown by default).
