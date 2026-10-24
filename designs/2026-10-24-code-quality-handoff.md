# Code quality sweep: handoff (2026-10-24)

A fresh session (cloud, Fable) reads this first. Goal: less duplication, clean layers, easy to find, easy to extend. Build each fix; do not only list it.

## William's prompts (2026-10-24)

> just checking code quality. surely all these components are globalized so that changing such an icon would require at most 1 or 2 changes, and it would propagate across all the pages correct? just making sure code is maintainable.

> lets suggest plans for making the code better. this was a gap, theres probably more gaps that are unnecessarily creating code bloat and complexity.

> a handoff doc with my prompts and info about reducing duplication, DRY, SOLID principles, shared interfaces from high level to low level (dependency SOLID principle) and supporting extensibility, organizing packages well so things are easy to find and theres not insane levels of nesting on a package level but on a code level abstractions are clean

## What started it

Row actions and 20 files drew Lucide icons direct, past the registry. A change to one icon needed many edits. Fixed in ea1bd2c4:

- Every icon has a name in `packages/ui/src/icons.tsx`. `lib/lucide.ts` is gone.
- `biome.json` `noRestrictedImports` stops a `lucide-react` import outside `icons.tsx`.

The pattern to repeat: **one owner per concern, and a lint rule that keeps it one.** A fix without the rule drifts back.

## Known gaps

Built 2026-10-24 (session 2, Fable), each with its guard in the same commit:

| # | Gap | Done | Guard |
|---|---|---|---|
| 1 | Three vendored parts drew Lucide direct; biome skipped their folder | `dialog`, `sheet`, `command` draw through `Icon`; `components/ui` is formatted and linted like the rest; the parts import each other by relative path | the `lucide-react` rule now sees the folder |
| 2 | Row action icons came from a regex on the label | `Action.icon` (and a hand-drawn row's `RowDo.icon`) names it; none means behind ⋯. Every action literal names its icon (a codemod gave each the icon the table had read off its label). `VERBS` and `iconOf` are gone | TypeScript: `icon` is an `IconName`; `kit-door.test.ts` checks icons named as data |
| 3 | Other vendors bypassed their wrapper | Census of every vendor import by package (below). Only sonner leaked inside the kit (8 files imported `toast` past `lib/toast.ts`); `toast.ts` sits at the package root now, exported as `@wren/ui/toast`. The rest were already behind one package | one `noRestrictedImports` set in `biome.json`: lucide → `icons.tsx`, sonner → `toast.ts`, Base UI and cmdk → the kit, `@wren/reactivation` → not from a foundation. The grep test that did the vendor half is deleted |
| 4 | Three flaky stories; `push.sh` misread a run | Client Failed: a refused read retries once after 1 s and `settled()` returned in the gap; it now waits while any query fetches. Player Expanded: the player stories replaced `play` and so skipped the settle wait every page story has; they pass a `check` through `pageAt`. Map Draft View: the map redraws after Close; the check waits for it. `push.sh` reads the latest attempt's jobs as `deploy.sh await_gates` does, a failure outranks fail-fast's cancels, nothing is final while a gate runs | the waits are in the fixtures every story shares (`settled`, `pageAt`) |
| 5 | Very big files | `packages/delivery/src/index.ts` (1946) is six files by job (`rows`, `work`, `moments`, `invoices`, `onboarding`, `views`); `index.ts` is the public face, the same names as before, nothing new exported. Map cards repointed. The other six are split the same way (table below, with what each became) | `gates.sh size`: no source file over 1200 lines, with `scripts/big-files.txt` the shrinking list of the ones still over it |
| 6 | 114 lint warnings hid new ones; `recommended` deprecated | All cleared. Warnings fail lint (`biome check --error-on-warnings`, in `gates.sh` and `pnpm lint`). Tests may use `!` on their fixtures; `scripts/` run by hand so turbo's env list does not apply to them; `preset: recommended` | CI is red on the next warning |
| 7 | Layers checked by eye | `scripts/layers-guard.mjs`: four layers in one table, a package imports its own layer or lower, no cycle. In the lint gate (`gates.sh layers`). A new package is one row | the script |

### Vendor census (gap 3)

Every third-party import, by the packages that hold it (tests and stories apart): `drizzle-orm`, `zod`, `react`, `commander`, `@restatedev/restate-sdk` everywhere they belong; `postgres` only in `db`; `pino` only in `apps/worker`; `better-auth` only in `auth`; `@tiptap/*` and `yjs` in the portal's editor and `notes`; `@base-ui/react`, `cmdk`, `sonner`, `recharts`, `@xyflow/react`, `elkjs`, `motion`, `react-hook-form`, `@tanstack/react-query` only in `packages/ui`; `@tanstack/react-router` only in the portal; `@restatedev/restate-sdk-clients` in `apps/cli` (22 files) and one in `core`. Two to watch, not worth a rule yet: `@aws-sdk/client-s3` is built the same way in five packages (`o.client ?? new S3Client(o.region ? { region } : {})`): a `core` helper would save five lines and one shape; and `cn` (clsx + tailwind-merge, 48 files) sits beside the kit's own `cx` (a plain join, 72 files). They differ: `cn` resolves Tailwind conflicts, `cx` joins SVG and flag classes. Keep both, say which is which where it matters.

### The six big files (gap 5, built 10-24)

Each a pure move in its own commit, no behaviour change, typecheck and unit green before and after; the plan column says what was meant, the last column what landed. The delivery split is the pattern: assign each top-level statement to a file by the section comments already in the file, export what a sibling needs, keep `index.ts` as the public face with the same names. (The one-off script that did it read the TS AST; ~80 lines; rewrite it, do not keep it.)

| File | Lines | Split | Landed |
|---|---|---|---|
| `packages/core/src/console.ts` | 4001 | by record kind, as its sections run: `restate-admin.ts` (the admin client, `runningLoops`), `loops.ts` (`loopsOf`, `loopRecord`, `eventRecord`), `executions.ts` (`executionSteps`, `executionRecord`, holds, checks), `handlers.ts` (`handlersOf`, `inputSchemaOf`, `formOf`, `handlerRecord`), `settings.ts` (`settingsForm`, `settingRecord`, `builtWords`), `components.ts` (`componentRecord`), then `console-api.ts` (`consoleApi`, 1600 lines: one handler group per file under it if it still reads long) and `console-portal.ts` (`makeConsolePortal`). The request interfaces go with the record they belong to | a folder, `console/`, with `console.ts` the face: `restate-admin`, `loops`, `executions`, `handlers`, `settings`, `components`, `console-portal`, and `console-api.ts` (2158, still over the line: `consoleApi` is one function whose handlers close over ~450 lines of helpers, so a cut by handler group needs a context object, not a move; on the list) |
| `packages/ui/src/records.tsx` | 3411 | by part: `records-types.ts` (the interfaces and `tiersOf`), `records-columns.tsx` (`columnsOf`, `widthsOf`, `fitColumns`, `dockedOf`, `shownColumns`), `records-list.tsx` (`RecordList`, `ListSkeleton`, `Bulk`), `records-panel.tsx` (`Panel`, `PeekWire`), `records-page.tsx` (`RecordPage`, `RecordBody`, `Quiet`), `records-swipes.ts` (`swipesOf`, `withReply`). `records.tsx` stays the barrel the kit's index imports | as planned; `ListSkeleton` sits in `records-columns.tsx` so page needs nothing from list (no cycle). Largest part `records-list.tsx` 1163 |
| `apps/worker/src/services.ts` | 3002 | one function, `buildServices`, that wires every service. Split by domain into `services/<domain>.ts`, each exporting `(deps) => services[]`, and `services.ts` the list that concatenates them: a new domain is one file and one row. The `Services` interface stays; `servicesFor` and `POOL_CHAIN` stay | `services/<domain>.ts` × 18 exporting `<domain>Services(deps)`, `services/deps.ts` (971) holding `buildDeps` for everything two domains share, `services.ts` (133) the list. Same 124 services, same summary; the one wiring change is ConsolePortal's `bound`, now a closure over the final list passed into `buildDeps` |
| `packages/outreach/src/restate/index.ts` | 2473 | the three objects it already names: `sender.ts` (`makeReachSender`), `watch.ts` (`makeReachWatch`), `desk.ts` (`makeReachDesk`, 1150 lines: its views and the settle step can be `desk-views.ts` and `desk-settle.ts`), `deps.ts` (`ReachDeps`, `clientDeps`, `channelsFor`) | `deps`, `sender`, `watch`, `desk`; then `desk.ts` (1522) became `desk-context.ts` (`deskContext(deps)`: the shared closures, built once) plus one file per handler group that takes it (`desk-accounts`, `desk-contacts`, `desk-threads`, `desk-comments`, `desk-invites`, `desk-posts`, `desk-settle`, `desk-people`, `desk-schedule`, `desk-stats`), `desk.ts` the 46-line face |
| `apps/portal/web/src/modules/marketing/index.ts` | 2181 | by record type, as the `*_ACTIONS` constants run: `dm.ts`, `places.ts`, `accounts.ts`, `invites.ts`, `connect.ts`, `threads.ts`, `engage.ts`, `pages.ts` (the page records), with `index.ts` the module definition that lists them | by object, as the actions run: `drafts` (root), `dm`, `comments`, `video`, `places`, `social` (accounts, invites, connect), `threads`, `inbox`, `approval` (with the draft boxes), `engage`, `pages`, `modules`; `index.ts` re-exports the same 21 names |
| `apps/portal/web/src/modules/marketing/finish.tsx` | 2102 | one component, `Finish` (780 lines of JSX) and its helpers: `finish-strip.tsx` (the frame strip), `finish-caption.tsx` (`ShownCaption`, `OverlayText`), `finish-data.ts` (`FinishEdit`, `FinishData`, `shownOn`), and `Finish` itself split along its tabs | `finish-data`, `finish-hooks`, `finish-stage`, `finish-caption`, `finish-timeline`, `finish-panels`; `finish.tsx` (552) keeps `Finish` whole: splitting a component along its tabs is a restructure, not a move |

**A file-size gate.** `gates.sh size` (in `lint` and `checks`): no source file over 1200 lines, read off `git ls-files | xargs wc -l` (tests, stories and drizzle apart). The files still over it on the day the gate went in are listed in `scripts/big-files.txt`, and the list only shrinks: a new file over the line fails, and a listed file split below it leaves the list (the gate diffs the two, so a stale entry fails too). The number is a tripwire, not a target: a file a third of that is still worth reading twice.

### Decisions (2026-10-24)

- Explicit over inferred: an action's icon is a field, not a reading of its label, even at +1 line per action (177 of them). A rename cannot move an icon, and there is no first-match ordering to keep straight.
- `components/ui` is ours: formatted and linted like the rest. A re-vendored part gets `biome check --write` once. The `InputGroupAddon`'s mouse-only click (focus the box) went: a static element with a click handler is an a11y finding, and the keyboard reached the box by Tab already.
- The vendor door is a lint rule, not a grep test: one owner per concern and a rule that keeps it one; a test that re-reads the repo is a second place to maintain.
- `settled()` means no call out and no query fetching. A retry's back-off is still fetching.
- `push.sh` and `deploy.sh` read the gates alike (the latest attempt's jobs, failure over cancelled); the python went, one jq program stays.
- Package layout: `packages/` is one level deep and stays so; inside `ui/src` the deepest folder is now two (`metro/lab`, `components/ui`); `lib/` (one file) is gone.

## Principles to apply

**DRY.** One fact, one place. Two copies of the same rule is a bug waiting. But do not merge two things that only look the same today: merge when they change for the same reason.

**SOLID, in this repo's terms:**

- **Single responsibility.** A file or module has one reason to change. A 3,000-line file has many.
- **Open/closed.** Add a new channel, kind or action by adding a file or a table row. Do not edit a central `switch`. Registries (`ICONS`, the channel list) are the model.
- **Liskov.** Every adapter behind an interface keeps the interface's promise. A fallback answers the real API's shape (memory: grants and shared interface).
- **Interface segregation.** Small interfaces that a caller needs. Not one wide `Services` object passed everywhere.
- **Dependency inversion (the main one).** High-level code (campaigns, pipeline, products) depends on interfaces it owns. Low-level code (Postgres, Restate, vendor SDKs, autobrowse) implements them. The composition root (`apps/worker`, `apps/cli`) wires them. Arrows point down to `core`; a foundation never imports a product (the `@wren/reactivation` rule in `biome.json` already does this for one package).

**Extensibility.** A new channel or app plugs in through the same seam as the others: a type, a registry entry, an adapter. If adding one needs edits in five files, the seam is missing.

## Package layout

Target: **flat at the package level, clean at the code level.**

- Today: 40 packages under `packages/`, 8 apps. `packages/` is one level; keep it so. No `packages/channels/x/...` nests.
- Inside a package, at most 3 levels of folders under `src/`. Today `ui/src` goes 8 deep and `studio/src` 7. Flatten where a folder holds one file.
- A package name says what it owns. Its `index.ts` is its public face; others import only that (or named `exports`), never deep paths.
- Group by domain, not by kind: `channel-sms/src/send.ts`, not `src/services/sms/sendService.ts`.
- Check the layers with a tool, not by eye. Option: `dependency-cruiser` (MIT, widely used) for "foundation never imports product" and "no cycles" across all packages. Biome rules cover single imports only.

## How to work

1. Read `CLAUDE.md` and `map/routing.md`. Use the map: one hub, one card.
2. Pick one gap. Build the fix and its guard rule in the same commit.
3. While you build, check with `./scripts/gates.sh changed`. Run the full gate once at hand-off.
4. Commit with `git commit -m ... -- <paths>`; push with `sh scripts/push.sh <sha>`.
5. The repo is public: no lead data, amounts, client names or secrets.
6. A large refactor (split a 3,000-line file, move a package) gets a short plan in this file first.
7. Node 24 is the repo's engine. On 22 the toolchain still runs, but `tsc` on the portal needs `NODE_OPTIONS=--max-old-space-size=8192` (it dies at the 2 GB default).

## Out of scope

Security review (separate audits). New features. UI look (the Design Language artifact owns it).
- Splits are moves, not redesigns: a file over the line is cut along the seams it already has (sections, objects, domains), each statement verbatim, the face re-exporting the same names. Two files stayed over the line (`console-api.ts`, `desk.ts`) because their next cut is a restructure of one function's closures: `desk.ts` was restructured 10-24 (a context object built once, one file per handler group taking it, the 53 handler names proved unchanged by an AST walk before and after), and `console-api.ts`, the other, takes the same cut; the ratchet list carries it until then.
