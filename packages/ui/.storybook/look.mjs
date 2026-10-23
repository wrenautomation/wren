#!/usr/bin/env node
/**
 * Layout problems on local pages, as text (designs/2026-10-21-dev-loop.md). Each problem is one
 * line (look.ts); a picture is taken only of a page with problems, and only with `--shot`.
 *   wren-look [--port 61001] <story-id>...        stories from a running Storybook
 *   wren-look --all [--static storybook-static]   every page story; --static serves a build itself
 *   wren-look http://localhost:5173/inbox/mail     any local page (the dev server)
 * --width 390,1280 (the widths), --messy (prod-like data; --data both for tidy and messy),
 * --map (the page as text where it sits, autobrowse's layout reader), --shot (a picture per problem page).
 * Local only: it refuses any other host, so a run never reaches prod's Worker (its request cap).
 * Exits 1 on any problem. Nothing outlives it.
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import { layout, pageBoxes } from "@wrenautomation/autobrowse/layout";
import { chromium } from "playwright";
import { lookProblems } from "./look.ts";
import { serve } from "./static.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: "string", default: "61001" },
    all: { type: "boolean", default: false },
    static: { type: "string" },
    width: { type: "string", default: "390,1280" },
    messy: { type: "boolean", default: false },
    data: { type: "string" },
    map: { type: "boolean", default: false },
    shot: { type: "boolean", default: false },
    out: { type: "string", default: `${tmpdir()}/wren-look` },
    only: { type: "string" },
  },
});

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);
const served = values.static ? await serve(values.static) : null;
const base = served?.base ?? `http://localhost:${values.port}`;
const datas =
  values.data === "both" ? ["tidy", "messy"] : [values.messy ? "messy" : (values.data ?? "tidy")];
const widths = values.width.split(",").map(Number);

let targets = positionals;
if (values.all) {
  const index = await (await fetch(`${base}/index.json`)).json();
  targets = Object.values(index.entries)
    .filter((e) => e.type === "story" && e.id.startsWith("pages-"))
    .map((e) => e.id);
}
if (values.only) targets = targets.filter((t) => t.includes(values.only));
if (!targets.length) {
  console.error(
    "usage: wren-look [--all | <story-id>... | http://localhost:…] [--width 390,1280] [--messy] [--map] [--shot]",
  );
  process.exit(2);
}

const jobs = [];
for (const t of targets) {
  const url = /^https?:/.test(t) ? new URL(t) : null;
  if (url && !LOCAL.has(url.hostname)) {
    console.error(
      `${t}: not a local page. wren-look never loads prod (designs/2026-10-14-portal-requests.md).`,
    );
    process.exit(2);
  }
  for (const data of datas)
    for (const width of widths) {
      const href = url
        ? url.href
        : `${base}/iframe.html?id=${t}&viewMode=story&globals=data:${data}`;
      jobs.push({
        name: `${t} ${width}${data === "messy" ? " messy" : ""}`,
        href,
        width,
        story: !url,
      });
    }
}

const browser = await chromium.launch();
const stop = async (code) => {
  await browser.close().catch(() => {});
  served?.server.close();
  process.exit(code);
};
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => void stop(130));
mkdirSync(values.out, { recursive: true });

/** The page is drawn: a story's `play` has ended, or a plain page has gone quiet. */
async function drawn(page, story) {
  if (story)
    await page.waitForFunction(
      () => {
        const phase = globalThis.__STORYBOOK_PREVIEW__?.currentRender?.phase;
        const root = document.getElementById("storybook-root");
        if (phase === "errored" || document.body.classList.contains("sb-show-errordisplay"))
          return true;
        return (
          (phase === undefined || ["completed", "finished"].includes(phase)) &&
          root?.childElementCount
        );
      },
      null,
      { timeout: 20_000 },
    );
  await page.waitForLoadState("networkidle").catch(() => {});
  // Nothing moves: a row mid-slide is not its place.
  await page.addStyleTag({
    content: "*,*::before,*::after{animation:none!important;transition:none!important}",
  });
  await page.waitForTimeout(150);
}

let bad = 0;
const lines = [];
async function run(job) {
  const ctx = await browser.newContext({
    viewport: { width: job.width, height: 900 },
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  try {
    await page.goto(job.href);
    await drawn(page, job.story);
    const problems = await page.evaluate(
      `(${lookProblems.toString()})(document.getElementById("storybook-root") ?? document.body)`,
    );
    const said = [];
    if (problems.length) {
      bad++;
      said.push(`✗ ${job.name}`, ...problems.map((p) => `    ${p}`));
      if (values.shot) {
        const path = `${values.out}/${job.name.replace(/[^\w.-]+/g, "_")}.png`;
        await page.screenshot({ path });
        said.push(`    picture: ${path}`);
      }
    } else if (!values.all) said.push(`✓ ${job.name}`);
    if (values.map)
      said.push(`--- ${job.name} as text ---`, layout(await pageBoxes(page), { coords: true }));
    if (said.length) lines.push(said.join("\n"));
  } catch (e) {
    bad++;
    lines.push(`✗ ${job.name}\n    did not draw: ${String(e.message).split("\n")[0]}`);
  } finally {
    await ctx.close();
  }
}

// Four pages at a time: one Chromium, bounded memory.
const queue = [...jobs];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      await run(job);
      if (lines.length) console.log(lines.splice(0).join("\n"));
    }
  }),
);
console.log(`${jobs.length} pages, ${bad} with problems`);
await stop(bad ? 1 : 0);
