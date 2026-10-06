import type { Queryable } from "@wren/db";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { reviewRecord } from "./review.js";

const dialect = new PgDialect();
/** Answers each check's query by the table it reads. */
const dbAnswering = (answers: Record<string, object>) =>
  ({
    execute: async (q: SQL) => {
      const text = dialect.sqlToQuery(q).sql;
      const hit = Object.keys(answers).find((k) => text.includes(k));
      return hit ? [answers[hit]] : [];
    },
  }) as unknown as Queryable;

const states = async (answers: Record<string, object>) => {
  const rows = (await reviewRecord().rows?.(dbAnswering(answers))) ?? [];
  return Object.fromEntries(rows.map((r) => [r.id, r.state]));
};

describe("Friday review", () => {
  it("fires on EC2 compute and a block rate, leaves the rest to a person", async () => {
    expect(
      await states({
        "books.usage": { usd: "0.31" },
        to_regclass: { on: false },
        documents: { tried: "80", blocked: "12" },
        audit_events: { n: "10400000" },
      }),
    ).toEqual({
      digitalocean: "fired",
      airbyte: "manual",
      redis: "manual",
      proxies: "fired",
      "audit-partition": "fired",
      remotion: "manual",
      scrums: "manual",
    });
  });

  it("stays quiet when nothing bills and few sites refuse", async () => {
    const s = await states({
      "books.usage": { usd: null },
      to_regclass: { on: true },
      pg_stat_statements: { calls: "40", mean: "900", q: "select 1" },
      documents: { tried: "80", blocked: "1" },
      audit_events: { n: "536083" },
    });
    expect([s.digitalocean, s.redis, s.proxies, s["audit-partition"]]).toEqual([
      "quiet",
      "quiet",
      "quiet",
      "quiet",
    ]);
  });
});
