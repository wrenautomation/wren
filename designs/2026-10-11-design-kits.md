# Design kits

2026-10-11. William's temp notes: "Full web aesthetic repositories and similar for any visual content (design kits) for our system", "Cool ui library, thoughts?" (an isometric line-figure reel), and two design reels to "look on / base stuff on".

## Decision

One short list of kits per job, each with its license checked, so an agent making a page, a post, a promo or an ad picks from it instead of searching each time. References (reels and posts we liked) live in Learn → collection **Design refs**, not in this file.

| Job | Kit | License | State |
|---|---|---|---|
| Portal UI | shadcn on Base UI, Tailwind, `@wren/ui` | MIT | in use |
| Diagrams, charts | React Flow, ELK, Recharts | MIT | in use |
| Icons | Lucide | ISC | in use |
| Lander motion | GSAP | free, incl. commercial | in use |
| Video | Remotion (`packages/studio`) | free up to 3 people | in use; a company license past that |
| Line figures | hairline (`@lucasmarkes/hairline`, skill `hairline-create`) | MIT, no dependencies | adopt from 10-22 |
| More components | shadcn registries (Space UI, Magic UI): one component at a time, copied in | MIT | when a page needs one |
| Type | Google Fonts, Fontshare | OFL / ITF free, commercial use | per piece |
| Stock footage and photos | Pexels | free, commercial, no credit | per piece |

## Why

- **No second UI library.** The portal already has its primitives. A second one doubles the ways to draw a button. A registry component is copied in and restyled to our tokens.
- **hairline:** the reel's library. Figures answer the pointer and play on their own when asked. They stop under reduced motion, which keeps the lander's one-motion-at-a-time rule. For the lander and blog, never the portal (real-event motion only). Its npm package is 10 days old (0.5.0, 10-08), so it waits until 0.5.0 is two weeks old.
- **Stock footage:** Pexels covers the montage look we skipped on 10-11 for rights (promo `enter: pull-back | wipe`).
- **Hand-drawn type posters** (the 15-year-old's reel): made by hand in a paint app. The type part became the promo's scattered layout (c44a3f1d). The hand-drawn part is a person's art, not a kit.

## Not now

- Paid kits (Envato, UI8). Nothing above blocks on one.
- A design-system site. `@wren/ui` is the system, and the local portal preview (`pnpm --filter @wren/portal preview`) shows it in place.
