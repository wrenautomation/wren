import { describe, expect, it } from "vitest";
import { type Action, held, setsAside } from "./action.js";
import { iconOf, ROW_MAIN, rowActsOf } from "./row-acts.js";

const act = (id: string, label: string, more: Partial<Action> = {}): Action =>
  ({ id, label, handler: `x/${id}`, ...more }) as Action;

const APPROVE = act("approve", "Approve");
const ASK = act("changes", "Ask for changes", { ask: { field: "note", label: "What to change" } });
const SNOOZE = act("snooze", "Snooze");
const ARCHIVE = act("archive", "Archive");
// A form with no `each` belongs to the page head, not a row.
const RENAME = act("rename", "Rename", { form: [] as never });
const TAG = act("tag", "Tag it");
const NOTE = act("note", "Note", { inline: true });

describe("rowActsOf", () => {
  it("leads with the move, the ask and the set-aside, in page order", () => {
    const { main, more } = rowActsOf([APPROVE, SNOOZE, ASK, ARCHIVE, RENAME], {});
    expect(main.map((a) => a.id)).toEqual(["approve", "changes", "archive"]);
    expect(more.map((a) => a.id)).toEqual(["snooze"]);
  });

  it("keeps a place for the page's reply, and skips the ask then", () => {
    const { main } = rowActsOf([APPROVE, ASK, ARCHIVE, SNOOZE], {}, true);
    expect(main.map((a) => a.id)).toEqual(["approve", "archive"]);
  });

  it("never shows more than ROW_MAIN, nor one without an icon, nor an inline one", () => {
    const all = [APPROVE, ASK, ARCHIVE, SNOOZE, TAG, NOTE];
    const { main, more } = rowActsOf(all, {});
    expect(main).toHaveLength(ROW_MAIN);
    expect(main).not.toContain(TAG);
    expect([...main, ...more]).not.toContain(NOTE);
  });

  it("drops what doesn't apply to the row", () => {
    const done = act("done", "Mark done", { when: { status: ["open"] } });
    expect(rowActsOf([done], { status: "closed" }).main).toEqual([]);
    expect(rowActsOf([done], { status: "open" }).main).toEqual([done]);
  });
});

describe("iconOf", () => {
  it("knows the common verbs", () => {
    for (const label of [
      "Reply",
      "Approve",
      "Mark done",
      "Archive",
      "Delete",
      "Snooze",
      "Don't send",
    ])
      expect(iconOf(label), label).not.toBeNull();
    expect(iconOf("Tag it")).toBeNull();
  });
});

describe("held: set aside at once, undone from the toast", () => {
  it("holds a plain delete or archive", () => {
    expect(held(act("d", "Delete", { confirm: "Delete it?" }))).toBe(true);
    expect(held(ARCHIVE)).toBe(true);
    expect(setsAside("Take out")).toBe(true);
  });

  it("leaves one with its own undo, a form, words or an optimistic run", () => {
    expect(held(act("a", "Archive", { undo: "x/unarchive" }))).toBe(false);
    expect(held(act("a", "Archive", { form: [] as never }))).toBe(false);
    expect(held(act("a", "Reject", { ask: { field: "why", label: "Why" } }))).toBe(false);
    expect(held(act("a", "Archive", { optimistic: "Archived" }))).toBe(false);
    expect(held(APPROVE)).toBe(false);
  });
});

describe("iconOf", () => {
  it("tells passing on a person apart from skipping one item", () => {
    expect(iconOf("Pass on them")).not.toBe(iconOf("Skip"));
    expect(iconOf("Skip")).toBe(iconOf("Dismiss"));
  });
});
