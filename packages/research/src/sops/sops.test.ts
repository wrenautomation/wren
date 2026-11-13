import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeLlm } from "@wren/llm";
import { git, readRecord } from "@wrenautomation/knowledge";
import { afterEach, describe, expect, it } from "vitest";
import {
  addSource,
  buildSop,
  driveSources,
  expandCites,
  firstStep,
  numberCites,
  pageSource,
  readSopDir,
  sopPrompt,
  topicDir,
  toSource,
} from "./index.js";

const WHO = { by: "test", why: "test" };

/** An empty record repo: git, knowledge.json, one commit. */
async function repo(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "sop-"));
  git(d, ["init", "-q", "-b", "main"]);
  for (const [k, v] of [
    ["user.email", "t@example.com"],
    ["user.name", "t"],
    ["commit.gpgsign", "false"],
  ] as const)
    git(d, ["config", k, v]);
  await writeFile(join(d, "knowledge.json"), JSON.stringify({ owner: "test" }));
  git(d, ["add", "knowledge.json"]);
  git(d, ["commit", "-q", "-m", "init"]);
  return d;
}

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
    dir = await repo();
    await addSource(dir, "x", { name: "file-a.md", md: "---\npriority: 2\n---\nlow" }, WHO);
    await addSource(dir, "x", { name: "file-b.md", md: "---\npriority: 9\n---\nhigh" }, WHO);
    await writeFile(join(topicDir(dir, "x"), "notes.md"), "mine");
    let prompt = "";
    const llm = new FakeLlm({
      respond: async (p) => {
        prompt = p;
        return "```markdown\n# SOP\n\n1. Do it [file-b 0:00]\n```";
      },
    });
    expect(await buildSop(dir, "x", llm, WHO)).toBe(
      '# SOP\n\n1. Do it [1 0:00]\n\n## The owner\'s notes (they beat every source)\n\nmine\n\n## Sources\n\n1. file-b, "file-b" (human: test)\n',
    );
    expect(readRecord(dir, "x")?.fm).toMatchObject({ type: "guide", cites: ["file-b"] });
    expect(prompt.indexOf('file="file-b"')).toBeLessThan(prompt.indexOf('file="file-a"'));
    expect(prompt).toContain("<notes>\nmine\n</notes>");
    expect(prompt).toContain("There is no SOP yet");
    const again = await readSopDir(dir, "x");
    expect(again.current).toContain("Do it [file-b 0:00]");
    expect(sopPrompt({ name: "x", ...again })).toContain("There is a current SOP below");
    expect(await readFile(join(topicDir(dir, "x"), "notes.md"), "utf8")).toBe("mine");
    expect(await readFile(join(topicDir(dir, "x"), "SKILL.md"), "utf8")).toContain("render x");
  });

  it("loads each set at the step that first names it when the door is over budget", async () => {
    dir = await repo();
    await addSource(dir, "x", { name: "file-a.md", md: "---\npriority: 5\n---\nsrc" }, WHO);
    const reply = `# SOP\n\n## Prep\n\n1. Read\n2. Check XR-1\n\n<!-- set x-rules XR "Rules" -->\n- ${"word ".repeat(6000)}[file-a]\n<!-- /set -->\n`;
    await buildSop(dir, "x", new FakeLlm({ respond: async () => reply }), WHO);
    const door = await readFile(join(topicDir(dir, "x"), "SKILL.md"), "utf8");
    expect(door).toContain('- `x-rules`: before "Prep", step 2.');
    expect(door).not.toContain("render x-rules`");
  });

  it("splits a build doc into a guide and rule sets with fixed line ids", async () => {
    dir = await repo();
    await addSource(dir, "x", { name: "file-a.md", md: "---\npriority: 5\n---\nsrc" }, WHO);
    let reply =
      '# SOP\n\nDo the thing.\n\n1. Step [file-a]\n\n<!-- set x-rules XR "Rules" -->\n- One [file-a]\n- Two [file-a]\n<!-- /set -->\n';
    const llm = new FakeLlm({ respond: async () => reply });
    const first = await buildSop(dir, "x", llm, WHO);
    expect(first).toContain("## Rules\n- **XR-1** One [1]\n- **XR-2** Two [1]");
    expect(first).not.toContain("<!--");
    expect(readRecord(dir, "x")?.fm.cites).toEqual(["file-a", "x-rules"]);
    const set = readRecord(dir, "x-rules");
    expect(set?.fm).toMatchObject({ type: "rule", topic: "x", prefix: "XR", last: 2 });
    const read = await readSopDir(dir, "x");
    expect(read.current).toContain('<!-- set x-rules XR "Rules" -->\n- **XR-1** One [file-a]');
    expect(await readFile(join(topicDir(dir, "x"), "SKILL.md"), "utf8")).toContain(
      "render x-rules`",
    );
    // drop XR-1, keep XR-2, add one: the new line is XR-3, never XR-1 again
    reply =
      '# SOP\n\nDo the thing.\n\n1. Step [file-a]\n\n<!-- set x-rules XR "Rules" -->\n- **XR-2** Two [file-a]\n- Three [file-a]\n<!-- /set -->\n';
    await buildSop(dir, "x", llm, WHO);
    expect(readRecord(dir, "x-rules")?.body).toContain("- **XR-2** Two [1]\n- **XR-3** Three [1]");
    expect(readRecord(dir, "x-rules")?.fm).toMatchObject({ last: 3 });
    // the stored doc back unchanged: no record changes, so no guide that cites the set turns stale
    reply =
      '# SOP\n\nDo the thing.\n\n1. Step [file-a]\n\n<!-- set x-rules XR "Rules" -->\n- **XR-2** Two [file-a]\n- **XR-3** Three [file-a]\n<!-- /set -->\n';
    const head = git(dir, ["rev-parse", "HEAD"]);
    await buildSop(dir, "x", llm, WHO);
    expect(git(dir, ["rev-parse", "HEAD"])).toBe(head);
    expect(readRecord(dir, "x-rules")?.fm.version).toBe(2);
    // the procedure may only name a live line
    reply =
      '# SOP\n\nDo it. Check XR-1.\n\n<!-- set x-rules XR "Rules" -->\n- **XR-2** Two [file-a]\n- **XR-3** Three [file-a]\n<!-- /set -->\n';
    await expect(buildSop(dir, "x", llm, WHO)).rejects.toThrow("names XR-1");
    // XR-1 was dropped: the model may not bring the id back, or invent one
    reply =
      '# SOP\n\nDo it.\n\n<!-- set x-rules XR "Rules" -->\n- **XR-2** Two [file-a]\n- **XR-1** New [file-a]\n<!-- /set -->\n';
    await expect(buildSop(dir, "x", llm, WHO)).rejects.toThrow(
      "XR-1 is not a line of the stored set",
    );
    reply = "# SOP\n\nDo the thing.\n\n1. Step [file-a]\n";
    await expect(buildSop(dir, "x", llm, WHO)).rejects.toThrow("dropped set x-rules");
    reply =
      '# SOP\n\nDo it.\n\n<!-- set x-rules XR "Rules" -->\n- **XR-2** Two [file-a]\n<!-- /set -->\n\n<!-- set x-bare "Bare" -->\n- No cite\n<!-- /set -->\n';
    await expect(buildSop(dir, "x", llm, WHO)).rejects.toThrow("x-bare cites no source or call");
  });

  it("files a page by its source id, and a repo by its README", async () => {
    const pages: Record<string, string> = {
      "https://emilkowal.ski/ui/x":
        '<html><head><title>Good UI</title><meta property="og:image" content="/p.png"><meta name="author" content="Emil Kowalski, A. Person"><meta property="article:published_time" content="2026-10-01T09:00:00Z"><meta property="og:site_name" content="Emil"></head><body><p>Springs.</p></body></html>',
      "https://example.com/plain":
        "<html><head><title>Plain</title></head><body><p>Words.</p></body></html>",
      "https://github.com/acme/kit":
        "<html><head><title>acme/kit</title></head><body>nav</body></html>",
      "https://raw.githubusercontent.com/acme/kit/HEAD/README.md": "# Kit\n\nThe whole readme.",
    };
    const fetcher = {
      userAgent: "test",
      get: async (url: string) =>
        url in pages
          ? { status: 200, url, text: pages[url] ?? "" }
          : { status: 404, url, text: "" },
    };
    const page = await pageSource("https://emilkowal.ski/ui/x", fetcher);
    expect(page.name).toBe("web-emilkowal-ski-ui-x.md");
    expect(page.md).toContain('image: "https://emilkowal.ski/p.png"');
    expect(page.md).toContain("Springs.");
    const repoSource = await pageSource("https://github.com/acme/kit", fetcher);
    expect(repoSource.name).toBe("github-acme-kit.md");
    expect(repoSource.md).toContain("The whole readme.");
    expect(repoSource.md).not.toContain("nav");
    expect(repoSource.md).toContain('channel: "acme"');
    expect(page.md).toContain('channel: "Emil Kowalski; A. Person"');
    expect(page.md).toContain('site: "Emil"');
    expect(page.md).toMatch(/uploaded: "2026-10-01T09:00:00(\.000)?Z"/);
    const plain = await pageSource("https://example.com/plain", fetcher);
    expect(plain.md).not.toMatch(/channel:|site:|uploaded:/);
  });

  it("reads an arxiv PDF link as its abstract page, and never files a PDF's bytes", async () => {
    const abs = `<html><head><title>[2512.00001] A paper</title></head><body><p>The abstract.</p></body></html>`;
    const fetcher = {
      userAgent: "test",
      get: async (url: string) =>
        url === "https://arxiv.org/abs/2512.00001"
          ? { status: 200, url, text: abs }
          : { status: 200, url, text: "%PDF-1.7\n\u0000\u0001 binary" },
    };
    // bytes with no text in them: pdfText answers null
    const real = globalThis.fetch;
    globalThis.fetch = (async () => new Response(new Uint8Array([0, 1, 2]))) as typeof fetch;
    try {
      const paper = await pageSource("https://arxiv.org/pdf/2512.00001", fetcher);
      expect(paper.name).toBe("arxiv-2512.00001.md");
      expect(paper.md).toContain("The abstract.");
      expect(paper.md).not.toContain("%PDF");
      const html = await pageSource("https://arxiv.org/html/2512.00001", fetcher);
      expect(html.name).toBe("arxiv-2512.00001.md");
      expect(html.md).toContain("The abstract.");
      await expect(pageSource("https://example.com/a.pdf", fetcher)).rejects.toThrow(
        /no readable text/,
      );
    } finally {
      globalThis.fetch = real;
    }
  });

  it("keeps a giver's old note and adds a new one under it, whole", async () => {
    dir = await repo();
    const long = `insane editing ${"very high aura ".repeat(40)}`.trim();
    const src = { name: "file-a.md", md: "---\n---\nbody" };
    const by = { by: "william", at: "2026-11-12" };
    await addSource(dir, null, src, WHO, { note: { text: "editing style", ...by } });
    await addSource(dir, null, src, WHO, { note: { text: long, ...by } });
    await addSource(dir, null, src, WHO, { note: { text: long, ...by } });
    expect(readRecord(dir, "file-a")?.fm.note).toEqual({ text: `editing style\n\n${long}`, ...by });
  });

  it("raises an agent's provider to a person's, never back", async () => {
    dir = await repo();
    const src = { name: "file-a.md", md: "---\n---\nbody" };
    await addSource(dir, null, src, WHO, { provider: { kind: "agent", who: "cc" } });
    await addSource(dir, null, src, WHO, { provider: { kind: "human", who: "william" } });
    await addSource(dir, null, src, WHO, { provider: { kind: "human", who: "else" } });
    expect(readRecord(dir, "file-a")?.fm.provider).toEqual({ kind: "human", who: "william" });
  });

  it("tags a source shared by two SOPs once, in one record", async () => {
    dir = await repo();
    await addSource(dir, "x", { name: "file-a.md", md: '---\ntitle: "A"\n---\nbody' }, WHO);
    await addSource(dir, "y", { name: "file-a.md", md: '---\ntitle: "A"\n---\nbody' }, WHO);
    expect(readRecord(dir, "file-a")?.fm.tags).toEqual(["x", "y"]);
    expect((await readSopDir(dir, "y")).sources.map((s) => s.name)).toEqual(["file-a"]);
  });

  it("reads calls.md and standard.md into the prompt, and keeps the notes' front matter out of it", async () => {
    dir = await repo();
    const t = topicDir(dir, "x");
    await mkdir(t, { recursive: true });
    await writeFile(join(t, "notes.md"), "---\nkinds: film\nset: linear\n---\n# Notes\n\nmine");
    await writeFile(
      join(t, "calls.md"),
      "# Calls\n\n- Hook style: demo-first: keep 3 → rule [learn:1, learn:2, learn:3]",
    );
    await writeFile(
      join(t, "standard.md"),
      "# Standard\n\n## film (3 pieces)\n- Length (s): median 42",
    );
    const read = await readSopDir(dir, "x");
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
  it("numbers by first use, keeps known sources only, and round-trips", () => {
    const known = new Set(["youtube-abc", "file-g"]);
    const long =
      "- A [file-g] [youtube-abc 1:02]\n- B [youtube-abc caption] [other-zz 3:04] [youtube-abc 5:00, 6:00]\n";
    const { body, cites } = numberCites(long, [], known);
    expect(body).toBe("- A [1] [2 1:02]\n- B [2 caption] [other-zz 3:04] [2 5:00, 6:00]\n");
    expect(cites).toEqual(["file-g", "youtube-abc"]);
    expect(expandCites(body, cites)).toBe(long);
    // a prior number stays
    expect(numberCites("- C [youtube-abc 0:01] [file-g]\n", cites, known)).toEqual({
      body: "- C [2 0:01] [1]\n",
      cites,
    });
  });

  it("reads the model's own Sources list, and drops a number that names no source", () => {
    const md = '- A [2 0:05] [9]\n\n## Sources\n\n1. file-g, "G"\n2. youtube-abc, "T"\n';
    expect(numberCites(md, [], new Set(["youtube-abc", "file-g"]))).toEqual({
      body: "- A [1 0:05]\n",
      cites: ["youtube-abc"],
    });
  });
});

describe("firstStep", () => {
  it("names the heading and top-level step of the first line naming the prefix", () => {
    const g = "# T\n\n## Look\n\n1. Watch\n\n### 2. Cut\n\n1. Trim\n2. Apply VE-3 here\n";
    expect(firstStep(g, "VE")).toBe('"2. Cut", step 2');
    expect(firstStep(g, "ZZ")).toBe("");
    expect(firstStep("Apply VE-1 first", "VE")).toBe("");
  });
});
