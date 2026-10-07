---
name: lander
description: Build a code page for one offer (a lander, listicle, comparison or pitch page that a template can't do), carry the Sites kit so it counts, deploy only on William's yes, then register it with `wren sites add`. Use when the user says "build a lander for <offer>", "make a page for this ad", "a listicle for <offer>", "a code page", or asks for a page the data templates don't fit. For a plain lander or listicle, use `wren sites new` instead.
---

# lander

Run the CLI as `./bin/wren` from the repo root. Kit details: `packages/sites/kit/README.md`; copy-paste parts: `packages/sites/kit/head.html`. Design: `designs/2026-10-07-sites.md`.

## First: does a template do it?

A data page needs no code and no deploy. Try it first:

```sh
./bin/wren sites offers
./bin/wren sites new --offer <id> --template lander|listicle --angle "<angle>" [--ai]
```

Build a code page only when the page needs a layout, a calculator or media a template doesn't have.

## The loop

1. **Read the offer.** Use `packages/offers` (or lander `src/data/offers.json`, generated from it). Name, promise, price, what they get and the guarantee come from there, word for word where it counts. Read the facts with `./bin/wren drafts facts`. They are the only claims about us a page may make.
2. **Build.** Put a page on wrenautomation.com in the lander repo (`../lander`, Astro), under its own path. Put anything else in a standalone dir of static HTML. Each page sells one offer and asks for one thing, the form or a booking.
3. **Carry the kit.** Add the kit tag in `<head>`, `data-cta` and `data-book` on buttons, and the door form as it is in `head.html`. Leave `PAGE_ID` for now; step 6 fills it.
4. **Check the copy.**
   - No em dashes.
   - Plain words a person would say out loud.
   - Claims about us only when a fact says it.
   - No number that isn't in the offer or the facts.
   - No client names.
   - Run the `humanizer` skill on the copy.
   - Lander repo rules: copy as "I", claims above the fold, square buttons.
5. **Show William.** Send a local preview or screenshots at 1440 and 390 wide, plus the copy. Stop here until he says yes.
6. **Deploy, only on his yes.**
   - Lander repo: a push to main deploys. Push only when he says to.
   - Standalone dir: use the autobrowse `do` ability `wrangler-pages-deploy`. It is on autobrowse branch `sites-pages-deploy`, not merged yet. If it isn't on main, ask William before using that branch.
     ```sh
     cd ../autobrowse && pnpm -s autobrowse do "deploy this site to cloudflare pages" --input dir=<abs dir> --input project=<project> --dry-run
     ```
     Run without `--dry-run` only after his yes for this deploy.
7. **Register.** Run `./bin/wren sites add --url <live https url> --repo-path <repo>/<path> --offer <id> --title "<name>" --kind lander`. It prints the page id. Put it in `data-page` and the form's hidden `page`, then redeploy, with the same yes. Running `add` again updates the same page.
8. **Link it.** Ads and posts go through `/go/<channel>/<campaign>/<content>`. For an ad, the ad id goes last. See the kit README.

## Never

- Deploy, push or post without William's yes for that page.
- Write to prod from here. `wren sites add` writes to the database the CLI targets.
- Hand-edit lander `src/data/offers.json`. Change the offer in `packages/offers`, then `pnpm offers:export`.
