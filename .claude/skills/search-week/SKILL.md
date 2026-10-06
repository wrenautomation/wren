---
name: search-week
description: The weekly copy step of the search loop. Reads the prod search brief (keyword positions, engine citations, page traffic), reads the lander source for those pages, proposes small word or phrase swaps, shows each with its reason, and on William's yes opens a lander PR through `wren search pr`. Use when the user says "/search-week", "run the search week", "brief ready", or asks for this week's SEO copy edits.
---

# /search-week

Run by hand. `SearchWeek` on Restate does the reading every Monday (Search Console, discovery, fan-out, Google and Perplexity checks) and sends "brief ready, run `/search-week`". This skill is the copy step. Design: `designs/2026-09-30-search-loop.md`.

Run everything from the wren repo root. `node scripts/prod-wren.mjs <args>` is `./bin/wren <args>` against prod (database and search settings from `deploy/prod.env`, never printed).

## Steps

1. **Brief.** `node scripts/prod-wren.mjs search brief`. Keywords with impressions, clicks, average position and engine citations; then each page's index state and traffic. Note which keywords are weak (no impressions, low position, not cited) and which page should answer each.
   Then `node scripts/prod-wren.mjs search citability`: the weakest `/llms.txt` passages (0-100; answers engines lift are self-contained, about 134-167 words, open with the answer, carry a sourced figure). A weak passage on a weak keyword's page is where a swap helps most. A passage that needs to grow is a note, not an edit.
2. **Read the source.** The lander is at `../lander`. `wren search pr` edits only `src/content/`:
   - `/` → `src/content/hub/home.yaml`
   - `/recruiting/lead-reactivation` → `src/content/pitches/recruiting.yaml`
   - `/agencies` → `src/content/niches/agencies.yaml`
   - every page → `src/content/site/site.yaml`

   Read the whole file for each page in the brief. Text that lives only in an `.astro` file can't be applied; it can only be a note.
3. **Draft edits** into a scratch JSON file (scratchpad, never the repo):
   ```json
   [{ "page": "/agencies", "kind": "heading", "current": "exact text from the file", "proposed": "the swap", "why": "one sentence: which keyword, what it fixes", "keywords": ["agency operations automation"] }]
   ```
   `kind` is `title`, `description`, `heading` or `copy`. `current` is copied word for word and appears exactly once across `src/content/`. Up to 6 edits; fewer is fine; none is a fine answer.
4. **Gate.** `node scripts/prod-wren.mjs search propose <file> --dry`. It checks every edit against the live site: the quote exists, no price, no dash, no number the site doesn't state, at most 6 words changed. A refused edit is fixed or moved to the notes. Never argue with the gate.
5. **Show William**, one block per edit, before anything is stored or pushed:
   ```
   1. /agencies, heading. Keyword: "agency operations automation" (0 imp, not cited)
      was: …
      now: …
      why: …
   ```
   Then the notes: anything bigger than a swap, said in a sentence each. Wait for his yes. He may cut or change edits; re-gate after any change.
6. **Ship** on his yes:
   - `node scripts/prod-wren.mjs search propose <file>` stores them (last week's open ones go stale).
   - `node scripts/prod-wren.mjs search pr --dry` must show every edit under "Applied". One under "By hand" means the quote isn't unique in `src/content/`: fix the quote and go back to step 4.
   - `node scripts/prod-wren.mjs search pr` opens the PR: a worktree off `origin/main`, `npm run check`, push, `gh pr create`. Give him the URL. He merges; the merge deploys.

## Copy rules (built in, for now)

- Only small word or phrase swaps. No sentence rewrites, no style rewrites, no new sections, FAQs or pages.
- Keep his voice and sentence structure. Swap in the words a buyer types; keep everything around them.
- An edit that needs more than a few words is a note, not an edit. The code cap is 6 words changed (added plus removed).
- No prices, no dashes, no new numbers, no client names. Keep every claim as it stands.
- Say "company", not "firm".

**Not done yet:** Wren's copy SOPs (the cold-email framework, the lander copy rules, the offer rules) are to merge into one source that this skill and the agents both load. Until that exists, use only the rules above. Don't pull rules from memory files or other docs.

## Never

- Never push to lander `main` or merge the PR. A push to main is a deploy, and the copy is his.
- Never edit the lander checkout itself; `wren search pr` works in its own worktree.
- Never store or push before he has seen every edit.
