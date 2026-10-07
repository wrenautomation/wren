/**
 * Surveys on a real Postgres (`../../src/survey-store.ts`): the team adds one in draft, edits
 * when and who as words, Go live puts a site survey on the edge push, a client login gets its
 * portal survey once and answers it once, and the record tallies by week. Synthetic throughout.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addMember,
  addOperator,
  clientMembers,
  clients,
  operators,
} from "../../src/clients/index.js";
import { consoleApi } from "../../src/console.js";
import { editRecord } from "../../src/edits.js";
import type { FlagDef } from "../../src/flags.js";
import type { PortalRefusal } from "../../src/portal.js";
import { surveyAnswers, surveys } from "../../src/schema.js";
import { surveyRecord, writeSurveyDays } from "../../src/survey-store.js";
import type { SurveyDef } from "../../src/surveys.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

let pushed: SurveyDef[][] = [];
const edge = async (_: readonly FlagDef[], live: readonly SurveyDef[]) => {
  pushed.push([...live]);
};
const by = "ada@example.test";
beforeEach(async () => {
  pushed = [];
  await truncate(pg.db, [
    "survey_answers",
    "survey_days",
    "surveys",
    "flags",
    "changes",
    "client_members",
    "operators",
    "clients",
  ]);
  await pg.db.insert(clients).values([
    { id: "acme", name: "Acme", database: "wren_client_acme" },
    { id: "beta", name: "Beta", database: "wren_client_beta" },
  ]);
  await addOperator(pg.db, by);
  await addOperator(pg.db, "otto@example.test");
  await pg.db
    .update(operators)
    .set({ role: "operator" })
    .where(eq(operators.email, "otto@example.test"));
  await addMember(pg.db, "acme", "owen@acme.test", { role: "owner" });
  await addMember(pg.db, "beta", "bea@beta.test", { role: "owner" });
});

const api = () => consoleApi({ main: pg.db, views: [], edge });
const ADMIN = { email: by, operator: true, team: { role: "admin", clients: null } };
const OPERATOR = {
  email: "otto@example.test",
  operator: true,
  team: { role: "operator", clients: null },
};
const OWEN = { email: "owen@acme.test" };
const BEA = { email: "bea@beta.test" };
const refused = async (p: Promise<unknown>, status: number) => {
  const err = (await p.catch((e: unknown) => e)) as PortalRefusal;
  expect(err.status).toBe(status);
};
const card = surveyRecord(edge);
const add = (o: Record<string, unknown>) =>
  api().surveyAdd({ viewer: ADMIN as never, ...o } as never);

describe("surveys", () => {
  it("adds in draft, edits when and who as words, refuses what doesn't parse", async () => {
    await add({ key: "fit", question: "Is this for you?", choices: "Yes\nNo" });
    await refused(add({ key: "fit", question: "Again?", choices: "a,b" }), 409);
    await refused(add({ key: "one", question: "One choice?", choices: "Yes" }), 400);
    await refused(add({ key: "Bad Key", question: "?", kind: "text" }), 400);
    await refused(
      api().surveyAdd({
        viewer: OPERATOR as never,
        key: "x",
        question: "?",
        kind: "text",
      } as never),
      403,
    );

    await editRecord(pg.db, card, "fit", {
      patch: { when: "view on /agencies after 20s", who: "channels email\nflag hero b" },
      by,
    });
    await refused(editRecord(pg.db, card, "fit", { patch: { when: "soon" }, by }), 400);
    await refused(editRecord(pg.db, card, "fit", { patch: { who: "clients acme" }, by }), 400);
    const [s] = await pg.db.select().from(surveys).where(eq(surveys.key, "fit"));
    expect(s).toMatchObject({
      state: "draft",
      trigger: { on: "view", page: "/agencies", after: 20 },
      audience: { channels: ["email"], flag: { key: "hero", variant: "b" } },
    });
    expect(pushed).toEqual([]);
  });

  it("Go live puts a site survey on the edge; pause takes it off; remove only when not live", async () => {
    await add({ key: "fit", question: "Is this for you?", choices: "Yes\nNo" });
    await refused(api().surveyStart({ viewer: OPERATOR as never, ids: ["fit"] }), 403);
    expect(await api().surveyStart({ viewer: ADMIN as never, ids: ["fit"] })).toEqual({
      done: ["fit"],
    });
    expect(pushed.at(-1)).toEqual([
      {
        key: "fit",
        question: "Is this for you?",
        kind: "choice",
        choices: ["Yes", "No"],
        trigger: { on: "view" },
        audience: {},
      },
    ]);
    await refused(
      editRecord(pg.db, card, "fit", { patch: { choices: "Yes\nNo\nMaybe" }, by }),
      400,
    );
    await editRecord(pg.db, card, "fit", { patch: { when: "exit" }, by });
    expect(pushed.at(-1)?.[0]?.trigger).toEqual({ on: "exit" });
    expect(await api().surveyRemove({ viewer: ADMIN as never, ids: ["fit"] })).toEqual({
      done: [],
    });
    await api().surveyPause({ viewer: ADMIN as never, ids: ["fit"] });
    expect(pushed.at(-1)).toEqual([]);
    expect(await api().surveyRemove({ viewer: ADMIN as never, ids: ["fit"] })).toEqual({
      done: ["fit"],
    });
  });

  it("a client login gets its portal survey once, after its days, and answers once", async () => {
    await add({
      key: "score",
      question: "How likely are you to recommend us?",
      kind: "scale",
      surface: "portal",
    });
    await editRecord(pg.db, card, "score", {
      patch: { when: "view after 30d", who: "clients acme" },
      by,
    });
    await api().surveyStart({ viewer: ADMIN as never, ids: ["score"] });
    expect(pushed).toEqual([]);

    const due = (v: object) => api().surveysDue({ viewer: v as never });
    expect(await due(OWEN)).toEqual([]);
    await pg.db
      .update(clientMembers)
      .set({ invitedAt: new Date(Date.now() - 31 * 86_400_000) })
      .where(eq(clientMembers.email, "owen@acme.test"));
    expect((await due(OWEN)).map((s) => s.key)).toEqual(["score"]);
    expect(await due(BEA)).toEqual([]);
    expect(await due(ADMIN)).toEqual([]);

    await refused(api().surveyAnswer({ viewer: OWEN as never, survey: "score", value: 11 }), 400);
    await refused(api().surveyAnswer({ viewer: ADMIN as never, survey: "score", value: 9 }), 403);
    expect(await api().surveyAnswer({ viewer: OWEN as never, survey: "score", value: 9 })).toEqual({
      saved: true,
    });
    expect(await api().surveyAnswer({ viewer: OWEN as never, survey: "score", value: 3 })).toEqual({
      saved: false,
    });
    expect(await due(OWEN)).toEqual([]);
    const answers = await pg.db.select().from(surveyAnswers);
    expect(answers).toMatchObject([
      { survey: "score", client: "acme", person: "owen@acme.test", value: "9" },
    ]);

    const rows = (await card.rows?.(pg.db)) ?? [];
    expect(rows[0]).toMatchObject({
      id: "score",
      answers: 1,
      who: "clients acme",
      when: "view after 30d",
    });
    expect(String(rows[0]?.newest)).toContain("acme owen@acme.test: 9");
  });

  it("upserts site days, skips removed surveys, and tallies by week", async () => {
    await add({ key: "fit", question: "Is this for you?", choices: "Yes\nNo" });
    const day = (d: string, value: string, channel: string, answers: number) => ({
      survey: "fit",
      day: d,
      value,
      channel,
      answers,
    });
    await writeSurveyDays(pg.db, [
      day("2026-09-30", "Yes", "email", 1),
      day("2026-10-01", "No", "direct", 1),
    ]);
    expect(
      await writeSurveyDays(pg.db, [
        day("2026-09-30", "Yes", "email", 3),
        day("2026-10-06", "Yes", "search", 2),
        { ...day("2026-10-06", "Yes", "search", 2), survey: "gone" },
      ]),
    ).toBe(2);
    const [row] = (await card.rows?.(pg.db)) ?? [];
    expect(row).toMatchObject({ answers: 6 });
    expect(row?.tallies).toBe(
      ["All: Yes 5 · No 1", "Week of 2026-10-05: Yes 2", "Week of 2026-09-28: Yes 3 · No 1"].join(
        "\n",
      ),
    );
  });
});
