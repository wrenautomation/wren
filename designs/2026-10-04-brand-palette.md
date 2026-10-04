# Brand palette

Living doc. Started 2026-10-04. William moved color theory styling from Parked to now on 10-04, as an option next to the presets. One brand color becomes a full, checked palette for every component in the kit.

## What it is

A client's look can be set three ways:

1. **Preset**: `wren`, `night`, `soft`, `editorial` (today).
2. **Manual**: tokens typed in (today, through `readTheme`).
3. **From a brand color** (new). Pick one color. Material Color Utilities (Apache 2.0, `@material/material-color-utilities`) builds tonal palettes in HCT, a perceptual color space, and maps them onto the kit's tokens. Explicit tokens still win over derived ones.

The look is stored on the client and applied in the portal for that client's workspace, the demo included. Wren's own workspace can carry one too.

## Input

```ts
{ brand: { color: "#1d5a45", variant: "tonal_spot", harmony: "analogous", contrast: 0, scheme: "light" } }
```

- `variant`: MCU's scheme variants. `tonal_spot` (default, calm), `vibrant`, `expressive`, `fidelity` (stays closest to the exact brand color), `content`, `neutral`, `monochrome`.
- `harmony`: how the chart colors relate to the brand color in hue. `analogous` (default, ±30°), `complementary`, `split` (±150°), `triadic` (±120°), `tetradic`. Each hue is a tonal palette at the same tone, so the series read as one family.
- `contrast`: MCU's contrast level, `0` (standard), `0.5` (medium) or `1` (high).
- `scheme`: `light` or `dark`.
- Plus any manual tokens and an optional `preset` to start from, as today.

## Mapping

From MCU's dynamic scheme roles to kit tokens:

| Token | Role |
|---|---|
| canvas | surface |
| paper | surfaceContainerLowest (light), surfaceContainer (dark) |
| tile | surfaceContainerHigh |
| ink | onSurface |
| ink-2 | onSurfaceVariant |
| ink-3 | outline |
| accent | primary |
| on-accent | onPrimary |
| good | a green (#2e7d32) harmonized toward the brand with MCU's `Blend.harmonize` |
| good-ink | that green's tone 30 (light) or 80 (dark) |
| bad | error |
| shade | shadow |
| chart-1 … chart-5 | accent, then the harmony's hues at tone 50 (light) or 70 (dark), then a neutral |

`chart-1` … `chart-5` join `TOKENS` so any theme can set them. The derived tokens (`wash`, `hair` …) keep deriving in CSS as today.

## Checks

Derivation runs a WCAG 2.1 contrast check on the pairs that carry text: ink, ink-2 on canvas and paper; on-accent on accent; good-ink on good-tint; bad on bad-tint. Body text needs 4.5:1, ink-3 needs 3:1. A pair that fails is fixed by stepping its tone in HCT toward more contrast until it passes, and the fix is reported. So a derived theme always passes, whatever color goes in.

## Where it lives

- `packages/ui/src/palette-brand.ts`: `brandTheme(input) → { theme, report }`. Pure, so it runs the same in the browser and in tests. `readTheme` takes `brand` and calls it, so a stored look stays small: inputs, not 40 tokens. The name keeps clear of `palette.tsx`, which already exists.
- `clients.look` jsonb, nullable (migration 0075). It holds anything `readTheme` reads. `null` means Wren's look.
- `ConsolePortal.setLook {client, look}`: operator only, with the demo allowed (it's our own sample). A client owner sets their own from Account → Look, with the same form, and only for their own client.
- The portal applies the signed-in workspace's look with `usePageTheme`. `?theme=` still overrides it for a try, as today.

## The editor

A Look form in the Clients app's record and in Account:

- Mode: preset, manual, from a brand color.
- A color box (native `<input type="color">` plus hex), variant, harmony, contrast, scheme.
- **From a logo**: pick an image file. It's read in the browser through a canvas, MCU's `QuantizerCelebi` and `Score` suggest up to four brand colors, and a click picks one. Nothing is uploaded.
- A live preview on the real kit: a button, an accent button, a tile with a number, a table row, good and bad badges, a sparkline and a 5-series bar using the chart tokens.
- The contrast report: each pair's ratio, and pass, or what was stepped to pass.
- Save and Reset to Wren's.

## Phases

1. `brandTheme`, the mapping, harmony, contrast steps; `chart-*` in TOKENS; `readTheme` takes `brand`. Tests: five brand colors (very light, very dark, saturated red, gray, the Wren accent) each pass every check in light and dark; a manual token beats a derived one; the same input always gives the same theme.
2. Migration 0075, `setLook`, applying the workspace's look in the portal.
3. The editor in Clients and Account, from a logo, the preview and the report. Screenshots at 1360 and 390 as the operator: the editor with a brand color, and the demo client's Glance in that look. Light and dark.

## Done when

- The demo client shows in a look made from one color, and every text pair passes AA.
- An owner can set their own look and can't set anyone else's.
- Presets and manual tokens work as before.
- Gates pass.

## Decision log

- 2026-10-04: Written. William moved this from Parked to now, as an option. MCU over a hand-rolled HSL mapping: HCT keeps tones perceptually even, so contrast holds across hues. Store the inputs and derive on read, so a better mapping later improves every stored look. Contrast failures get stepped, not refused, so any color works.
- 2026-10-04: Phase 1 built. Choices the doc left open: harmony turns for chart-2..4 are analogous 30/-30/60, complementary 180/30/210, split 150/-150/30, triadic 120/-120/60, tetradic 90/180/270; chart chroma is at least 36 so neutral and monochrome charts still tell series apart; chart-5 is the neutral variant at the chart tone; chart-1 stays `var(--ui-accent)` in CSS so a typed accent carries to it. Checks added past the doc's list: ink and ink-2 on tile, ink-3 at 3:1 on canvas and paper, and accent on accent-tint (the rust tag). Tints are mixed over paper in sRGB, as `color-mix` does. A brand drops a preset's derived tokens so they follow the brand, and keeps its type and shape. MCU pinned to 0.3.0: 0.4.0 ships ES modules with extensionless imports that Node can't load. The input type is `BrandInput`, since the shell already has a `Brand`.
- 2026-10-04: Phase 2 built. `setLook` lets an operator pick any client, the demo's too, so the demo can show a look; anyone else must be an owner of the client they pick (`isOwner`, moved from delivery to core). The look is stored as sent after a shape and size check (4000 characters of JSON); `readTheme` drops what it can't use on read. `delivery/me` carries each client's look, and the portal themes the open workspace with it. Wren's own workspace has no `clients` row, so it keeps Wren's look. `?theme=night` still tries a preset over the stored look; `?theme=` with nothing drops the try (`?theme=wren` now pins Wren's). The migration took the next free number.
