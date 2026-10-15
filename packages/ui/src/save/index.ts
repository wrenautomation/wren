/**
 * One way to save, everywhere a person types (designs/2026-10-14-saving-and-ui-audit.md).
 * Import from `@wren/ui` (re-exported there). Notes keep their own Yjs sync.
 *
 * ## A value he types into
 *
 *   const s = useSaved<string>({
 *     key: `draft:${id}`,            // journal + lock name; null = neither
 *     server: row.text,              // the newest read
 *     version: state.version,        // optional: a record's version; then `expect` is it
 *     at: got.at,                    // the tick when that read left (`useLoad`/`useCall` give it)
 *     same: (a, b) => a.trim() === b.trim(),   // optional, JSON equality by default
 *     save: async (text, { expect, request }) => {
 *       const out = await call("x/set", { id, text, expect, requestId: request });
 *       return { value: text.trim(), version: out.version };  // what the server holds now
 *     },
 *     onSaved: (text) => patchRecord(api, "x", id, { text }),  // write-through, no re-read
 *     onConflict: () => got.retry(),                         // read theirs
 *     delay: 1200,                   // null: no autosave, flush only (a field with Save/Cancel)
 *   });
 *   <textarea value={s.value} onChange={(e) => s.set(e.target.value)} onBlur={s.flush} />
 *   <SaveStatus state={s} onRetry={s.retry} />
 *   {s.conflict ? <SaveConflict conflict={s.conflict} onKeepMine={s.keepMine} onTakeTheirs={s.takeTheirs} /> : null}
 *
 * What it promises:
 * - The input shows `value`. Only `set`, `takeTheirs` and a newer read over a clean box change
 *   it; a save's answer never does. A read that left before the newest save answered is ignored.
 * - Each `set` is journaled to localStorage synchronously (`wren.unsaved:<key>`). On open, a
 *   journal over the same base (or version) comes back and saves; over a moved one it opens a
 *   conflict with both values.
 * - Saves for a key run one at a time across tabs (Web Locks; this tab only without them),
 *   coalesced to the one in flight plus the newest. Each reads value, base and version when it
 *   starts.
 * - It saves `delay` after the last change, when the tab hides, on pagehide, on close (unmount)
 *   and on `flush`. Call `flush` before anything that reads the saved value; false = don't go on.
 * - Offline (status 0), 408, 429, 5xx, a TypeError and a timeout (20 s) retry with backoff and
 *   on `online` ("Saved on this device"). A 409 that says it changed, or `code: "conflict"`, is a
 *   conflict. Any other refusal shows its words and waits for a change or Retry.
 * - `request` is the same for each try of one value over one base: send it as `requestId`.
 *
 * ## Read caches
 *
 * `useLoad` (and the portal's `useCall`) answer `{ data, at, patch }`. `writeThrough(scope, fn)`
 * patches every cached answer in a scope, every mounted read and any read still out;
 * `patchRecord(api, record, id, fields)` does it for a record's row in its detail and lists.
 *
 * ## Actions
 *
 * `ACTIONS.run(key, (requestId) => call(...))`: a second press while the first is out gets the
 * first's answer; the id stays until an answer, so a retry after a lost answer is one action.
 * `useRun` sends every action through it, with `requestId` in the input. `useKeptForm(key, base)`
 * keeps a dialog's typing until it is sent.
 */
export { answersOf, onWrite, type Patch, patchedSince, remember, writeThrough } from "./cache.js";
export { tick } from "./clock.js";
export {
  type Conflict,
  conflictOf,
  type Failure,
  failureKind,
  SAVE_DELAY_MS,
  type SaveAnswer,
  type SaveContext,
  type SaveFn,
  Saver,
  type SaverOptions,
  type SaveState,
  SaveTimeout,
  type Status as SaveStatusName,
} from "./engine.js";
export type { Locks, PageEvent, SaveEnv, Store } from "./env.js";
export { ACTIONS, Once } from "./once.js";
export {
  type KeptFormState,
  SaveConflict,
  type Saved,
  SaveStatus,
  statusWords,
  useKeptForm,
  useSaved,
} from "./react.js";
