import { setupWorkflow } from "@wren/core/setup";
import type { AccountRow } from "@wren/core/setup-schema";
import { checkWorkflows } from "@wren/core/workflows";
import type { Queryable } from "@wren/db";
import { describe, expect, it } from "vitest";
import { EMAIL_SETUPS, emailChecks } from "./setups.js";

const inbox = { id: 1, client: null, site: "inbox", ref: "Ann@Example.test" } as AccountRow;

describe("the email setups", () => {
  it("are valid setup workflows", () => {
    expect(checkWorkflows(EMAIL_SETUPS.map(setupWorkflow), [])).toEqual([]);
  });

  it("call an inbox warmed once its warmup reaches the limit", async () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const c = emailChecks({
      dbOf: async () => ({}) as Queryable,
      warmupOf: async (a) => (a === "ann@example.test" ? { start, step: 2, limit: 60 } : null),
    });
    const day = (n: number) => new Date(start.getTime() + n * 86_400_000);
    expect(await c["inbox.warmup"]?.({ account: inbox, now: day(10) })).toMatchObject({
      ok: false,
      why: "Warmup at 20 of 60 a day",
    });
    expect(await c["inbox.warmup"]?.({ account: inbox, now: day(30) })).toMatchObject({ ok: true });
    expect(
      await c["inbox.warmup"]?.({ account: { ...inbox, ref: "bo@example.test" }, now: day(30) }),
    ).toEqual({
      ok: false,
      why: "Warmup hasn't started",
    });
  });
});
