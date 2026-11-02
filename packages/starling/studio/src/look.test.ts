import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cohereLooker, TL_FREE_MINUTES, twelvelabsLooker } from "./look.js";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const answer = JSON.stringify({
  summary: "a test",
  moments: [],
  shorts: [],
  chapters: [],
  thumbnails: [],
});

describe("twelvelabsLooker", () => {
  it("stops before any call that would pass the free minutes", async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(url);
      return new Response("{}");
    }) as unknown as typeof fetch;
    const look = twelvelabsLooker("k", {
      usedMinutes: TL_FREE_MINUTES - 3,
      durationS: 150,
      cut: "v1",
      fetchFn: fake,
    });
    await expect(look("/nope.mp4", "")).rejects.toThrow(/needs 6 min/);
    expect(calls).toEqual([]);
  });

  it("reuses the indexed cut: analysis only, minutes added once", async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(new URL(url).pathname);
      return new Response(JSON.stringify({ data: answer, finish_reason: "stop" }));
    }) as unknown as typeof fetch;
    const look = twelvelabsLooker("k", { usedMinutes: 0, durationS: 61, cut: "v1", fetchFn: fake });
    const out = await look("/nope.mp4", "", { id: "i", asset: "a", cut: "v1", minutes: 4 });
    expect(calls).toEqual(["/v1.3/analyze"]);
    expect(out.media).toEqual({ id: "i", asset: "a", cut: "v1", minutes: 6 });
    expect(out.summary).toBe("a test");
  });
});

describe("cohereLooker", () => {
  it("needs a key", () => {
    expect(() => cohereLooker([])).toThrow(/no COHERE keys/);
  });

  it.skipIf(!hasFfmpeg)(
    "watches the file (cuts, screen text, no transcription), then asks the text model for the look",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "look-cohere-"));
      try {
        // Made here, never committed: 2 s of colour bars, then 2 s of red (one cut).
        const file = join(dir, "cut.mp4");
        execFileSync("ffmpeg", [
          ...["-hide_banner", "-loglevel", "error", "-y"],
          ...[
            "-filter_complex",
            "smptebars=s=320x240:r=10:d=2,format=yuv420p[a];color=c=red:s=320x240:r=10:d=2,format=yuv420p[b];[a][b]concat=n=2:v=1:a=0[v]",
          ],
          ...["-map", "[v]", "-c:v", "libx264", file],
        ]);
        const calls: { path: string; body: string }[] = [];
        // Cohere's v2 chat reply, as the AI SDK parses it.
        const chat = (text: string) =>
          Response.json({
            message: { role: "assistant", content: [{ type: "text", text }] },
            finish_reason: "COMPLETE",
            usage: { tokens: { input_tokens: 1, output_tokens: 1 } },
          });
        const fake = (async (url: string, init: RequestInit) => {
          const path = new URL(url).pathname;
          const body = String(init.body);
          calls.push({ path, body });
          expect(path).toBe("/v2/chat");
          const content = JSON.parse(body).messages[0].content as
            | string
            | { type: string; text?: string }[];
          if (Array.isArray(content)) {
            const text = content.find((p) => p.type === "text")?.text ?? "";
            const times = (/Their times: ([^.]+)\./.exec(text)?.[1] ?? "").split(", ");
            return chat(times.map((t) => `[${t}] title card ${t}`).join("\n"));
          }
          return chat(answer);
        }) as unknown as typeof fetch;
        const look = await cohereLooker(["k"], { fetchFn: fake })(file, "the words of the edit");
        expect(look.summary).toBe("a test");
        // One vision call, then one text ask; no transcription.
        expect(calls).toHaveLength(2);
        const ask = JSON.parse(calls[1]?.body ?? "{}") as {
          model: string;
          messages: { content: string }[];
        };
        expect(ask.model).toBe("command-a-03-2025");
        const prompt = ask.messages[0]?.content ?? "";
        expect(prompt).toContain("the words of the edit");
        expect(prompt).toContain("Scene cuts: 0:02.0");
        expect(prompt).toContain("[0:00] title card 0:00");
        expect(prompt).toContain("[0:02] title card 0:02");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
