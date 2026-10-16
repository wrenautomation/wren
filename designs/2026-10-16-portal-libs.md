# Portal on libraries: router, tables, forms

2026-10-16, P1 (bead wa-1o6). William: "as long as its free and we can continue our self hosting paradigms, and make sure our code is properly componentized to reuse across the board."

The portal's routing, lists and forms were hand-rolled. They move onto TanStack Router, TanStack Table (with TanStack Virtual) and React Hook Form. All MIT, all bundled into the portal's own build, nothing hosted. One shared piece each, in `@wren/ui`. A guard keeps new code on them.

## Router

`@tanstack/react-router`, code routes in `apps/portal/web/src/router.tsx`: `/`, `/$app`, `/$app/$page`, `/$app/$page/$`.

- The address keeps its plain shape. A flat `parseSearch`/`stringifySearch` means every old link, mail link and saved view still opens.
- Search is typed once: `LIST_SEARCH` (zod, `packages/ui/src/list-search.ts`). A bad `pg` or `as` drops; the page still opens.
- Old page addresses (`ListPage.legacy`) redirect in `beforeLoad`.
- Loaders read ahead through the existing Query keys (`me`, a list's rows via `prefetchList`). Hover on a link preloads.
- `route.ts` keeps `href`, `navigate`, `go`, `useRoute` as thin calls over the router, so pages didn't change. `history.state.from` still feeds the phone's back.
- `@wren/ui` stays router-agnostic: links are plain `<a href>`; the router catches in-app clicks and hovers (`inApp`).

## Tables

`@tanstack/react-table` and `@tanstack/react-virtual`, in `packages/ui/src/table.tsx`.

- `useListTable`: the record list's model. Sort maps to the address `sort` (`sortingOf`). Column order, visibility and width are the list's kept prefs. Grouping draws group heads. Rows are the server's: a fold (one row standing for many) stays one row; tiers ("Needs you", "For info") are a grouping.
- `useLines`: virtual rows once a list passes `VIRTUAL_FROM` (120). Below that, every row renders, so find-in-page works.
- `DataTable` for any list that isn't a record list (Drive, Numbers, Sequences, Channels, Import, draft models). `FactsTable` for label/value facts (sites detail, split, forms).
- Per page 50/100/200 (`size` in the address). Picked rows ride in the history entry (`ENTRY`), so back brings the pick back.
- Prefs and saved views read through the data layer (`keepOf`, keys `keep:<key>:prefs`, `keep:<key>:views:<record>`), kept 5 min.
- Left as plain tables, marked `table-ok:`: an estimate's line items (`documents.tsx`, the document's own layout), the contrast report (`look.tsx`), and the record list's own rows (`records.tsx`, drawn from `useListTable`).

## Menus open on hover

William, same day: every filter, group-by, sort and view menu in the list bar opens on hover, nested ones too, with a safe triangle and a short close delay. Click and keys keep working; touch stays tap only.

- Base UI's Popover (already in `@wren/ui`) does it: `openOnHover`, `delay`, `closeDelay`, a built-in safe polygon, mouse only. Nested popovers share one floating tree, so a submenu holds its parent open.
- `packages/ui/src/hover-pop.ts`: `useHoverPop`, `useSubmenus`. Hover only where `(hover: hover) and (pointer: fine)`. A popup with focus in a text box doesn't close on hover out. Opens after 120 ms (100 ms nested), closes 200 ms after leaving.
- Used by every list bar menu: views, saved views, Save view, filter pills, the Filter picker and its per-field submenus, Display, the account filter. Sort is the column heads; it has no menu.
- Not moved: the sidebar's flyouts (`safe-triangle.ts`). They work and aren't list menus.

## Forms

`react-hook-form` with `@hookform/resolvers` (zod), in `packages/ui/src/edit-form.tsx`.

- `useEditForm({ key, defaults, schema?, base? })`: RHF's `useForm`, plus unsent values kept in the edits store under `key`. Switch page, reload or close the tab: the values come back ("Your unsaved changes are back", Discard).
- The starting point moved under kept values (someone else saved): `FormKept` shows both, Keep mine or Use saved. Kept values whose starting point the server has since caught up to (the send landed) come back quietly.
- `form.onSend(send, { clear? })` is the submit: checks the schema, runs `send` through the page's existing write call (the one write path), forgets the kept values once it lands. A refusal keeps them and shows the reason. `clear` starts an add form over.
- One field set: `TextField`, `TextAreaField`, `SelectField`, `CheckField`, `ChecksField`, `RadioField`, `DateField`, `MoneyField` (`centsOf`), `AccountField`. Each marks its box `data-edit` for the edits guard.
- `SelectField` options can be disabled ("Pick one"). Text fields take a caller `ref` and `onChange`.
- `forgetKept(key)` drops kept values from outside the form (a send that ran elsewhere).
- A one-box form (search, ask, reply) stays on `useEdit`; that is the edits store already.
- Left on their own hooks: versioned documents (`documents/documents.tsx`, `sites/forms.tsx`) on `useSaved`. Rows of fields (board columns, pipeline stages) use `watch`/`setValue`; no shared rows field yet.
- Old per-field kept words don't carry over to a form's single key: they start empty once.
- Retired: `FormData` reads off the page, `resetSent`, `field()`, `useKeptForm`/`forgetForm`.

Fixed on the way: other tabs only hear named, kept reads (`sharedOnly` in `data/local.ts`). A page's own read holding functions (Learn's nav) threw `DataCloneError` on every broadcast.

## Guard

`scripts/libs-guard.mjs`, in `gates.sh` `checks` and `lint`, over the same sources as the edits and reads guards (`portal-sources.mjs`). It fails on:

- `history.pushState`/`replaceState` or a `popstate` listener outside `route.ts`/`router.tsx` (`route-ok:` to excuse);
- `<table>` outside `table.tsx` (`table-ok:`);
- `new FormData(<form>)` or `useKeptForm` (`form-ok:`); an upload's `new FormData()` is fine;
- a `<form>` in a file with no `useEditForm` (or `useEdit` for one box).

## Tests

- Unit: `list-search.test.ts`, `route.test.ts`, `table.test.tsx`, `hover-pop.test.tsx`, `edit-form.test.tsx`.
- E2E on the local preview, synthetic data, 1440 and 393 (`apps/portal/scripts/libs-e2e.ts`, seed `packages/content/test/libs-preview.ts`): URL round trip, a 600-row virtual list, column order, hover menus with a diagonal move into a submenu, tap only on a phone, a form's values kept across a page switch.
- `pnpm e2e:writes` and the threads e2e still pass.
