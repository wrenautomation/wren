/**
 * The render script: `node frames/render.ts <job.json>`, run from this package so the engine and
 * esbuild stay out of the wren bundle. One bundle and one server for every output of the job.
 * A video: Chrome draws each frame (`@hyperframes/engine`, parallel workers), ffmpeg encodes a
 * minute at a time and mixes the sounds a scan pass listed. A still: one seek, one screenshot.
 * Progress goes to stderr; stdout gets one JSON line per finished output.
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  calculateOptimalWorkers,
  distributeFrames,
  drainBrowserPool,
  executeParallelCapture,
  mergeWorkerFrames,
  resolveHeadlessShellPath,
} from "@hyperframes/engine";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer-core";
import type { RenderScriptJob } from "../src/render-job.ts";
import { frameServer, run } from "./frame-server.ts";
import type { SoundNote, VideoConfig } from "./runtime.tsx";

/** Frames captured, encoded and deleted as one piece: bounds the disk a long video takes. */
const PIECE = 1800;
const RATE = 48000;
/** Samples per second of a moving volume's envelope. */
const ENVELOPE_RATE = 1000;

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const say = (line: string) => process.stderr.write(`${line}\n`);

async function shell(): Promise<string> {
  const found = resolveHeadlessShellPath({});
  if (found) return found;
  say("render: no chrome-headless-shell, installing it");
  await run("pnpm", ["dlx", "puppeteer@25.11.0", "browsers", "install", "chrome-headless-shell"]);
  const now = resolveHeadlessShellPath({});
  if (!now) throw new Error("chrome-headless-shell did not install");
  return now;
}

/** The page of one job, ready: its size, rate and length. */
async function openJob(browser: Browser, url: string) {
  const page = await browser.newPage();
  await page.goto(`${url}/index.html`);
  await page.waitForFunction("window.__hf || window.__hfStartupError", { timeout: 60_000 });
  const failed = await page.evaluate("window.__hfStartupError");
  if (failed) throw new Error(`the page did not start: ${failed}`);
  const config = (await page.evaluate("window.__frames.config")) as VideoConfig;
  return { page, config };
}

/** Every sound mixed to one 48 kHz stereo wav of `seconds`; null when there is none. */
async function mix(o: {
  notes: SoundNote[];
  fps: number;
  seconds: number;
  work: string;
  media: (name: string) => string;
  ffmpeg: string;
}): Promise<string | null> {
  const heard: SoundNote[] = [];
  const hasAudio = new Map<string, Promise<boolean>>();
  for (const n of o.notes) {
    const file = o.media(n.file);
    let has = hasAudio.get(file);
    if (!has) {
      has = run(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "a:0",
          "-show_entries",
          "stream=index",
          "-of",
          "csv=p=0",
          file,
        ],
        true,
      ).then((t) => t.trim() !== "");
      hasAudio.set(file, has);
    }
    if ((await has) && n.frames > 0) heard.push(n);
  }
  if (!heard.length) return null;
  const args = ["-v", "error", "-y"];
  const graph: string[] = [];
  let input = 0;
  heard.forEach((n, i) => {
    if (n.loop) args.push("-stream_loop", "-1");
    args.push("-ss", String(n.trim / o.fps), "-t", String(n.frames / o.fps), "-i", o.media(n.file));
    const sound = `[${input++}:a]aresample=${RATE},aformat=sample_fmts=fltp:channel_layouts=stereo`;
    const delay = `adelay=${Math.round((n.at / o.fps) * RATE)}S:all=1[s${i}]`;
    if (!n.curve) {
      graph.push(`${sound},volume=${n.volume},${delay}`);
      return;
    }
    // a volume that moves: its per-frame values as a slow signal the sound is multiplied by
    const length = Math.ceil((n.frames / o.fps) * ENVELOPE_RATE) + ENVELOPE_RATE;
    const envelope = new Float32Array(length);
    let held = 0;
    const at = (f: number) => {
      held = n.curve?.[Math.min(f, n.frames - 1)] ?? held;
      return held;
    };
    for (let k = 0; k < length; k++) {
      const f = (k / ENVELOPE_RATE) * o.fps;
      const a = at(Math.floor(f));
      const b = at(Math.floor(f) + 1);
      envelope[k] = a + (b - a) * (f - Math.floor(f));
    }
    const file = join(o.work, `envelope-${i}.f32`);
    writeFileSync(file, Buffer.from(envelope.buffer));
    args.push("-f", "f32le", "-ar", String(ENVELOPE_RATE), "-ac", "1", "-i", file);
    graph.push(`${sound}[d${i}]`);
    graph.push(
      `[${input++}:a]aresample=${RATE},pan=stereo|c0=c0|c1=c0,aformat=sample_fmts=fltp[e${i}]`,
    );
    graph.push(`[d${i}][e${i}]amultiply,${delay}`);
  });
  const all = heard.map((_, i) => `[s${i}]`).join("");
  const fit = `atrim=0:${o.seconds},apad=whole_dur=${o.seconds}[out]`;
  graph.push(
    heard.length === 1
      ? `${all}${fit}`
      : `${all}amix=inputs=${heard.length}:normalize=0:duration=longest,${fit}`,
  );
  const script = join(o.work, "mix.txt");
  writeFileSync(script, graph.join(";\n"));
  const wav = join(o.work, "mix.wav");
  await run(o.ffmpeg, [
    ...args,
    "-/filter_complex",
    script,
    "-map",
    "[out]",
    "-t",
    String(o.seconds),
    wav,
  ]);
  return wav;
}

async function video(o: {
  url: string;
  config: VideoConfig;
  notes: SoundNote[];
  out: string;
  bitrate: string;
  work: string;
  media: (name: string) => string;
  ffmpeg: string;
  name: string;
}): Promise<void> {
  const { fps, width, height, durationInFrames: total } = o.config;
  const sound = mix({ ...o, fps, seconds: total / fps });
  const encoder =
    process.platform === "darwin"
      ? ["-c:v", "h264_videotoolbox", "-b:v", o.bitrate, "-allow_sw", "1"]
      : ["-c:v", "libx264", "-preset", "medium", "-b:v", o.bitrate];
  const pieces: string[] = [];
  let encoding: Promise<unknown> = Promise.resolve();
  for (let start = 0; start < total; start += PIECE) {
    const count = Math.min(PIECE, total - start);
    const dir = join(o.work, `piece-${start}`);
    const tasks = distributeFrames(count, calculateOptimalWorkers(count), dir, start);
    const results = await executeParallelCapture(
      o.url,
      dir,
      tasks,
      { width, height, fps: { num: fps, den: 1 }, format: "jpeg", quality: 92 },
      () => null,
      undefined,
      undefined,
      undefined,
      { useDrawElement: false },
    );
    const bad = results.find((r) => r.error);
    if (bad)
      throw new Error(`capture failed at frames ${bad.startFrame}-${bad.endFrame}: ${bad.error}`);
    const all = join(dir, "all");
    await mergeWorkerFrames(dir, tasks, all);
    const first = readdirSync(all).sort()[0];
    const from = Number(first?.match(/(\d+)\.jpg$/)?.[1]);
    if (!first || !Number.isFinite(from)) throw new Error(`no frames captured from ${start}`);
    const piece = join(o.work, `piece-${start}.mp4`);
    pieces.push(piece);
    // the encode of this piece runs while Chrome draws the next one
    encoding = encoding.then(async () => {
      await run(o.ffmpeg, [
        ...["-v", "error", "-y", "-framerate", String(fps), "-start_number", String(from)],
        ...["-i", join(all, first.replace(/\d+\.jpg$/, "%06d.jpg")), "-frames:v", String(count)],
        ...["-vf", "scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p"],
        ...["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"],
        ...encoder,
        piece,
      ]);
      rmSync(dir, { recursive: true, force: true });
    });
    say(`${o.name}: ${Math.min(total, start + count)}/${total} frames`);
  }
  await encoding;
  const list = join(o.work, "pieces.txt");
  writeFileSync(list, pieces.map((p) => `file '${p}'`).join("\n"));
  const wav = await sound;
  await run(o.ffmpeg, [
    ...["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list],
    ...(wav ? ["-i", wav, "-c:a", "aac", "-b:a", "256k"] : []),
    ...["-c:v", "copy", "-movflags", "+faststart", "-f", "mp4", o.out],
  ]);
  for (const p of pieces) rmSync(p, { force: true });
}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) throw new Error("usage: node frames/render.ts <job.json>");
  const job = JSON.parse(readFileSync(file, "utf8")) as RenderScriptJob;
  const ffmpeg = job.ffmpeg ?? "ffmpeg";
  const work = mkdtempSync(join(tmpdir(), "wren-render-"));
  const bundle = join(work, "bundle");
  mkdirSync(bundle);
  let server: Awaited<ReturnType<typeof frameServer>> | undefined;
  let browser: Browser | undefined;
  const clean = () => rmSync(work, { recursive: true, force: true });
  process.on("SIGINT", () => {
    clean();
    process.exit(130);
  });
  try {
    await build({
      entryPoints: { bundle: join(pkg, "frames/page.tsx") },
      bundle: true,
      outdir: bundle,
      format: "iife",
      jsx: "automatic",
      minify: true,
      define: { "process.env.NODE_ENV": '"production"' },
      // one React: the compositions reach files of other packages
      alias: {
        react: join(pkg, "node_modules/react"),
        "react-dom": join(pkg, "node_modules/react-dom"),
      },
      loader: { ".woff2": "file", ".woff": "file" },
      assetNames: "fonts/[name]",
      publicPath: "/",
      logLevel: "warning",
    });
    server = await frameServer({
      dir: job.dir,
      bundle,
      cache: join(work, "frames"),
      jobs: job.outputs.map((o) => ({ composition: o.composition, props: o.props })),
      ffmpeg,
    });
    if (job.preview) {
      const url = `${server.url}/job/0/?play`;
      say(`preview: ${url} (Ctrl-C to stop)`);
      spawn("open", [url], { stdio: "ignore" }).on("error", () => undefined);
      await new Promise(() => undefined);
    }
    browser = await puppeteer.launch({ executablePath: await shell(), args: ["--no-sandbox"] });
    for (const [i, o] of job.outputs.entries()) {
      const started = Date.now();
      const url = `${server.url}/job/${i}`;
      const name = o.out.split("/").pop() ?? o.out;
      const { page, config } = await openJob(browser, url);
      if (o.kind === "still") {
        await page.setViewport({
          width: config.width,
          height: config.height,
          deviceScaleFactor: 1,
        });
        const at = Math.max(0, Math.min(config.durationInFrames - 1, o.frame)) / config.fps;
        await page.evaluate(
          `(async () => { window.__hf.seek(${at}); await window.__hfWaitForSeekCompletion(); })()`,
        );
        await page.screenshot({
          path: o.out as `${string}.png`,
          type: o.format,
          ...(o.format === "jpeg" ? { quality: o.quality ?? 90 } : {}),
          clip: { x: 0, y: 0, width: config.width, height: config.height },
        });
        await page.close();
      } else {
        const notes = (await page.evaluate("window.__frames.sounds()")) as SoundNote[];
        await page.close();
        await video({ ...o, url, config, notes, work, media: server.media, ffmpeg, name });
      }
      process.stdout.write(
        `${JSON.stringify({ output: i, seconds: (Date.now() - started) / 1000 })}\n`,
      );
    }
  } finally {
    await browser?.close().catch(() => undefined);
    await drainBrowserPool().catch(() => undefined);
    await server?.close();
    clean();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    say(`render: ${e instanceof Error ? (e.stack ?? e.message) : e}`);
    process.exit(1);
  },
);
