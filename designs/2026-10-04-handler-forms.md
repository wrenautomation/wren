# Handler forms

Living doc. Started 2026-10-04. Item 4 ("Next") of `2026-10-03-direction.md`. It builds on `2026-10-03-console-standard.md` (records, templates, actions) and logs changes at the bottom.

## Why

Prod has 49 Restate services and 316 handlers. The portal reaches a few dozen through the apps. Everything else needs `node scripts/ingress.mjs` and the right JSON from memory. One page that turns any handler into a form makes the whole system usable from the portal, and gives an agent the same list.

## What it is

- **Handlers**, a team-only app in Wren's workspace. A List of every handler, grouped by service. Opening one shows its form, and the last answer under it.
- The list comes live from Restate's admin API (`/services`), so a new handler shows up with no list to update. Each handler's input schema comes from `/services/<name>/openapi`.
- A handler declares its input with zod through `restate.serde.schema(...)`. Restate then validates the input and publishes the schema. The form is built from that schema. A handler with no schema gets one JSON box.
- A press calls `ConsolePortal.call`, which invokes the handler with `ctx.genericCall`. The call is durable, journaled, and the admin token never leaves the worker.

## Rules

1. **Operator only.** The app and `call` require the operator, as `addClient` does. The demo and clients never see it.
2. **Never by hand stays never.** Handlers that must not be called from outside get `ingressPrivate: true`, so Restate itself refuses them at ingress:
   - `Resolution/resolve` (wren's hard rule: queue it).
   - Every loop's `loop` handler (the factory in `packages/core/src/restate/loop.ts`, and any loop not built on it).
   - A handler only another service calls, when grep shows no ingress caller. List each one in the decision log.

   An internal call skips `ingressPrivate`. So `call` reads the handler's `public` flag from the admin API and refuses one that isn't, and the list hides it.
3. **Effects are marked.** A handler that spends money, sends to a person, or posts in public carries `metadata: { effect: "spends" | "sends" | "posts" }`. Its form names the effect and asks for the handler's name typed in before it runs. Existing guards (spend grants, send gate, kill switch) still apply inside the handler.
4. **Portal backends are hidden.** `*Portal` services are the apps' own backends. Their pages are their form.
5. **Every call is a run.** `call` writes a `runs` row: command `console <Service>/<handler>`, the input as argv, the viewer's email, the outcome. It shows on the run trail like a CLI command.
6. **Schemas never change what a handler gets.** Objects are `z.looseObject`, so a field the schema forgets still reaches the handler. Each schema mirrors the handler's TypeScript input type, with `.describe()` on any field whose name doesn't explain it.
7. **autobrowse's services** (`sites`, `desk`, `do`, `browser`, `domain`, `bootstrap`, `Compiled`) are listed like the rest. Their schemas belong to autobrowse (seam: platform calls), so until it adds them they get the JSON box.

## The form

`FormField` (`packages/ui/src/action.tsx`) already drives form actions. A JSON schema maps onto it:

| Schema | Box |
|---|---|
| string | text; `format: date` a date, `uri` a url, long `description` hint |
| number, integer | number |
| boolean | a switch |
| enum | a select |
| array of strings or numbers | one per line |
| object | its fields, labelled `parent.child` |
| anything else | a JSON box for that field |

Required fields come from `required`. A field's label is its `title`, else its name in words ("openersPerDay" → "Openers per day"). A virtual object's handler asks for its key first.

The answer shows as a record when it is an object, else as JSON. An error shows Restate's message as-is.

## Phases

### H1. The server

1. A GET helper beside `restateAdmin` for `/services` and `/services/<name>/openapi`, cached 5 minutes in the worker.
2. Record type `console.handler`: service, handler, kind (service, object, workflow), needs key, public, effect, has schema. Views: All, With a form, Effects.
3. `ConsolePortal.call {service, handler, key?, input}`: operator only, refuses non-public and `*Portal` handlers, invokes with `ctx.genericCall`, writes the runs row.
4. `ingressPrivate` on rule 2's handlers. Each change is checked against callers first (`scripts/`, the CLI, autobrowse, the lander).
5. Tests on synthetic data: refusals (not operator, not public, a Portal service), the runs row, the schema-to-fields mapping.

### H2. Schemas and effects

1. zod input schemas for the handlers William uses: EmailConsole, SmsDesk, ReachDesk, Ads, Content, ContentDesk, Disposition, Runs, Resolution, Enrichment, Discovery, LinkedinInbox, QueueRefresh, SearchWeek.
2. The loop factory's `start`, `stop`, `status` and `sync`, once, so every loop gets them.
3. `effect` metadata, at least on: Ads `launch` and `start` (spends), EmailConsole `approve` (sends), SmsDesk `enroll` and sends (sends), Content `publish` and `reply` (posts), ReachDesk `reply` and `enroll` (sends).
4. A test that every public wren handler outside the Portal services declares an input schema, or is named in an allowlist with the reason.

### H3. The app

1. The Handlers app on the standard: List, Record panel with the form, the last answer.
2. `FormField` gains the types in the table above. The Clients form keeps working.
3. The effect confirm.
4. Screenshots at 1360 and 390 as the operator: the list, a loop's `status`, an EmailConsole form, an effect confirm (cancelled, never sent).

## Done when

- Every public wren handler outside the Portal services opens to a form built from its schema.
- `Resolution/resolve` and every `loop` refuse at ingress and are missing from the list.
- A call from the page shows on the run trail with who made it.
- Gates pass. No email, SMS, post or spend happened while testing.

## Risks

- A schema stricter than the callers. Loose objects, schemas copied from the types, and the deploy's own loops passing are the check. Watch the worker log for serde errors for a day.
- `ingressPrivate` on a handler a script calls. Grep before each one; the CLI's errors would name it.
- One page that can call anything. Operator only, public only, effects confirmed, every call a run.

## Decision log

- 2026-10-04: Written. The list is read from Restate, not declared, so it can't drift. A handler marked `ingressPrivate` disappears from the page and stops answering at ingress.
- 2026-10-04 (H1): `call` asks for the handler's name typed in (`confirm`) when it has an effect. The page asks it; the server checks it too, so no client skips it.
- 2026-10-04 (H1): `call` asks a key for an object or workflow and refuses one for a plain service, before the call.
- 2026-10-04 (H1): The record has no `public` column. It lists public handlers only, so the column would always say yes.
- 2026-10-04 (H1): The detail carries the input schema and `form`, the schema mapped to boxes per the table above (`formOf`). H3 renders `form`. A nullable field is optional. No fields means the JSON box.
- 2026-10-04 (H1): The handler list `call` checks is read in a journaled step, so a replay calls the same target. The refusal is thrown outside the step, so it is never retried.
- 2026-10-04 (H1): The runs row's argv is `{by, key?, input}`. Its stats are `{ok: true}` or `{error}`, never the answer.
- 2026-10-04 (H1): ingressPrivate: `Resolution/resolve`, `loop` in the loop factory, `SendScheduler/loop`, and `Disposition/classify`. Grep found no ingress caller of any of them. Only InboxScheduler sends `classify`.
- 2026-10-04 (H1): `docs/restate-operations.md` showed `…/resolve` by hand. That line now stops at `queue`.
- 2026-10-04 (H1): Every other handler another service calls stays public. Each one has a CLI or documented ingress caller (SearchWeek run, Ads, ContentDesk, Disposition approve and drop), or H2 names it for a form (Content, the loop factory's start, stop, status and sync).
- 2026-10-04 (H1): Nothing inside wren calls `resolve`, so now nothing can run it. That is the rule's intent. A future caller must be a service. Its integration test reaches it through a test-only service and checks the ingress refuses it.
- 2026-10-04 (H2): The helpers live in `@wren/core/restate` (`form.ts`): `serviceHandler`, `exclusiveHandler`, `sharedHandler`, `NO_INPUT`, `PORTAL_FIELDS`. Each hands back the handler's own type, so typed clients are unchanged.
- 2026-10-04 (H2): Optional fields are `.nullish()`, so a caller that sent null before still passes. Numbers are plain `z.number()`, not int.
- 2026-10-04 (H2): `NO_INPUT` takes no body, null or `{}`. Every schema sets `accept: application/json`, which the default serde already declared, so the content type a caller sends is unchanged.
- 2026-10-04 (H2): The loop factory's `start` takes any JSON object (a record), since each loop's start options differ. `sync` and `stop` take nothing.
- 2026-10-04 (H2): Enums only where every caller sends fixed or validated values (Content platform, Meta objective, ReachDesk states). Platform names, Meta level and privacy URL stay strings: the CLI passes them through unchecked.
- 2026-10-04 (H2): Effects beyond the list: SendScheduler `tick`, Disposition `approve`, SmsDesk `forms` and `reminders` send. Resolution `resolve` and `verifyLeads` spend (verifyLeads pays the verifier). LLM stages carry no effect.
- 2026-10-04 (H2): Allowlisted without a schema: `SmsEvents/ingest`, the carrier's webhook. Its payload is the carrier's shape, not a form.
- 2026-10-04 (H2): Runs is autobrowse's service (rule 7), so it gets no schema here. LinkedinInbox left wren in 83459e9; nothing to schema. Prod still lists it from an old deployment of its own (revision 88) that no source builds. Removing that deployment is William's call.
- 2026-10-04 (H2): PostmasterScheduler needs `WREN_POSTMASTER_USER`, which the forms test leaves unset, so it isn't built there. It is on the loop factory, so it has the factory's schemas. The test passes a synthetic key inline, so it never reads a real one.
- 2026-10-04 (H2): `call` fills a portal handler's `viewer` with the operator, whatever the input says, and `formOf` drops `viewer` from the form. Without it, EmailConsole's form would ask who is asking.
- 2026-10-04 (H2): With a schema, Restate's ingress refuses an empty body typed as JSON. Without one it passed. The stock client sends exactly that for a call with no argument (`.status()`), so 129 handlers whose input may be absent would refuse the CLI. `ingressOf` now carries a serde that sends no body and no content type for no input; every CLI call and the integration tests connect through it. Calls between services aren't checked, so services and `call` are unaffected. autobrowse sends `null` as JSON, which `NO_INPUT` takes. Probed against the test server before choosing.
- 2026-10-04 (H2): `docs/restate-operations.md` says once how to call with no input. Its two Discovery curls sent JSON with no content type, which Restate refused even before; they now set it.
- 2026-10-04 (H3): The app is one List, no Overview. The form sits in the record panel above the fields (`lead`), so the list stays beside it. `HandlerForm` lives in `@wren/ui` (`handler.tsx`); the app is `modules/wren/handlers.ts`.
- 2026-10-04 (H3): An effect handler's Run opens a dialog that names the effect and takes its name typed in. Cancel leaves the form as typed.
- 2026-10-04 (H3): The last answer lives in the tab until a reload, one per handler. The server never keeps it (H1), so there is nothing to read back.
- 2026-10-04 (H3): An array of numbers is its own box type, `numbers`: one per line, each sent as a number. `lines` stays strings.
- 2026-10-04 (H3): Every dialog form now sends typed values (`typedOf`), and an empty optional box is left out instead of sent as "". The work forms read "" and absent the same. Delivery's Record now sends its value as a number; its server refused the text it sent before. An untouched required switch sends false.
- 2026-10-04 (H3): The portal Worker routes `console/call` and counts it a write, so the demo refuses it before Restate.
- 2026-10-04 (H3): A handler's id holds a slash, so its page link encodes it as `%2F`. The portal now decodes each path segment, which "Open as a page" needed for any id with a slash.
