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
      signIn: async () => null,
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

  it("calls an inbox connected once it signs in, and says why when it doesn't", async () => {
    const asked: string[] = [];
    const answers: Record<string, () => Promise<"gmail" | "imap" | null>> = {
      "ann@example.test": async () => "gmail",
      "bo@example.test": async () => "imap",
      "cy@example.test": async () => null,
      "di@example.test": async () => {
        throw Object.assign(new Error("Command failed"), { authenticationFailed: true });
      },
      "ed@example.test": async () => {
        throw new Error("Gmail token: unauthorized_client");
      },
      "gu@example.test": async () => {
        throw new Error(
          "token exchange refused (HTTP 400): invalid_grant: Invalid email or User ID",
        );
      },
      "fa@example.test": async () => {
        throw new Error("connect ETIMEDOUT");
      },
    };
    const c = emailChecks({
      dbOf: async () => ({}) as Queryable,
      warmupOf: async () => null,
      signIn: async (a) => {
        asked.push(a);
        return (answers[a] ?? (async () => null))();
      },
    });
    const check = (ref: string) =>
      c["inbox.auth"]?.({ account: { ...inbox, ref }, now: new Date(0) });
    expect(await check("Ann@Example.test")).toEqual({
      ok: true,
      why: "Gmail reads it",
      seen: { via: "gmail" },
    });
    expect(await check("bo@example.test")).toMatchObject({
      ok: true,
      why: "It signs in over IMAP",
    });
    expect(await check("cy@example.test")).toEqual({
      ok: false,
      why: "Not on Wren's sending roster yet",
    });
    expect(await check("di@example.test")).toEqual({ ok: false, why: "It won't sign in" });
    expect(await check("ed@example.test")).toEqual({ ok: false, why: "It won't sign in" });
    expect(await check("gu@example.test")).toEqual({ ok: false, why: "It won't sign in" });
    expect(await check("fa@example.test")).toEqual({
      ok: false,
      why: "Couldn't reach the inbox: connect ETIMEDOUT",
    });
    expect(asked[0]).toBe("ann@example.test");
  });
});
