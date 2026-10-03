# Console and UI stack

Living doc. Started 2026-10-03. Revise in place and log changes at the bottom. Builds Now #1 of `2026-10-03-direction.md`. Runs after `2026-10-03-database-audit.md` ships.

## Why

William runs Wren and sells what he runs it on. The portal is where he and a buyer look, and today it shows only the demo client's reactivation and delivery. The console adds Wren's own business. Two asks shape how:

- Stop hand-writing UI components. `@wren/ui` is 2,900 lines of custom React and 2,900 lines of custom CSS, and has no charts, no sortable tables and no forms.
- Build it on patterns that scale: widgets that compose, workflows shown as components, and access that can later sit behind a paid tier.

## Stack

| Layer | Pick | License | Replaces |
|---|---|---|---|
| Components | shadcn/ui on Base UI, its default since July 2026 | MIT | `kit.css` and the hand-built controls |
| Styling | Tailwind v4 through `@tailwindcss/vite` | MIT | `kit.css` rules, one component at a time |
| Charts | shadcn chart, which wraps Recharts | MIT | nothing yet |
| Tables | shadcn data table on TanStack Table | MIT | `Table`, `Pager` |
| Command palette | shadcn command, which wraps cmdk | MIT | nothing yet |
| Toasts | sonner | MIT | nothing yet |
| Icons | lucide-react | ISC | `icons.tsx` |
| Internal forms | AutoForm (`@autoform/zod`), from a handler's zod schema | MIT | nothing yet. Used by the form per handler (Next #4) |
| Workflow graphs | React Flow (`@xyflow/react`), when a flow becomes editable | MIT | `flow.ts` layout, later |

shadcn copies component source into our repo through its CLI. The code is generated and owned, so a client theme can restyle anything and no upstream release breaks us. Blocks (dashboards, sidebars, data tables, KPI cards) install the same way, so pages get assembled instead of written. Coding agents also know its components well, which matters because Claude Code builds most of this.

What others ship on:

- Supabase's UI library is built on shadcn/ui.
- Cal.com's design system, coss ui, is built on Base UI and installs through the shadcn CLI.
- Vercel bought Tremor in January 2025 and made all of its dashboard blocks free. They are Recharts with Tailwind, so they copy in as chart and KPI patterns.
- Langflow and Flowise draw their workflow canvases with React Flow.

Rejected:

| Option | Why not |
|---|---|
| Mantine (MIT) | Strong and batteries included, but it styles through its own system. Fewer blocks, and a client brand fights its defaults |
| MUI, Ant Design | Heavy, with a recognizable admin look. MUI's best grid features are paid |
| React Aria alone | Excellent accessibility but unstyled, so more assembly. shadcn blocks can use it later if needed |
| AG Grid Community | More grid than we need. Our tables page through the server. Take it only for spreadsheet-style editing |
| Tremor's npm package | The copy-paste blocks are the maintained path |

## Architecture

Six patterns, each one already half present in the portal. The work is to make each explicit and use it everywhere.

### 1. Registry (plugin)

Every app registers itself in `MODULES`. The portal composes apps, apps compose product code, and `@wren/ui` knows no product. This is the wren layer rule (foundations know no clients, products never import each other) applied to the UI. Nothing changes here except that new apps follow it.

### 2. Composite pages

A page is a tree of nodes. A node is either a widget or a group, and a group holds nodes:

```ts
type Node = Widget | Group;
interface Group { kind: "group"; title?: string; layout: "row" | "grid" | "stack"; children: Node[]; requires?: Access }
```

One renderer walks the tree. Pages become data: a client's layout, a demo's layout and the console's layout are different trees over the same widgets. A page with one-off needs can still be a plain component, which is a leaf in the tree.

### 3. Widgets

A widget is the unit everything else is made of:

```ts
interface Widget<T> {
  kind: "widget";
  id: string;                 // "outbound.funnel"
  title: string;
  source: Source<T>;          // where its data comes from
  View: ComponentType<{ data: T; size: Size }>;
  size?: Size;                // "s" | "m" | "l" | "full"
  requires?: Access;
}
type Source<T> = { view: string; params?: object } | { handler: string; input?: object };
```

A widget never fetches on its own. Its `source` names an allowlisted view or a portal handler, and the renderer loads it with the client id. The same widget then shows up on a page, on an app card's glance, in a recorded demo, and as a CSV export, with no second copy.

### 4. Actions (command)

An action is a handler plus what the UI needs to offer it: `{ id, label, handler, input: ZodSchema, requires?, confirm? }`. A button, the ⌘K palette and a generated form all read the same action. The CLI and agents call the same handler, so one zod schema describes the operation everywhere. This is "one definition, many faces" from the direction plan.

### 5. Workflows as components

A workflow (a Restate handler, a loop, an autobrowse flow) shows up in three places:

- an action to start it
- a widget for its status (last run, next run, paused or not)
- its run, drawn as the `RunView` trail that already exists

When a workflow needs editing, its graph moves to React Flow. Until then `flow.ts` stays.

### 6. Access (policy)

Access answers three questions about any node, page, app or action:

- Audience: team, signed-in client, or demo.
- Role: owner or member, which the delivery service's `read()` already checks.
- Feature: whether the client's plan includes it.

```ts
type Access = { audience?: "team" | "client"; role?: "owner"; feature?: string };
function can(viewer: Viewer, access: Access | undefined): boolean;
```

The Restate portal service enforces it. It already refuses team routes to non-operators, so `can` joins that check. The UI only decides how to show the answer: hidden, or locked with a line on what the feature does and a link to book a call. No prices on pages, per the offer rules.

Features come from offers. An offer lists the features it grants, and a client's active engagements grant theirs. Bought offers already decide which app cards a client sees, so this generalizes what exists. `team?: true` and `noDemo?: true` on `Module` and `ModulePage` become `requires`.

### Data

One portal service, `ConsolePortal`, serves allowlisted views by name for a client id, as JSON or CSV. Each package exports the views it allows, and the service composes the lists, so core never names a product's view. Team-only at first. Wren's own numbers come from the main database. Client #1's will come from their database through the same path reactivation uses.

### Theme

Theme tokens stay the source. A theme writes shadcn's CSS variables from them: `canvas` to `--background`, `paper` to `--card`, `ink` to `--foreground`, `ink-2` and `ink-3` to `--muted-foreground`, `accent` to `--primary`, `on-accent` to `--primary-foreground`, `bad` to `--destructive`, the radius tokens to `--radius`, and the chart palette to `--chart-1` through `--chart-5`. A client brand stays a row of data.

## Phase 1 scope

1. Install Tailwind v4 and shadcn (Base UI) into `packages/ui`. Load Tailwind without its preflight reset, so pages still on `kit.css` look the same. Map theme tokens to shadcn variables.
2. Add the chart, data table, command, card, badge, tabs, sidebar and sonner components through the shadcn CLI. Wrap the chart once so the theme colors it.
3. Re-implement the `@wren/ui` exports the shell and the Pipeline page use on shadcn parts, keeping their names and props, so product code doesn't change. Delete each `kit.css` rule the moment nothing uses it.
4. Add the `Node`, `Group`, `Widget`, `Action` and `Access` types and the renderer to `@wren/ui`, plus `can()`. Replace `team` and `noDemo` with `requires`.
5. Build `ConsolePortal` with one route, `view`, and register it in the portal worker's `SERVICES`.
6. Build the Pipeline app, team-only, as a widget tree: the funnel from the direction plan as a stat strip, a per-niche funnel chart, and a leaks table (catch-all, risky, waiting in the resolution queue, crawled with no named person), each with CSV export.
7. Add the ⌘K palette, listing apps and pages. Actions join it as they are built.

Out of Phase 1: the Outbound, Money, Loops and Inbox apps (each a later phase on these parts), the form per handler, React Flow, and features on offers. The `feature` field exists from step 4, but no offer lists features until a paid tier differs.

## Done when

- Pipeline renders in team view on the app host with prod numbers, and its CSV matches the view.
- Existing reactivation and delivery pages look unchanged in the demo, checked by recording the demo video.
- `./scripts/gates.sh` passes.
- The portal bundle size before and after is noted here.

## Risks

- Tailwind and `kit.css` side by side. Skipping preflight and moving component by component keeps both working. The risk ends when `kit.css` is empty.
- Bundle size. Recharts adds roughly 100 KB gzipped. Load chart pages lazily.
- Look. shadcn's defaults are recognizable. The theme tokens and the impeccable finish review keep the portal looking like Wren's product.

## Decision log

- 2026-10-03: shadcn/ui on Base UI with Tailwind v4 chosen over Mantine, MUI, Ant Design and a bare React Aria. Composite pages, widgets, actions and one access check adopted as the portal's patterns. Features on offers designed now and built when a paid tier differs.
