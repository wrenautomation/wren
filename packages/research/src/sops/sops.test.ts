import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeLlm } from "@wren/llm";
import { afterEach, describe, expect, it } from "vitest";
import {
  addSource,
  buildSop,
  captionsMarkdown,
  clock,
  driveSources,
  readSopDir,
  sopPrompt,
  videoSource,
} from "./index.js";

describe("sops", () => {
  let dir = "";
  afterEach(() => (dir ? rm(dir, { recursive: true, force: true }) : undefined));

  it("renders captions per chapter with a marker a minute", () => {
    const md = captionsMarkdown(
      {
        id: "v1",
        title: "T",
        upload_date: "20260101",
        chapters: [
          { start_time: 0, end_time: 90, title: "Intro" },
          { start_time: 90, end_time: 200, title: "Copy" },
        ],
      },
      {
        events: [
          { tStartMs: 1000, segs: [{ utf8: "hello" }, { utf8: " there" }] },
          { tStartMs: 70000, segs: [{ utf8: "later" }] },
          { tStartMs: 95000 },
          { tStartMs: 95000, segs: [{ utf8: "second" }] },
          { tStartMs: 3700000, segs: [{ utf8: "past the end" }] },
        ],
      },
      9,
    );
    expect(md).toContain('source: "youtube:v1"');
    expect(md).toContain('uploaded: "2026-01-01"\npriority: 9');
    expect(md).toContain("## [0:00] Intro\n[0:01] hello there \n[1:10] later");
    expect(md).toContain("## [1:30] Copy\n[1:35] second");
    expect(md).not.toContain("past the end");
    expect(clock(3725)).toBe("1:02:05");
  });

  it("transcribes a captionless video: speech and screen apart, keys rotated, recitation paraphrased", async () => {
    dir = await mkdtemp(join(tmpdir(), "sops-video-"));
    // Stands in for yt-dlp: writes the -o file, prints the info JSON.
    const fake = join(dir, "yt-dlp.mjs");
    await writeFile(
      fake,
      `import { writeFileSync } from "node:fs";
const a = process.argv.slice(2);
writeFileSync(a[a.indexOf("-o") + 1].replace("%(ext)s", "mp4"), "vid");
console.log(JSON.stringify({ id: "abc", title: "Video by x", extractor_key: "Instagram", channel: "x", upload_date: "20261003", description: "Four things\\nmore", webpage_url: "https://www.instagram.com/reel/abc/" }));`,
    );
    const keys: string[] = [];
    const bodies: string[] = [];
    const reply = (part: object) =>
      new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", ...part }] }));
    const fetchFn = (async (_url: string, init: RequestInit) => {
      keys.push((init.headers as Record<string, string>)["x-goog-api-key"] as string);
      const body = String(init.body);
      bodies.push(body);
      if (keys.length === 1) return new Response("{}", { status: 429 });
      if (body.includes("Transcribe the speech"))
        return reply({ content: { parts: [{ text: "[0:00] hi" }] } });
      return body.includes("in your own words")
        ? reply({ content: { parts: [{ text: "[0:00:01] a post, paraphrased" }] } })
        : reply({ finishReason: "RECITATION" });
    }) as typeof fetch;
    const s = await videoSource("https://www.instagram.com/reel/abc/", `node ${fake}`, 9, {
      geminiKeys: ["k1", "k2"],
      fetchFn,
    });
    expect(s.name).toBe("instagram-abc.md");
    expect(s.md).toContain('source: "instagram:abc"\ntitle: "Four things"');
    expect(s.md).toContain('uploaded: "2026-10-03"\npriority: 9');
    expect(s.md).toContain(
      "## Caption\n\nFour things\nmore\n\n## Speech\n\n[0:00] hi\n\n## On screen\n\n[0:00:01] a post, paraphrased\n",
    );
    expect(new Set(keys).size).toBe(2);
    expect(bodies.filter((b) => !b.includes("speech") && !b.includes("own words"))).toHaveLength(3);
    expect(bodies[0]).toContain(Buffer.from("vid").toString("base64"));
  }, 10_000);

  it("walks a Drive folder and exports only Docs and text", async () => {
    const calls: string[] = [];
    const drive = async (path: string, body: Record<string, unknown>) => {
      calls.push(path);
      if (path === "/drive/v3/files") {
        const inFolder = String(body.q).startsWith("'root'");
        return {
          files: inFolder
            ? [
                { id: "sub", name: "Sub", mimeType: "application/vnd.google-apps.folder" },
                { id: "img", name: "pic.png", mimeType: "image/png" },
              ]
            : [
                {
                  id: "d1",
                  name: "Tips",
                  mimeType: "application/vnd.google-apps.document",
                  modifiedTime: "2026-09-15T00:00:00Z",
                },
              ],
        };
      }
      return { text: "  be brief\n" };
    };
    const out = await driveSources("root", drive, 4);
    expect(out.map((s) => s.name)).toEqual(["drive-d1.md"]);
    expect(out[0]?.md).toContain('path: "Sub/Tips"\nmodified: "2026-09-15"\npriority: 4');
    expect(out[0]?.md).toContain("# Tips\n\nbe brief\n");
    expect(calls).toEqual(["/drive/v3/files", "/drive/v3/files", "/drive/v3/files/d1/export"]);
  });

  it("builds from notes and sources, highest priority first, keeping the current SOP in view", async () => {
    dir = await mkdtemp(join(tmpdir(), "sop-"));
    await addSource(dir, { name: "a.md", md: "---\npriority: 2\n---\nlow" });
    await addSource(dir, { name: "b.md", md: "---\npriority: 9\n---\nhigh" });
    await writeFile(join(dir, "notes.md"), "mine");
    let prompt = "";
    const llm = new FakeLlm({
      respond: async (p) => {
        prompt = p;
        return "```markdown\n# SOP\n\n1. Do it [b 0:00]\n```";
      },
    });
    expect(await buildSop(dir, llm)).toBe("# SOP\n\n1. Do it [b 0:00]\n");
    expect(prompt.indexOf('file="b"')).toBeLessThan(prompt.indexOf('file="a"'));
    expect(prompt).toContain("<notes>\nmine\n</notes>");
    expect(prompt).toContain("There is no SOP.md yet");
    const again = await readSopDir(dir);
    expect(again.current).toContain("Do it");
    expect(sopPrompt({ name: "x", ...again })).toContain("There is a current SOP.md below");
    expect(await readFile(join(dir, "notes.md"), "utf8")).toBe("mine");
  });
});
