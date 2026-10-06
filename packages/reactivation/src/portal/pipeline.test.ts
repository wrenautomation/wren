import { describe, expect, it } from "vitest";
import type { CrmStatus } from "../status.js";
import { PIPELINE_STEPS, type PipelineStep, type PipelineStepId, pipelineOf } from "./pipeline.js";

type Over = {
  health?: Partial<Omit<CrmStatus["health"], "verification">>;
  verification?: Partial<CrmStatus["health"]["verification"]>;
  lookup?: Partial<CrmStatus["lookup"]>;
  signals?: Partial<CrmStatus["signals"]>;
  score?: Partial<CrmStatus["score"]>;
  briefs?: Partial<CrmStatus["briefs"]>;
  emails?: Partial<CrmStatus["emails"]>;
};

/** A client with nothing imported yet; every count zero. */
function status(o: Over = {}): CrmStatus {
  return {
    health: {
      rows: 0,
      people: 0,
      duplicateRows: 0,
      companies: 0,
      emails: { missing: 0, badSyntax: 0, freemail: 0, role: 0, shared: 0 },
      noTitle: 0,
      lastContacted: { under6mo: 0, from6to12mo: 0, from1to2y: 0, over2y: 0, never: 0 },
      owners: [],
      importErrors: 0,
      gate: { ok: true, deadShare: null, reason: "" },
      ...o.health,
      verification: {
        valid: 0,
        invalid: 0,
        risky: 0,
        catch_all: 0,
        unchecked: 0,
        ...o.verification,
      },
    },
    lookup: { matched: 0, unresolved: 0, capped: 0, due: 0, waitingUntil: null, ...o.lookup },
    signals: {
      hiring: 0,
      noOpenings: 0,
      unresolved: 0,
      capped: 0,
      due: 0,
      waitingUntil: null,
      ...o.signals,
    },
    events: { found: 0, none: 0, due: 0 },
    score: { scored: 0, due: 0, top: [], ...o.score },
    briefs: { written: 0, empty: 0, failed: 0, due: 0, ...o.briefs },
    emails: {
      drafted: 0,
      awaiting: 0,
      approved: 0,
      sent: 0,
      failed: 0,
      due: 0,
      blocked: null,
      ...o.emails,
    },
    due: [],
    next: "",
  };
}

/** Mid-run: 21 people at 12 companies, 3 people parked on the lookup cap, emails in every state. */
const midRun: Over = {
  health: { rows: 25, people: 21, companies: 12 },
  verification: { valid: 15, invalid: 2, risky: 1, catch_all: 1, unchecked: 0 },
  lookup: { matched: 15, unresolved: 3, capped: 3, due: 0, waitingUntil: "2026-09-30 20:00:00+00" },
  signals: { hiring: 4, noOpenings: 6, unresolved: 2, capped: 0, due: 0, waitingUntil: null },
  score: { scored: 21, due: 0, top: [{ score: 9, count: 2 }] },
  briefs: { written: 18, empty: 2, failed: 1, due: 0 },
  emails: { drafted: 18, awaiting: 5, approved: 3, sent: 10, due: 0 },
};

function stepOf(s: CrmStatus, id: PipelineStepId, replies = 0, sends = true): PipelineStep {
  const found = pipelineOf(s, replies, sends).steps.find((x) => x.id === id);
  if (!found) throw new Error(`no ${id} step`);
  return found;
}

describe("pipelineOf: shape", () => {
  it("has every step once, in rail order, for an empty client", () => {
    expect(pipelineOf(status(), 0, false).steps.map((s) => s.id)).toEqual([...PIPELINE_STEPS]);
  });

  it("has every step once, in rail order, mid-run", () => {
    const ids = pipelineOf(status(midRun), 4, true).steps.map((s) => s.id);
    expect(ids).toEqual([...PIPELINE_STEPS]);
    expect(new Set(ids).size).toBe(10);
  });

  it("passes sends through", () => {
    expect(pipelineOf(status(), 0, true).sends).toBe(true);
    expect(pipelineOf(status(), 0, false).sends).toBe(false);
  });

  it("an empty client is idle everywhere, with zero counts and nothing parked", () => {
    for (const s of pipelineOf(status(), 0, true).steps) {
      expect(s, s.id).toMatchObject({ count: 0, state: "idle", parked: 0, resumesAt: null });
    }
  });

  it("gives `of` only to the steps that work through a set", () => {
    const p = pipelineOf(status(midRun), 0, true);
    const of = Object.fromEntries(p.steps.map((s) => [s.id, s.of]));
    expect(of).toEqual({
      list: null,
      emails: 19,
      where: 21,
      hiring: 12,
      score: 21,
      briefs: null,
      drafts: null,
      approve: null,
      sent: null,
      replies: null,
    });
  });

  it("an empty client's `of` is 0, not null, for the set steps", () => {
    const p = pipelineOf(status(), 0, true);
    const of = Object.fromEntries(p.steps.map((s) => [s.id, s.of]));
    expect(of).toMatchObject({ emails: 0, where: 0, hiring: 0, score: 0 });
  });

  it("no count is NaN or negative, mid-run or empty", () => {
    for (const s of [
      ...pipelineOf(status(), 0, true).steps,
      ...pipelineOf(status(midRun), 2, true).steps,
    ]) {
      expect(Number.isFinite(s.count), s.id).toBe(true);
      expect(s.count, s.id).toBeGreaterThanOrEqual(0);
      expect(s.parked, s.id).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("pipelineOf: list", () => {
  it("done once any row is in, counting people", () => {
    expect(stepOf(status(midRun), "list")).toMatchObject({ count: 21, state: "done", of: null });
  });

  it("idle with no rows", () => {
    expect(stepOf(status(), "list").state).toBe("idle");
  });
});

describe("pipelineOf: emails", () => {
  it("counts checked addresses out of all of them, unchecked excluded", () => {
    const s = status({
      verification: { valid: 5, invalid: 1, risky: 1, catch_all: 1, unchecked: 4 },
    });
    expect(stepOf(s, "emails")).toMatchObject({ count: 8, of: 12, state: "next" });
  });

  it("next with nothing checked yet: 0 of all", () => {
    const s = status({ verification: { unchecked: 7 } });
    expect(stepOf(s, "emails")).toMatchObject({ count: 0, of: 7, state: "next" });
  });

  it("done when every address is checked", () => {
    expect(stepOf(status(midRun), "emails")).toMatchObject({ count: 19, of: 19, state: "done" });
  });

  it("done even when every checked address is invalid", () => {
    const s = status({ verification: { invalid: 3 } });
    expect(stepOf(s, "emails")).toMatchObject({ count: 3, of: 3, state: "done" });
  });

  it("idle with no addresses", () => {
    expect(stepOf(status({ health: { rows: 5, people: 5 } }), "emails").state).toBe("idle");
  });

  it("never parks", () => {
    expect(stepOf(status({ verification: { unchecked: 3 } }), "emails")).toMatchObject({
      parked: 0,
      resumesAt: null,
    });
  });
});

describe("pipelineOf: where (lookup)", () => {
  it("counts matched plus unresolved, out of people", () => {
    expect(stepOf(status(midRun), "where")).toMatchObject({ count: 18, of: 21 });
  });

  it("waiting when parked on a cap, with how many and when as ISO", () => {
    expect(stepOf(status(midRun), "where")).toMatchObject({
      state: "waiting",
      parked: 3,
      resumesAt: "2026-09-30T20:00:00.000Z",
    });
  });

  it("reads a Postgres timestamptz with an offset and microseconds", () => {
    const s = status({
      ...midRun,
      lookup: { ...midRun.lookup, waitingUntil: "2026-09-30 16:00:00.123456-04" },
    });
    expect(stepOf(s, "where").resumesAt).toBe("2026-09-30T20:00:00.123Z");
  });

  it("due work wins over parked work: next, still reporting the park", () => {
    const s = status({ ...midRun, lookup: { ...midRun.lookup, due: 2 } });
    expect(stepOf(s, "where")).toMatchObject({
      state: "next",
      parked: 3,
      resumesAt: "2026-09-30T20:00:00.000Z",
    });
  });

  it("capped with no waiting time is not waiting and reports nothing parked", () => {
    const s = status({ ...midRun, lookup: { ...midRun.lookup, waitingUntil: null } });
    expect(stepOf(s, "where")).toMatchObject({ state: "done", parked: 0, resumesAt: null });
  });

  it("waiting even when nobody is looked up yet (first batch hit the cap)", () => {
    const s = status({
      health: { rows: 4, people: 4 },
      lookup: { capped: 4, waitingUntil: "2026-10-01T08:00:00Z" },
    });
    expect(stepOf(s, "where")).toMatchObject({ count: 0, of: 4, state: "waiting", parked: 4 });
  });

  it("idle when nothing looked up, due or parked", () => {
    expect(stepOf(status({ health: { rows: 3, people: 3 } }), "where").state).toBe("idle");
  });
});

describe("pipelineOf: hiring (signals)", () => {
  it("counts hiring + no openings + unresolved, out of companies", () => {
    expect(stepOf(status(midRun), "hiring")).toMatchObject({ count: 12, of: 12, state: "done" });
  });

  it("waiting on its own cap, not the lookup's", () => {
    const s = status({
      ...midRun,
      lookup: { ...midRun.lookup, waitingUntil: null },
      signals: { ...midRun.signals, capped: 2, waitingUntil: "2026-10-02 09:00:00+00" },
    });
    expect(stepOf(s, "hiring")).toMatchObject({
      state: "waiting",
      parked: 2,
      resumesAt: "2026-10-02T09:00:00.000Z",
    });
    expect(stepOf(s, "where")).toMatchObject({ parked: 0, resumesAt: null });
  });

  it("next when companies are due", () => {
    const s = status({ ...midRun, signals: { ...midRun.signals, due: 5 } });
    expect(stepOf(s, "hiring").state).toBe("next");
  });
});

describe("pipelineOf: score", () => {
  it("counts scored out of people", () => {
    expect(stepOf(status(midRun), "score")).toMatchObject({ count: 21, of: 21, state: "done" });
  });

  it("next on a rescore even when everyone was scored", () => {
    const s = status({ ...midRun, score: { scored: 21, due: 21 } });
    expect(stepOf(s, "score")).toMatchObject({ count: 21, of: 21, state: "next" });
  });

  it("idle with nobody scored or due", () => {
    expect(stepOf(status({ health: { rows: 2, people: 2 } }), "score").state).toBe("idle");
  });
});

describe("pipelineOf: briefs and drafts", () => {
  it("briefs: count written, next when due, no `of`", () => {
    expect(stepOf(status(midRun), "briefs")).toMatchObject({ count: 18, of: null, state: "done" });
    const due = status({ ...midRun, briefs: { ...midRun.briefs, due: 3 } });
    expect(stepOf(due, "briefs").state).toBe("next");
  });

  it("briefs: failed and empty ones alone leave it idle", () => {
    expect(stepOf(status({ briefs: { empty: 2, failed: 1 } }), "briefs").state).toBe("idle");
  });

  it("drafts: count drafted, next when due", () => {
    expect(stepOf(status(midRun), "drafts")).toMatchObject({ count: 18, state: "done" });
    expect(stepOf(status({ emails: { due: 4 } }), "drafts")).toMatchObject({
      count: 0,
      state: "next",
    });
  });
});

describe("pipelineOf: approve", () => {
  it("yours while any email awaits the client, counting them", () => {
    expect(stepOf(status(midRun), "approve")).toMatchObject({ count: 5, state: "yours" });
  });

  it("done with nothing awaiting once something was approved", () => {
    const s = status({ emails: { drafted: 3, approved: 3 } });
    expect(stepOf(s, "approve")).toMatchObject({ count: 0, state: "done" });
  });

  it("done with nothing awaiting once something was sent", () => {
    expect(stepOf(status({ emails: { sent: 2 } }), "approve").state).toBe("done");
  });

  it("idle with nothing awaiting, approved or sent, even with drafts written", () => {
    expect(stepOf(status({ emails: { drafted: 6 } }), "approve").state).toBe("idle");
  });
});

describe("pipelineOf: sent", () => {
  it("next when sending is on and approved work waits", () => {
    const s = status({ emails: { approved: 3, sent: 10 } });
    expect(stepOf(s, "sent", 0, true)).toMatchObject({ count: 10, state: "next" });
  });

  it("idle when sending is off and nothing was ever sent, even with approved work", () => {
    expect(stepOf(status({ emails: { approved: 3 } }), "sent", 0, false).state).toBe("idle");
  });

  it("done when sending is on, all approved work is out", () => {
    expect(stepOf(status({ emails: { sent: 10 } }), "sent", 0, true).state).toBe("done");
  });

  it("done when sending is off, all approved work is out", () => {
    expect(stepOf(status({ emails: { sent: 10 } }), "sent", 0, false).state).toBe("done");
  });

  it("idle when sending is on but nothing approved or sent", () => {
    expect(stepOf(status(), "sent", 0, true).state).toBe("idle");
  });

  // `done` means nothing left to do here. With sending off, 3 approved emails sit unsent,
  // so the rail should not call the step done.
  it("not done when sending is off and approved work still waits to go", () => {
    const s = status({ emails: { approved: 3, sent: 10 } });
    expect(stepOf(s, "sent", 0, false).state).not.toBe("done");
  });
});

describe("pipelineOf: replies", () => {
  it("done with any reply, counting them", () => {
    expect(stepOf(status(midRun), "replies", 4)).toMatchObject({ count: 4, state: "done" });
  });

  it("idle with none", () => {
    expect(stepOf(status(midRun), "replies", 0)).toMatchObject({ count: 0, state: "idle" });
  });
});
