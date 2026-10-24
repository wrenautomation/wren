import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { videoSource } from "./index.js";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** Cohere, faked: the speech and one on-screen line per frame time asked. */
const fetchFn = (async (input: string | URL | Request, init: RequestInit = {}) => {
  const url = String(input);
  if (url.endsWith("/v2/audio/transcriptions"))
    return Response.json({ text: "hello from the fixture" });
  if (url.endsWith("/v2/chat")) {
    const body = JSON.parse(String(init.body)) as {
      messages: { content: { type: string; text?: string }[] }[];
    };
    const text = body.messages[0]?.content.find((p) => p.type === "text")?.text ?? "";
    const times = (/Their times: ([^.]+)\./.exec(text)?.[1] ?? "").split(", ").filter(Boolean);
    return Response.json({
      message: {
        content: [{ type: "text", text: times.map((t) => `[${t}] caption ${t}`).join("\n") }],
      },
    });
  }
  throw new Error(`unexpected ${url}`);
}) as unknown as typeof fetch;

describe.skipIf(!hasFfmpeg)("videoSource", () => {
  let dir = "";
  let video = "";
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "video-source-test-"));
    video = join(dir, "fixture.mp4");
    // Made here, never committed: 2 s of colour bars, then 2 s of red (one cut), and a tone.
    execFileSync("ffmpeg", [
      ...["-hide_banner", "-loglevel", "error", "-y"],
      ...[
        "-filter_complex",
        "smptebars=s=320x240:r=10:d=2[a];color=c=red:s=320x240:r=10:d=2,format=yuv420p[b];[a]format=yuv420p[a2];[a2][b]concat=n=2:v=1:a=0[v];sine=f=440:d=4[s]",
      ],
      ...["-map", "[v]", "-map", "[s]", "-c:v", "libx264", "-c:a", "aac", "-shortest", video],
    ]);
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("is the SOP reader's source: caption, then Speech, On screen and Cuts, from a fetched reel", async () => {
    // Stands in for yt-dlp: copies the fixture to the -o file and prints the info JSON.
    const fake = join(dir, "yt-dlp.mjs");
    await writeFile(
      fake,
      `import { copyFileSync } from "node:fs";
const a = process.argv.slice(2);
copyFileSync(${JSON.stringify(video)}, a[a.indexOf("-o") + 1].replace("%(ext)s", "mp4"));
console.log(JSON.stringify({ id: "abc", title: "Video by x", extractor_key: "Instagram", channel: "x", upload_date: "20261003", description: "Four things\\nmore", webpage_url: "https://www.instagram.com/reel/abc/" }));`,
    );
    const s = await videoSource("https://www.instagram.com/reel/abc/", `node ${fake}`, 9, {
      cohereKeys: ["k1"],
      fetchFn,
      pause: async () => {},
    });
    expect(s.name).toBe("instagram-abc.md");
    expect(s.md).toContain('source: "instagram:abc"\ntitle: "Four things"');
    expect(s.md).toContain('uploaded: "2026-10-03"\npriority: 9');
    expect(s.md).toContain(
      "## Caption\n\nFour things\nmore\n\n## Speech\n\nhello from the fixture\n\n## On screen\n\n[0:00] caption 0:00",
    );
    expect(s.md).toMatch(/\n## Cuts\n\n\d:\d\d\.\d\n$/);
  }, 30_000);
});
