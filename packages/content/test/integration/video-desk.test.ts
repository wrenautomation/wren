/**
 * A video edited from its page (`VideoDesk`) against Postgres and a Restate test environment,
 * over a fake desk `claude` and a fake Mac `studio`: fields saved with what they replaced, a bad
 * patch refused in words, a proposal cut and a span of words cut, Undo, Ask Claude's patch checked
 * and written by Wren, and a render queued, then done or failed with why. Synthetic rows only.
 */
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import { startTestRestate } from "@wren/core/testing";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { getEdit, setRendered } from "@wren/studio/edit";
import { videoEdits } from "@wren/studio/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeVideoDesk } from "../../src/restate/video-desk.js";
import { videoRecord } from "../../src/video.js";
import { videoTurns } from "../../src/video-ask.js";

const answers: string[] = [];
const asked: { question: string; system: string; commands: string[] }[] = [];
const fakeClaude = restate.service({
  name: "claude",
  handlers: {
    ask: async (_ctx: restate.Context, req: (typeof asked)[number]) => {
      asked.push(req);
      return { answer: answers.shift() ?? "{}", ms: 10, turns: 1, model: "fake", denied: 0 };
    },
  },
});

let pg: TestPostgres;
/** What the fake Mac does with the next render: finish it as the CLI would, or fail. */
let renders: ("ok" | "fail")[] = [];
const fakeStudio = () =>
  restate.service({
    name: "studio",
    handlers: {
      render: async (ctx: restate.Context, req: { id: number }) => {
        const how = await ctx.run("how", () => renders.shift() ?? "ok");
        if (how === "fail") throw new restate.TerminalError("ffmpeg: no such file");
        await ctx.run("done", () => setRendered(pg.db, req.id, { long: "/rec/out/long.mp4" }, {}));
        return { ms: 5 };
      },
    },
  });

let env: RestateTestEnvironment;
beforeAll(async () => {
  pg = await startTestPostgres();
  env = await startTestRestate({
    services: [fakeClaude, fakeStudio(), makeVideoDesk(pg.db)],
    alwaysReplay: true,
  });
});
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});

const desk = () =>
  clients
    .connect(ingressOf({ restateIngressUrl: env.baseUrl() }))
    .serviceClient<ReturnType<typeof makeVideoDesk>>({ name: "VideoDesk" });

const track = { path: "/rec/main.mp4", durationS: 120, width: 1920, height: 1080, fps: 30 };

async function video() {
  const [v] = await pg.db
    .insert(videoEdits)
    .values({
      title: "Synthetic take",
      dir: "/rec",
      tracks: { main: track },
      words: [
        { w: "so", s: 1, e: 1.3 },
        { w: "um", s: 2, e: 2.3 },
        { w: "this", s: 3, e: 3.4 },
        { w: "works", s: 3.5, e: 4 },
        { w: "fine", s: 5, e: 5.5 },
      ],
      cuts: [
        { from: 0, to: 0.9, why: "silence", state: "cut" },
        { from: 1.95, to: 2.35, why: "filler", state: "proposed" },
      ],
    })
    .returning();
  return v?.id as number;
}

async function settled(id: number) {
  for (let i = 0; i < 100; i++) {
    const turns = await videoTurns(pg.db, id);
    if (turns.every((t) => t.state !== "thinking")) return turns;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("still thinking");
}

describe("VideoDesk", () => {
  it("saves fields and cuts with what they replaced, refuses a bad patch, and undoes", async () => {
    const id = await video();
    await desk().set({ id, patch: { title: "A clear title", tags: ["demo", "crm"] } });
    expect(await getEdit(pg.db, id)).toMatchObject({
      title: "A clear title",
      tags: ["demo", "crm"],
      state: "edited",
    });
    await expect(desk().set({ id, patch: { title: "x".repeat(101) } })).rejects.toThrow(/title/);
    await expect(desk().set({ id, patch: { words: [] } })).rejects.toThrow(/words/);

    await desk().cut({ id, from: 1.95, to: 2.35, state: "cut" });
    await desk().cut({ id, from: 3, to: 4, state: "cut" });
    const cuts = (await getEdit(pg.db, id)).cuts;
    expect(cuts.find((c) => c.why === "filler")?.state).toBe("cut");
    expect(cuts).toContainEqual({ from: 3, to: 4, why: "manual", state: "cut" });
    await expect(desk().cut({ id, from: 7, to: 8, state: "kept" })).rejects.toThrow(/no cut/);

    await desk().undo({ id });
    expect((await getEdit(pg.db, id)).cuts.some((c) => c.why === "manual")).toBe(false);
    const turns = await videoTurns(pg.db, id);
    expect(turns.map((t) => t.command)).toEqual([
      "video set",
      "video keep",
      "video cut-words",
      "video undo",
    ]);

    const rec = videoRecord();
    const detail = (await rec.load?.(pg.db, String(id))) as {
      video: { cuts: { words: string; before: string; state: string }[]; edit: { title: string } };
    };
    expect(detail.video.edit.title).toBe("A clear title");
    expect(detail.video.cuts.find((c) => c.words === "um")).toMatchObject({
      before: "so",
      state: "cut",
    });
  });

  it("asks Claude, checks the patch it answers and writes it; a bad one writes nothing", async () => {
    const id = await video();
    answers.push(
      '```json\n{"reply": "Named it and cut the filler.", "patch": {"title": "Fix the CRM in a day", "cuts": [{"from": 1.95, "to": 2.35, "state": "cut"}]}}\n```',
    );
    await desk().ask({ id, message: "name it and cut the um" });
    const [turn] = await settled(id);
    expect(turn).toMatchObject({
      command: "video-ask",
      state: "done",
      reply: "Named it and cut the filler.",
      fields: ["title", "cuts"],
    });
    expect(asked[0]?.question).toContain("name it and cut the um");
    expect(asked[0]?.system).toContain("Synthetic take");
    expect(asked[0]?.commands).toEqual([`Bash(node scripts/prod-wren.mjs video show ${id})`]);
    const e = await getEdit(pg.db, id);
    expect(e.title).toBe("Fix the CRM in a day");
    expect(e.cuts.find((c) => c.why === "filler")?.state).toBe("cut");

    await desk().undo({ id });
    expect((await getEdit(pg.db, id)).title).toBe("Synthetic take");

    answers.push(
      '{"reply": "Here.", "patch": {"chapters": [{"at": 999, "title": "Past the end"}]}}',
    );
    await desk().ask({ id, message: "add a chapter" });
    const last = (await settled(id)).at(-1);
    expect(last).toMatchObject({ state: "failed" });
    expect(last?.error).toMatch(/Not written: .*past the end/);
  });

  it("queues a render on the Mac: waiting, then done; a failure says why", async () => {
    const id = await video();
    renders = ["ok", "fail"];
    await desk().render({ id });
    for (let i = 0; i < 50 && (await getEdit(pg.db, id)).render; i++)
      await new Promise((r) => setTimeout(r, 200));
    expect(await getEdit(pg.db, id)).toMatchObject({ state: "rendered", render: null });

    await desk().render({ id });
    let e = await getEdit(pg.db, id);
    for (let i = 0; i < 50 && e.render?.state !== "failed"; i++) {
      await new Promise((r) => setTimeout(r, 200));
      e = await getEdit(pg.db, id);
    }
    expect(e.render).toMatchObject({ state: "failed", why: "ffmpeg: no such file" });

    await pg.db
      .update(videoEdits)
      .set({ render: { state: "waiting", at: new Date().toISOString() } })
      .where(eq(videoEdits.id, id));
    await expect(desk().render({ id })).rejects.toThrow(/waiting for the Mac/);
  });
});
