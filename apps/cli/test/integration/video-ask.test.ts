/**
 * `wren video storyboard`, `wren video ask --apply` and `wren video undo` against a real Postgres
 * with a fake model (designs/2026-10-15-storyboard.md): the proposal checked as `video set`
 * checks it, saved only on --apply with what it replaced, refused when the model can't make a
 * valid patch in two asks, and taken back by undo. Synthetic rows only.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { getEdit } from "@wren/studio/edit";
import { videoEdits } from "@wren/studio/schema";
import { Command } from "commander";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { registerVideoAsk } from "../../src/video-ask.js";

let pg: TestPostgres;
/** What the fake model answers next, in order; the prompts it was asked. */
let answers: string[] = [];
const prompts: string[] = [];
const model = new FakeLlm({
  respond: (prompt) => {
    prompts.push(prompt);
    return answers.shift() ?? '{"changes": [], "patch": null}';
  },
});

beforeAll(async () => {
  pg = await startTestPostgres();
}, 240_000);
afterAll(async () => {
  await pg?.stop();
});
afterEach(() => {
  process.exitCode = undefined;
});

/** Runs the command, returns what it printed. */
async function wren(...argv: string[]): Promise<string> {
  const out: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...a) => {
    out.push(a.join(" "));
  });
  try {
    const program = new Command().exitOverride();
    const video = program.command("video");
    registerVideoAsk(
      video,
      (fn) => fn(pg.db),
      () => model,
    );
    await program.parseAsync(["node", "wren", "video", ...argv]);
  } finally {
    log.mockRestore();
  }
  return out.join("\n");
}

/** Four 25-word sentences, a word a second, with an "um" proposed as a filler cut. */
async function video() {
  const words = Array.from({ length: 100 }, (_, i) => ({
    w: i === 12 ? "um" : i % 25 === 24 ? "done." : i % 25 === 0 ? "Next" : "word",
    s: i,
    e: i + 0.8,
  }));
  const [v] = await pg.db
    .insert(videoEdits)
    .values({
      title: "Synthetic take",
      dir: "/rec",
      tracks: {
        main: { path: "/rec/main.mp4", durationS: 100, width: 1920, height: 1080, fps: 30 },
      },
      words,
      cuts: [{ from: 11.85, to: 12.9, why: "filler", state: "proposed" }],
    })
    .returning();
  return v?.id as number;
}

const runs = (id: number, command: string) =>
  pg.db.execute(
    sql`SELECT id::text, stats FROM runs WHERE command = ${command} AND argv->>'id' = ${String(id)} ORDER BY started_at`,
  ) as unknown as Promise<{ id: string; stats: Record<string, unknown> }[]>;

describe("wren video storyboard", () => {
  it("prints a frame per part with its words and layout", async () => {
    const id = await video();
    const out = await wren("storyboard", String(id));
    expect(out).toContain('"Synthetic take"');
    expect(out).toContain("Part 1 [part-1]");
    expect(out).toContain("corner");
    expect(out).toContain("0 Shorts");
  });
});

describe("wren video ask", () => {
  it("proposes without saving, then --apply saves through set and undo takes it back", async () => {
    const id = await video();
    const answer = JSON.stringify({
      changes: ["Cut the um at 0:12.", 'Put "Step one" on screen at 0:05.'],
      patch: {
        cuts: [{ from: 11.85, to: 12.9, state: "cut" }],
        overlays: [{ text: "Step one", from: 5, to: 8, x: 0.5, y: 0.2, size: "m" }],
      },
    });

    answers = [answer];
    const shown = await wren("ask", String(id), "cut the um, and say step one on screen");
    expect(shown).toContain("- Cut the um at 0:12.");
    expect(shown).toContain("Changes on the storyboard: header cutS, part-1");
    expect(prompts.at(-1)).toContain("He says: cut the um, and say step one on screen");
    expect((await getEdit(pg.db, id)).overlays).toEqual([]);

    answers = [answer];
    const applied = await wren("ask", String(id), "cut the um, and say step one", "--apply");
    expect(applied).toContain(`video ${id}: applied`);
    const after = await getEdit(pg.db, id);
    expect(after.cuts[0]?.state).toBe("cut");
    expect(after.overlays.map((o) => o.text)).toEqual(["Step one"]);
    const [proposed] = (await runs(id, "video propose")).slice(-1);
    expect(proposed?.stats.asks).toBe(1);
    const [set] = await runs(id, "video set");
    expect(set?.stats.proposal).toBe(proposed?.id);

    await wren("undo", String(id));
    const undone = await getEdit(pg.db, id);
    expect(undone.cuts[0]?.state).toBe("proposed");
    expect(undone.overlays).toEqual([]);
  });

  it("asks again with why once, then refuses to apply what still doesn't check", async () => {
    const id = await video();
    const bad = JSON.stringify({
      changes: ["One Short."],
      patch: { shorts: [{ from: 0, to: 24.9, title: "Alone" }] },
    });
    answers = [bad, bad];
    const out = await wren("ask", String(id), "make one Short", "--apply");
    expect(out).toContain("shorts: 1 picked; want 2 to 12");
    expect(out).toContain("Not applied");
    expect(process.exitCode).toBe(1);
    expect(prompts.at(-1)).toContain("Your last patch was refused: shorts: 1 picked");
    expect((await getEdit(pg.db, id)).shorts).toEqual([]);
    expect(await runs(id, "video set")).toEqual([]);
  });

  it("says why when it can't be done, and saves nothing", async () => {
    const id = await video();
    answers = ['{"changes": ["Caption size can\'t change here."], "patch": null}'];
    const out = await wren("ask", String(id), "bigger captions", "--apply");
    expect(out).toContain("Caption size can't change here.");
    expect(out).toContain("Nothing to apply.");
    expect(await runs(id, "video set")).toEqual([]);
  });
});
