import type { Queryable } from "@wren/db";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  LEAD_KIND,
  LEAD_TEXT_MAX,
  leadFitDue,
  leadProfileOf,
  leadSubject,
  leadWhy,
  pickPercent,
  scrubList,
  scrubText,
} from "./lead-fit.js";

describe("subjects", () => {
  it("reads and writes profile:<id>", () => {
    expect(leadSubject(42)).toBe("profile:42");
    expect(leadProfileOf("profile:42")).toBe(42);
    expect(leadProfileOf("profile:")).toBeNull();
    expect(leadProfileOf("profile:4x")).toBeNull();
    expect(leadProfileOf("thread:t3_a")).toBeNull();
    expect(leadProfileOf("profile:1234567890")).toBeNull();
  });
});

describe("scrubText", () => {
  const list = scrubList({
    names: ["Avery Quill"],
    handles: ["@avery_q", "aq"],
  });

  it("keeps names and handles of 3 letters or more, longest first", () => {
    expect(list.names).toEqual(["avery quill", "avery", "quill"]);
    // "aq" is too short to be worth hiding.
    expect(list.handles).toEqual(["avery_q"]);
    expect(scrubList({ names: [null, "Al"], handles: [undefined] })).toEqual({
      names: [],
      handles: [],
    });
  });

  it("takes out links, addresses, phone numbers, mentions, names and handles", () => {
    const out = scrubText(
      "Hi Avery Quill, mail avery@example.test or call +1 (555) 010-0199. " +
        "See https://example.test/avery and www.example.test/x. " +
        "Thanks @someone and avery_q. Quill agrees.",
      list,
    );
    expect(out).toBe(
      "Hi [name], mail [email] or call [phone]. See [link] and [link] Thanks [handle] and [handle]. [name] agrees.",
    );
    for (const secret of ["Avery", "Quill", "example.test", "555", "someone", "avery_q"])
      expect(out).not.toContain(secret);
  });

  it("does not cut a longer word that holds a name", () => {
    expect(scrubText("Averyone said Avery.", list)).toBe("Averyone said [name].");
  });

  it("trims long text on a word, with dots", () => {
    const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    const out = scrubText(long, list);
    expect(out.length).toBeLessThanOrEqual(LEAD_TEXT_MAX + 3);
    expect(out.endsWith("...")).toBe(true);
    expect(out.slice(0, -3).endsWith(" ")).toBe(false);
    expect(scrubText(null, list)).toBe("");
    expect(scrubText("  a   b  ", list)).toBe("a b");
  });
});

const owner = {
  person: { role: "owner", companySize: "small", niche: "plumbing", warmth: "warm" },
  touches: {
    counts: [
      { kind: "comment", direction: "theirs", n: 1 },
      { kind: "dm", direction: "theirs", n: 1 },
      { kind: "dm", direction: "ours", n: 3 },
    ],
  },
  found: [],
};

describe("leadWhy", () => {
  it("says the label's meaning and the two strongest facts", () => {
    expect(leadWhy("fit", owner)).toBe("Could buy. Owner at a 2 to 9 person firm; replied twice.");
  });

  it("leaves out what is not known", () => {
    expect(leadWhy("unsure", {})).toBe("Too little to say.");
    expect(leadWhy("not", { person: { role: "staff", companySize: "unknown" } })).toBe(
      "Likes the content, would not buy. Staff.",
    );
    expect(
      leadWhy("fit", {
        person: { role: "unknown", companySize: "mid", niche: "roofing" },
        touches: { counts: [{ kind: "dm", direction: "theirs", n: 1 }] },
      }),
    ).toBe("Could buy. At a 10 to 49 person firm; replied once.");
  });

  it("counts only their touches and falls to research or niche for the second fact", () => {
    expect(
      leadWhy("fit", {
        person: { role: "owner", niche: "roofing" },
        touches: { counts: [{ kind: "dm", direction: "ours", n: 4 }] },
        found: [{ kind: "employer", employer: "A synthetic firm", confidence: 0.9 }],
      }),
    ).toBe("Could buy. Owner; works in roofing.");
    expect(
      leadWhy("fit", {
        person: { role: "unknown" },
        found: [{ kind: "employer", employer: "A synthetic firm", confidence: 0.9 }],
      }),
    ).toBe("Could buy. research found a job.");
    expect(leadWhy("fit", null)).toBe("Could buy.");
  });
});

describe("pickPercent", () => {
  it("is the picked label's chance, else the confidence, else nothing", () => {
    const answers = { pick: { probabilities: { fit: 0.724, unsure: 0.2, not: 0.076 } } };
    expect(pickPercent(answers, "fit", 0.5)).toBe(72);
    expect(pickPercent({ pick: {} }, "fit", 0.5)).toBe(50);
    expect(pickPercent(null, "fit", null)).toBeNull();
  });
});

describe("leadFitDue", () => {
  it("asks for unmerged profiles with a newer touch of theirs, oldest first", async () => {
    let seen: SQL | undefined;
    const db = {
      execute: async (q: SQL) => {
        seen = q;
        return [{ id: "7", since: "2026-10-02T12:00:00.000Z" }];
      },
    } as unknown as Queryable;
    const got = await leadFitDue(db, 5);
    expect(got).toEqual([{ id: 7, since: "2026-10-02T12:00:00.000Z" }]);
    const { sql, params } = new PgDialect().sqlToQuery(seen as SQL);
    const flat = sql.replace(/\s+/g, " ");
    expect(flat).toContain("t.direction = 'theirs'");
    expect(flat).toContain("p.merged_into is null");
    expect(flat).toContain("d.subject = 'profile:' || p.id");
    expect(flat).toContain("order by min(t.at), p.id");
    expect(params).toEqual([LEAD_KIND, 5]);
  });
});
