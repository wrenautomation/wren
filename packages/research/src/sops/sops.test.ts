import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeLlm } from "@wren/llm";
import { afterEach, describe, expect, it } from "vitest";
import {
  addSource,
  buildSop,
  driveSources,
  expandCites,
  numberCites,
  readSopDir,
  sopPrompt,
  toSource,
} from "./index.js";

describe("sops", () => {
  let dir = "";
  afterEach(() => (dir ? rm(dir, { recursive: true, force: true }) : undefined));

  it("files a scribe read with its facts and the priority as front matter", () => {
    const src = toSource(
      {
        kind: "youtube",
        id: "v1",
        title: "T",
        url: "https://www.youtube.com/watch?v=v1",
        channel: "C",
        uploaded: "2026-01-01",
        duration: 200,
        body: "## [0:00] Intro\n[0:01] hello\n",
      },
      9,
    );
    expect(src.name).toBe("youtube-v1.md");
    expect(src.md).toBe(
      '---\nsource: "youtube:v1"\ntitle: "T"\nurl: "https://www.youtube.com/watch?v=v1"\nchannel: "C"\nuploaded: "2026-01-01"\npriority: 9\nduration: 200\n---\n\n# T\n\n## [0:00] Intro\n[0:01] hello\n',
    );
    const bare = toSource({ kind: "podcast", id: "abc", title: "E", url: "u", body: "" });
    expect(bare.md).toContain('url: "u"\npriority: 5\n---');
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

  it("reads calls.md and standard.md into the prompt, and keeps the notes' front matter out of it", async () => {
    dir = await mkdtemp(join(tmpdir(), "sop-"));
    await writeFile(join(dir, "notes.md"), "---\nkinds: film\nset: linear\n---\n# Notes\n\nmine");
    await writeFile(
      join(dir, "calls.md"),
      "# Calls\n\n- Hook style: demo-first: keep 3 → rule [learn:1, learn:2, learn:3]",
    );
    await writeFile(
      join(dir, "standard.md"),
      "# Standard\n\n## film (3 pieces)\n- Length (s): median 42",
    );
    const read = await readSopDir(dir);
    expect(read.notes).toBe("# Notes\n\nmine");
    const prompt = sopPrompt({ name: "x", ...read });
    expect(prompt).toContain("<notes>\n# Notes\n\nmine\n</notes>");
    expect(prompt).toContain(
      "<calls>\n# Calls\n\n- Hook style: demo-first: keep 3 → rule [learn:1, learn:2, learn:3]\n</calls>",
    );
    expect(prompt).toContain(
      "<standard>\n# Standard\n\n## film (3 pieces)\n- Length (s): median 42\n</standard>",
    );
    expect(prompt.indexOf("<notes>\n")).toBeLessThan(prompt.indexOf("<calls>\n"));
    expect(prompt.indexOf("<calls>\n")).toBeLessThan(prompt.indexOf("<standard>\n"));
    const bare = sopPrompt({
      name: "x",
      notes: "",
      calls: "",
      standard: "",
      current: "",
      sources: [],
    });
    expect(bare).toContain("<calls>\n(none yet)\n</calls>");
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
