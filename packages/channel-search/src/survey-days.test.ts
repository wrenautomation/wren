import type { SiteAnswer, SiteHit } from "@wren/channel-email";
import { describe, expect, it } from "vitest";
import { rollupAnswers } from "./survey-days.js";

let id = 0;
const answer = (survey: string, visitor: string, value: string, ts: string): SiteAnswer => ({
  id: ++id,
  ts,
  survey,
  visitor,
  view: `view-${id}`,
  page: "/",
  value,
});
const hit = (visitor: string, o: Partial<SiteHit> = {}) =>
  ({ id: ++id, ts: "2026-10-01T09:00:00Z", visitor, page: "/", ...o }) as SiteHit;

describe("survey days", () => {
  it("counts each visitor's first answer by day, value and first touch; text as text", () => {
    const rows = rollupAnswers(
      [
        answer("fit", "v-1", "Yes", "2026-10-01T10:00:00Z"),
        answer("fit", "v-1", "No", "2026-10-01T10:01:00Z"), // a second answer: the first counts
        answer("fit", "v-2", "Yes", "2026-10-01T11:00:00Z"),
        answer("fit", "v-3", "Yes", "2026-10-02T11:00:00Z"),
        answer("why", "v-1", "fast replies", "2026-10-01T12:00:00Z"),
        answer("gone", "v-1", "Yes", "2026-10-01T12:00:00Z"), // no such survey here: dropped
      ],
      [hit("v-1", { r: "code-1" }), hit("v-2")],
      new Map([
        ["fit", "choice"],
        ["why", "text"],
      ] as const),
    );
    expect(rows).toEqual([
      { survey: "fit", day: "2026-10-01", value: "Yes", channel: "email", answers: 1 },
      { survey: "fit", day: "2026-10-01", value: "Yes", channel: "direct", answers: 1 },
      { survey: "fit", day: "2026-10-02", value: "Yes", channel: "direct", answers: 1 },
      { survey: "why", day: "2026-10-01", value: "text", channel: "email", answers: 1 },
    ]);
  });
});
