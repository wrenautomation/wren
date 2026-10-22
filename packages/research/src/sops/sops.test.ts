import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeLlm } from "@wren/llm";
import { afterEach, describe, expect, it } from "vitest";
import {
  addSource,
  askGemini,
  audioSource,
  buildSop,
  captionsMarkdown,
  clock,
  driveSources,
  expandCites,
  gatewayGemini,
  numberCites,
  readSopDir,
  sopPrompt,
  youtubeByUrl,
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
    await addSource(dir, { name: "file-a.md", md: "---\npriority: 2\n---\nlow" });
    await addSource(dir, { name: "file-b.md", md: "---\npriority: 9\n---\nhigh" });
    await writeFile(join(dir, "notes.md"), "mine");
    let prompt = "";
    const llm = new FakeLlm({
      respond: async (p) => {
        prompt = p;
        return "```markdown\n# SOP\n\n1. Do it [file-b 0:00]\n```";
      },
    });
    expect(await buildSop(dir, llm)).toBe(
      "# SOP\n\n1. Do it [1 0:00]\n\n## Sources\n\n1. file-b\n",
    );
    expect(prompt.indexOf('file="file-b"')).toBeLessThan(prompt.indexOf('file="file-a"'));
    expect(prompt).toContain("<notes>\nmine\n</notes>");
    expect(prompt).toContain("There is no SOP.md yet");
    const again = await readSopDir(dir);
    expect(again.current).toContain("Do it");
    expect(sopPrompt({ name: "x", ...again })).toContain("There is a current SOP.md below");
    expect(await readFile(join(dir, "notes.md"), "utf8")).toBe("mine");
  });
});

describe("numbered citations", () => {
  let dir = "";
  afterEach(() => (dir ? rm(dir, { recursive: true, force: true }) : undefined));
  it("numbers by first use, lists each source once, and round-trips", async () => {
    dir = await mkdtemp(join(tmpdir(), "sop-"));
    await addSource(dir, {
      name: "youtube-abc.md",
      md: '---\ntitle: "Talk"\nurl: "https://y"\n---\nx',
    });
    await addSource(dir, { name: "file-g.md", md: '---\ntitle: "G"\n---\nx' });
    const long =
      "- A [file-g] [youtube-abc 1:02]\n- B [youtube-abc caption] [other-zz 3:04] [youtube-abc 5:00, 6:00]\n";
    const short = await numberCites(dir, long);
    expect(short).toBe(
      '- A [1] [2 1:02]\n- B [2 caption] [other-zz 3:04] [2 5:00, 6:00]\n\n## Sources\n\n1. file-g, "G"\n2. youtube-abc, "Talk", https://y\n',
    );
    expect(expandCites(short)).toBe(long);
    expect(
      await numberCites(
        dir,
        `${short.split("\n## Sources")[0]}- C [file-g 0:01]\n${short.slice(short.indexOf("\n## Sources"))}`,
      ),
    ).toContain("- C [1 0:01]");
  });
});

describe("askGemini limits", () => {
  const quick = { pause: async () => {} };
  const stalls = ((_url: string, init: RequestInit) =>
    new Promise((_, reject) =>
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
    )) as unknown as typeof fetch;

  it("gives up on a call that never answers, and on an ask that outlasts its budget", async () => {
    const began = Date.now();
    const r = await askGemini({}, ["k"], stalls, "t", { callMs: 20, askMs: 150, ...quick });
    expect(r).toMatchObject({ unread: expect.stringMatching(/timeout|aborted/i) });
    expect(Date.now() - began).toBeLessThan(2_000);
  });

  it("treats a dropped connection as a refusal and asks the next key", async () => {
    const keys: string[] = [];
    const flaky = (async (_url: string, init: RequestInit) => {
      keys.push((init.headers as Record<string, string>)["x-goog-api-key"] as string);
      if (keys.length === 1) throw new TypeError("fetch failed");
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "hello" }] } }] }),
      );
    }) as typeof fetch;
    expect(await askGemini({}, ["a", "b"], flaky, "t", quick)).toEqual({ text: "hello" });
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("says it timed out when its time is gone before it asked", async () => {
    const busy = (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch;
    expect(await askGemini({}, ["k"], busy, "t", { askMs: 0, ...quick })).toEqual({
      unread: "timed out",
    });
  });
});

describe("youtube by URL", () => {
  it("reads speech and screen through the gateway, clips in order", async () => {
    const calls: { url: string; auth: string | null; goog: string | null; body: string }[] = [];
    const base = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const h = new Headers(init?.headers);
      calls.push({
        url,
        auth: h.get("authorization"),
        goog: h.get("x-goog-api-key"),
        body: String(init?.body ?? ""),
      });
      if (url.includes("oembed"))
        return Response.json({ title: "Cold email in 2026", author_name: "Synth Channel" });
      const body = JSON.parse(String(init?.body)) as {
        contents: { parts: { videoMetadata?: { startOffset: string }; text?: string }[] }[];
      };
      const parts = body.contents[0]?.parts ?? [];
      const start = parts[0]?.videoMetadata?.startOffset ?? "?";
      const speech = parts[1]?.text?.startsWith("Transcribe the speech");
      return Response.json({
        candidates: [{ content: { parts: [{ text: speech ? `said ${start}` : "none" }] } }],
      });
    }) as unknown as typeof fetch;
    const fetchFn = gatewayGemini("https://gw.example/v1", "tok", base);
    const s = await youtubeByUrl("https://youtu.be/abcdefghijk", {
      geminiKeys: ["gateway"],
      fetchFn,
      durationS: 900,
    });
    expect(s.name).toBe("youtube-abcdefghijk.md");
    expect(s.md).toContain('title: "Cold email in 2026"');
    expect(s.md).toContain('channel: "Synth Channel"');
    expect(s.md.indexOf("said 0s")).toBeLessThan(s.md.indexOf("said 600s"));
    expect(s.md).not.toContain("## On screen");
    const gemini = calls.filter((c) => !c.url.includes("oembed"));
    expect(gemini).toHaveLength(4);
    expect(gemini[0]?.url).toMatch(
      /^https:\/\/gw\.example\/v1beta\/models\/[\w.-]+:generateContent$/,
    );
    expect(gemini.every((c) => c.auth === "Bearer tok" && c.goog === null)).toBe(true);
  });
});

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("audio source", () => {
  it.skipIf(!hasFfmpeg)("cuts an episode into clips and keeps their order and times", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sops-audio-test-"));
    try {
      const file = join(dir, "tone.ogg");
      execFileSync("ffmpeg", [
        ...["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=f=440:d=3"],
        ...["-ac", "1", "-c:a", "libopus", "-b:a", "8k", file],
      ]);
      const audio = await readFile(file);
      const asks: string[] = [];
      const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://cdn.example.com/ep1.mp3") return new Response(audio);
        const body = JSON.parse(String(init?.body)) as {
          contents: { parts: { inlineData?: { mimeType: string }; text?: string }[] }[];
        };
        const parts = body.contents[0]?.parts ?? [];
        expect(parts[0]?.inlineData?.mimeType).toBe("audio/ogg");
        const at = /clip starts at ([\d:]+)/.exec(parts[1]?.text ?? "")?.[1] ?? "?";
        asks.push(at);
        return Response.json({ candidates: [{ content: { parts: [{ text: `heard ${at}` }] } }] });
      }) as unknown as typeof fetch;
      const s = await audioSource("https://cdn.example.com/ep1.mp3", {
        url: "https://show.example/ep1",
        title: "Episode one",
        creator: "Synth Show",
        geminiKeys: ["k"],
        fetchFn,
        // Two-second clips of a three-second tone: a 700 s episode took minutes to encode and cut.
        clipS: 2,
      });
      expect(asks.sort()).toEqual(["0:00", "0:02"]);
      expect(s.name).toMatch(/^podcast-[0-9a-f]{12}\.md$/);
      expect(s.md).toContain('channel: "Synth Show"');
      expect(s.md).toContain("duration: 3");
      expect(s.md.indexOf("heard 0:00")).toBeLessThan(s.md.indexOf("heard 0:02"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
