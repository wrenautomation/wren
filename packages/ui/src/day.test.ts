/** The Day template's placing and the platform switch's choices (designs/2026-10-07-visual-cues.md). */
import { cued, type RecordMeta } from "@wren/core/records";
import { describe, expect, it } from "vitest";
import { type DaySource, dayKey, placeRows } from "./day.js";
import { choicesOf, holds } from "./switch-bar.js";

const SOURCES: DaySource[] = [
  { record: "x.post", label: "Posted", at: "published", open: "/x/posts" },
  { record: "x.draft", label: "Waiting", at: "created", carry: true, open: "/x/drafts" },
];
const at = (d: string) => new Date(`${d}T10:00:00`).toISOString();

describe("placeRows", () => {
  it("puts a row on its day, and waiting work from before today on today", () => {
    const days = placeRows(
      SOURCES,
      [
        { week: [{ id: 1, published: at("2026-10-05") }], before: [] },
        {
          week: [
            { id: 2, created: at("2026-10-06") },
            { id: 3, created: at("2026-10-08") },
          ],
          // Read again as before today: shown once.
          before: [
            { id: 2, created: at("2026-10-06") },
            { id: 4, created: null },
          ],
        },
      ],
      "2026-10-07",
    );
    expect(days.get("2026-10-05")?.map((i) => i.row.id)).toEqual([1]);
    expect(days.get("2026-10-07")?.map((i) => [i.row.id, i.carried])).toEqual([
      [2, true],
      [4, true],
    ]);
    expect(days.get("2026-10-08")?.map((i) => [i.row.id, i.carried])).toEqual([[3, false]]);
    expect(days.has("2026-10-06")).toBe(false);
  });

  it("drops a dated source's row with no date", () => {
    const days = placeRows(
      SOURCES,
      [{ week: [{ id: 1, published: null }], before: [] }, null],
      "2026-10-07",
    );
    expect(days.size).toBe(0);
  });

  it("names a local day", () => {
    expect(dayKey(new Date(2026, 0, 9))).toBe("2026-01-09");
  });
});

describe("choicesOf", () => {
  const meta = (id: string, channel: RecordMeta["channel"], states?: Record<string, string>) =>
    ({
      id,
      channel,
      fields: states
        ? [
            {
              key: "platform",
              states: cued(
                Object.fromEntries(
                  Object.entries(states).map(([k, label]) => [k, { label, tone: "neutral" }]),
                ),
              ),
            },
          ]
        : [],
    }) as unknown as RecordMeta;
  const types = [
    meta("x.draft", { field: "platform" }, { linkedin: "LinkedIn", x: "X" }),
    meta("x.comment", { field: "platform" }, { reddit: "Reddit", x: "X" }),
    meta("x.video", "youtube"),
  ];

  it("joins each type's platforms in order, with a one-platform type's own", () => {
    const got = choicesOf(types, ["x.draft", "x.comment", "x.video"], "platform");
    expect(got.map(([k, s]) => [k, s.label, s.mark])).toEqual([
      ["linkedin", "LinkedIn", "linkedin"],
      ["x", "X", "x"],
      ["reddit", "Reddit", "reddit"],
      ["youtube", "YouTube", "youtube"],
    ]);
  });

  it("knows which types can hold a pick", () => {
    expect(holds(types[0], "platform", "x")).toBe(true);
    expect(holds(types[0], "platform", "reddit")).toBe(false);
    expect(holds(types[2], "platform", "youtube")).toBe(true);
    expect(holds(types[2], "platform", "x")).toBe(false);
  });
});
