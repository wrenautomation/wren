/** The dead-letter queue: a sweep files Restate's paused calls, tells once, closes what left. */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RestateAdmin } from "../../src/console.js";
import { deadLetterList, deadLetterPass, endDeadLetter } from "../../src/dead-letters.js";
import type { Notifier } from "../../src/notify.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

const NOW = new Date("2026-10-11T12:00:00Z");
const paused = (id: string, target = "Content/comments") => ({
  id,
  target,
  target_service_key: null,
  last_failure: null,
  invoked_by: "service",
  invoked_by_target: "ConsolePortal/call",
  modified_at: "2026-10-08T22:27:01.224Z",
});

/** Restate as the sweep sees it: the paused rows, and one journal failure per call. */
function fakeAdmin(rows: () => Record<string, unknown>[]): RestateAdmin {
  return async (q) =>
    q.includes("sys_journal")
      ? [
          {
            entry_json:
              '{"Notification":{"Completion":{"Call":{"completion_id":4,"result":{"Failure":{"code":400,"message":"Too big: expected number to be <=100"}}}}}}',
          },
        ]
      : rows();
}

function fakeNotifier() {
  const said: string[] = [];
  const n: Notifier = {
    name: "test",
    notify: async (title, body) => {
      said.push(`${title}\n${body}`);
      return true;
    },
  };
  return { n, said };
}

describe("deadLetterPass", () => {
  it("files paused calls with the journal's failure, tells once, closes what left", async () => {
    let restate = [paused("inv_a"), paused("inv_b", "ReachDesk/commentThread")];
    const admin = fakeAdmin(() => restate);
    const { n, said } = fakeNotifier();

    const first = await deadLetterPass({ main: pg.db, admin, notifier: n }, NOW);
    expect(first).toMatchObject({ paused: 2, filed: 2, cleared: 0, told: 2 });
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("2 dead letters");
    expect(said[0]).toContain("[400] Too big");

    // The same two again: nothing new is said.
    expect(await deadLetterPass({ main: pg.db, admin, notifier: n }, NOW)).toMatchObject({
      filed: 0,
      told: 0,
    });
    expect(said).toHaveLength(1);

    // inv_b was resumed by hand: its letter closes.
    restate = [paused("inv_a")];
    expect((await deadLetterPass({ main: pg.db, admin }, NOW)).cleared).toBe(1);
    const open = await deadLetterList(pg.db);
    expect(open.map((l) => l.invocationId)).toEqual(["inv_a"]);
    expect(open[0]?.error).toBe("[400] Too big: expected number to be <=100");
  });

  it("retry resumes through the admin API; a letter paused again opens again", async () => {
    const restate = [paused("inv_c")];
    const admin = fakeAdmin(() => restate);
    await deadLetterPass({ main: pg.db, admin }, NOW);
    const row = (await deadLetterList(pg.db)).find((l) => l.invocationId === "inv_c");
    if (!row) throw new Error("not filed");

    const patched: string[] = [];
    const patch = async (path: string) => {
      patched.push(path);
    };
    const ended = await endDeadLetter({ main: pg.db, patch }, row.id, "retry", "ada", NOW);
    expect(ended).toMatchObject({ end: "retried", endedBy: "ada" });
    expect(patched).toEqual(["/invocations/inv_c/resume?deployment=latest"]);
    await expect(endDeadLetter({ main: pg.db, patch }, row.id, "kill", "ada")).rejects.toThrow(
      /already ended/,
    );

    // Still paused at the next sweep: the retry failed the same way, the letter is back.
    const { n, said } = fakeNotifier();
    expect((await deadLetterPass({ main: pg.db, admin, notifier: n }, NOW)).filed).toBe(1);
    const back = (await deadLetterList(pg.db)).find((l) => l.invocationId === "inv_c");
    expect(back).toMatchObject({ id: row.id, end: null });
    expect(said.join()).toContain(`#${row.id}`);
  });

  it("drop closes the row and leaves Restate alone; kill needs the admin API", async () => {
    const admin = fakeAdmin(() => [paused("inv_d"), paused("inv_e")]);
    await deadLetterPass({ main: pg.db, admin }, NOW);
    const of = async (inv: string) => {
      const row = (await deadLetterList(pg.db)).find((l) => l.invocationId === inv);
      if (!row) throw new Error(`${inv} not filed`);
      return row.id;
    };
    expect((await endDeadLetter({ main: pg.db }, await of("inv_d"), "drop", "ada")).end).toBe(
      "dropped",
    );
    await expect(endDeadLetter({ main: pg.db }, await of("inv_e"), "kill", "ada")).rejects.toThrow(
      /WREN_RESTATE_ADMIN_URL/,
    );
  });
});
