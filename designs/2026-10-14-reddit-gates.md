# Reddit gates: don't spam a sub we don't qualify for

2026-10-14. William: "just make sure we don't spam a subreddit (we just queue it up) until we meet its requirements."

## Why

AutoModerator removed our comment in r/SalesTechniques (account must be 10+ days old with 50+ karma). Both accounts have about 1 karma. A second send would be a second removal.

## Decisions

- A per-sub record, `reddit_requirements` (migration 0255): one row per sub and source. `removal` (a mod's words), `rules` (the place read), `manual` (CLI). The floor is the highest of each field over rows not cleared.
- A removal that states no numbers is an unknown gate: `hold`. It blocks every account until he clears it or the same comment shows live.
- Account standing is the stored health (age, karma, comment karma). The watch pass refreshes it every ~30 min through the account's own read, so no new reads and no extra cost on the reddit-public cap.
- The proof reader looks for a mod or AutoModerator reply under a removed comment and appends it to the proof note. That is what states the floor.
- One gate, `gatesFor`: used by the send (`planThreadComment`), the scheduler (`applyGates`), and the portal rows. A held comment stays `queued`, loses its slot, shows state Held with "Held because", and is re-checked every pass.
- If the place's account is under the floor and the other account is over it, the place and its queued threads move to the other account.
- A manual Comment click on a held thread returns the reason. A scheduled send quietly leaves the schedule.

## Not built

- `answerComment` (replies under our own comments) is not gated.
- A hold lifts only on a manual clear or a live check of the same comment.
