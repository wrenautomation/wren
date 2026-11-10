# Astryx trial (WA-1278)

William, 11-10: "i just wanna see if its good. the goal is to optimize our design." No swap without his call.

What: the client Team page (`modules/account/People.tsx`) rebuilt with Astryx 0.7.12 parts (Table, Badge,
Button, Avatar, TextInput, Selector, MoreMenu, Heading, Text, stacks). Lab stories in the portal
Storybook, beside `Client/Back office/Team`:
- `Lab/Astryx Team/Stock`: Astryx's neutral theme.
- `Lab/Astryx Team/On Wren Tokens`: the same parts, Astryx tokens pointed at our `--ui-*` (`stories/lab/astryx-bridge.css`).
Astryx is a portal devDependency only. Prod does not load it.

## Findings

| Check | Result |
|---|---|
| Look | Clean and calm by default. On our tokens it reads as Wren in both looks with one 40-line CSS block. |
| Theming | Good fit. Its tokens are CSS variables with `light-dark()`; ours flip by look, so one bridge serves day and night. `defineTheme` is the full path (typography scale, radius, motion). |
| Phone (390) | Weak. Table has no phone layout: the actions column runs off the edge and emails break mid-word. Ours hides columns and stacks the row. A phone layout would be ours to build. |
| Our row model | Missing. No row that opens its detail under it with our access panel, no row state (Removing), no confirm in the row. Table has an expansion plugin; the rest is ours. |
| Bundle | 12 parts: 700 KB min, 236 KB gzip JS (theme 81, motion 79, hooks 59, BottomSheet 53 via MoreMenu). CSS 316 KB, 48 KB gzip (all parts, prebuilt). Portal main is 932 KB gzip today. Per-part StyleX compile would cut the CSS; the JS floor stays. |
| a11y | axe clean on contrast in both looks. One fail was mine (an empty header). Labels, required marks and focus come built in. |
| Agent CLI | Strong. `astryx component <Name> --dense`, `docs <topic>`, `build "<page>"`, `search`, `--json` on all. Same shape as our CLIs. |
| Coexistence | Its `reset.css` and three layers sit after Tailwind's layers, so they win over ours inside the page. A partial adoption needs the reset dropped or scoped. Button `sm` sets a 28 px height over 36 px of padding and line (box-fit flags it; the text still fits). |
| Maturity | Beta, 0.7.x, React 19, MIT, Meta. Breaking changes are likely before 1.0. |

Fresh-eye review (Sonnet, 12 shots): the token build is the calmest at 1280 (even rows, one accent,
nothing nested). Ours is the only one that holds at 390. Astryx is worse on phone reflow, small meta
type (12 px) and actions repeated per row. The bridge left dark fields with almost no fill: map
`--color-background-muted` to a stronger well before any real use. Not like-for-like: the trial has
no shell, no open row, no grants.

## Options

| Option | Gain | Cost |
|---|---|---|
| A. Keep @wren/ui, borrow ideas | no migration; take its token names, CLI shape, doc format | no new parts for free |
| B. Astryx for new leaf parts only (date, command palette, carousel) on our tokens | parts we lack, themed as ours | +236 KB gzip floor, two reset stacks, two part styles side by side |
| C. Move @wren/ui onto Astryx | one maintained base, its CLI for agents | rebuild PageRows, rows, phone layouts; beta churn; bundle |

Pending William's call. My pick: A, then B for a part we would otherwise build from zero.
