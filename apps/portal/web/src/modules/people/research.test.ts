// Research on a profile: the page's declarations match the record, the section shows for Wren's
// own people only, and the page reads again while a run works.

import { findingRecord, profileRecords } from "@wren/core/profile-records";
import { describe, expect, it } from "vitest";
import {
  dropFinding,
  findingsPage,
  inlineDecide,
  keepFinding,
  researchAction,
} from "./research.js";
import { profileExtras } from "./timeline.js";

const run = (state: string) => ({
  id: 1,
  state,
  at: "2026-10-17T12:00:00.000Z",
  startedAt: null,
  finishedAt: null,
  by: "william",
  steps: [],
  outcome: null,
  error: null,
  retryAt: null,
});
const detail = (research: unknown) => ({
  timeline: [],
  failed: [],
  reach: null,
  ...(research === undefined ? {} : { research }),
});
const act = async () => ({});
const titles = (x: ReturnType<typeof profileExtras>) => (x.sections ?? []).map(([t]) => t);

describe("research page", () => {
  it("reads only fields and views the record declares", () => {
    const fields = Object.keys(findingRecord.fields);
    for (const c of findingsPage.columns ?? []) expect(fields, c).toContain(c);
    const views = (findingRecord.views ?? []).map((v) => v.id);
    expect(Object.keys(findingsPage.empty as object).sort()).toEqual([...views].sort());
    expect(findingsPage.record).toBe(findingRecord.id);
  });

  it("its actions are the ones the record names, handlers included", () => {
    expect(findingRecord.actions).toEqual([keepFinding.id, dropFinding.id]);
    expect(inlineDecide.map((a) => a.id)).toEqual([keepFinding.id, dropFinding.id]);
    expect(inlineDecide.every((a) => a.inline)).toBe(true);
    expect([researchAction, keepFinding, dropFinding].map((a) => a.handler)).toEqual([
      "people/research",
      "people/findingKeep",
      "people/findingDrop",
    ]);
  });

  it("the profile record names the action only when research is on", () => {
    const [on] = profileRecords([], { research: true });
    const [off] = profileRecords([]);
    expect(on?.actions).toEqual(expect.arrayContaining(["people.research"]));
    expect(off?.actions ?? []).not.toContain("people.research");
  });
});

describe("profileExtras, research", () => {
  it("shows a Research section for Wren's own people, none for a client's", () => {
    const own = profileExtras(detail({ run: null, findings: [] }), act);
    expect(titles(own)).toContain("Research");
    expect(titles(profileExtras(detail(undefined), act))).not.toContain("Research");
    expect(titles(profileExtras(detail(null), act))).not.toContain("Research");
  });

  it("reads again while a run is queued or running, and stops when it ends", () => {
    for (const state of ["queued", "running"])
      expect(profileExtras(detail({ run: run(state), findings: [] }), act).poll).toBeGreaterThan(0);
    for (const state of ["done", "failed"])
      expect(profileExtras(detail({ run: run(state), findings: [] }), act).poll).toBeUndefined();
    expect(profileExtras(detail({ run: null, findings: [] }), act).poll).toBeUndefined();
  });
});
