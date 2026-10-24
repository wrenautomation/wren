/**
 * `wren video add|list|show|set|words|stress|approve|cuts|keep|knobs|cut|studio|render|look|find|promo`: the video
 * editor (designs/2026-10-06-video-editor.md). Claude Code edits through `show` and `set`; every
 * write leaves a runs row. Runs on William's Mac: whisper.cpp, ffmpeg (VideoToolbox), Remotion.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import * as clients from "@restatedev/restate-sdk-clients";
import { ingressOf, type Settings } from "@wren/config";
import {
  AWS_LOGIN_HINT,
  approveVideo,
  checkMediaStore,
  reelKey,
  swapShortMedia,
  uploadMedia,
  VIDEO_PRIVACY,
  videoChanges,
} from "@wren/content";
import { recordedRun } from "@wren/core";
import type { Db } from "@wren/db";
import { fleetKeys, loadLlmEnv, makeLlm } from "@wren/llm";
import {
  addVideo,
  CAPTION_STYLES,
  CROPPED,
  type CroppedFormat,
  CUT_HASH,
  checkRender,
  cohereLooker,
  coverHash,
  cutHash,
  cutKnobs,
  cutTracks,
  cutTranscript,
  editMattes,
  type Format,
  FPS,
  filmAssets,
  filmHistory,
  filmstrip,
  findCapProjects,
  findRecordings,
  frameAt,
  framedProps,
  fromCutTime,
  geminiLooker,
  getEdit,
  hashFiles,
  hashKey,
  isCap,
  isOpen,
  keepCut,
  keepSegments,
  LOOK_PROVIDERS,
  type Looker,
  longFilm,
  longProps,
  longSrt,
  type Matte,
  type OnSkip,
  obsRecordingDir,
  onCut,
  openStudio,
  outputHashes,
  preview,
  promoProps,
  promoScript,
  proposeStress,
  proxy360,
  punctuate,
  RENDER_PARTS,
  type RenderJob,
  redoSilence,
  renderAll,
  renderPromo,
  renderStill,
  renderStills,
  reviewCuts,
  setCutKnobs,
  setEdit,
  setFiles,
  setKeys,
  setLocks,
  setLook,
  setRender,
  setRendered,
  setStress,
  setStudioWords,
  setWords,
  shortFilm,
  shortProps,
  sourceProxy,
  stressCandidates,
  studioWords,
  thumbnailProps,
  toRaw,
  twelvelabsFind,
  twelvelabsLooker,
  twelvelabsMinutes,
  unpunctuated,
  VIDEO_CHECK,
  type VideoEdit,
  videoEdits,
  withFallback,
  wordAt,
} from "@wren/studio";
import { capturePage } from "@wren/video";
import type { Command } from "commander";
import { desc, sql } from "drizzle-orm";
import { readText } from "./content.js";
import { autobrowseDrive } from "./sop.js";
import { registerVideoAsk } from "./video-ask.js";
import { type WatchFlags, watchVideo, withWatchOptions } from "./video-watch.js";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const OBS_NOTE = `
Input: an OBS recording. One file (OBS scene, cam already placed; give --cam once per scene so
Shorts can crop it), or a folder with the recording and the camera file. For the camera file:
OBS > Tools > Source Record on the camera source, same folder as the main recording. The two are
lined up by their audio. Or a Cap project (<name>.cap): its screen, mic and camera files, lined
up by Cap's start times. Needs: brew install whisper-cpp, the model in ~/.cache/wren/whisper, and
WhisperX in ~/.cache/wren/whisperx (a warning says how), which re-times each word; --no-align skips it.`;

/** What `render --only` takes: a format, or the Shorts or thumbnails alone. */
const PARTS = RENDER_PARTS;
const isFormat = (p: string) => p === "long" || (CROPPED as readonly string[]).includes(p);

const id = (v: string) => {
  const n = Number.parseInt(v, 10);
  if (!(n > 0)) throw new Error(`"${v}" is not a video id`);
  return n;
};
const t = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;

/** The edit as JSON, one word a line so a long transcript stays readable. */
function editJson(e: VideoEdit): string {
  const { words, ...rest } = e;
  const head = JSON.stringify(rest, null, 2).replace(/\n}$/, "");
  return `${head},\n  "words": [\n${words.map((w) => `    ${JSON.stringify(w)}`).join(",\n")}\n  ]\n}`;
}

type RenderOpts = {
  check?: boolean;
  short?: number;
  only?: string;
  cut?: boolean;
  again?: boolean;
  upload?: boolean;
  still?: number;
};

/** Each output's file in out/: a video, or a thumbnail's jpg. */
const outFile = (out: string, name: string) =>
  join(out, name.startsWith("thumb-") ? `${name}.jpg` : `${name}.mp4`);

/** Which of `names` out/ already holds, by output name (`--upload`, and to tell a render is lost). */
const onDisk = (out: string, names: readonly string[]): Record<string, string> =>
  Object.fromEntries(
    names.map((n) => [n, outFile(out, n)] as const).filter(([, f]) => existsSync(f)),
  );

/**
 * What each file in out/ was rendered from (the output's hash), kept beside the files: a render
 * whose upload failed leaves them here, and `--upload` stores them with the files it uploads.
 */
const HASHES = "hashes.json";
async function readHashes(out: string): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(join(out, HASHES), "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

export function registerStudio(
  video: Command,
  withDb: WithDb,
  settings: Settings,
  rootDir: string,
): void {
  // The code, not the data: bin/wren sets WREN_ROOT to the checkout it runs from.
  const studioDir = join(process.env.WREN_ROOT ?? rootDir, "packages/studio");

  video
    .command("add <input>")
    .description(
      "ingest an OBS recording (file or folder) or a Cap project: sync, transcribe, silence cuts",
    )
    .option("--script <url>", "the Google Doc read along (needs --account)")
    .option("--account <address>", "the Google account that can read --script")
    .option("--cam <x,y,w,h>", "one-file recordings: the cam box in pixels")
    .option("--offset <s>", "camera minus main seconds, when the camera file has no audio", Number)
    .option("--model <file>", "a whisper.cpp model other than large-v3-turbo")
    .option("--no-align", "keep whisper's word times (skip the WhisperX pass)")
    .addHelpText("after", OBS_NOTE)
    .action(
      async (
        input: string,
        o: {
          script?: string;
          account?: string;
          cam?: string;
          offset?: number;
          model?: string;
          align: boolean;
        },
      ) => {
        const camBox = o.cam?.split(",").map(Number);
        if (camBox && (camBox.length !== 4 || camBox.some((n) => !(n >= 0))))
          throw new Error("--cam is x,y,w,h in pixels");
        let script: { url: string; text: string } | undefined;
        if (o.script) {
          if (!o.account) throw new Error("--script needs --account <address>");
          const doc = o.script.match(/\/d\/([\w-]+)/)?.[1] ?? o.script;
          const drive = autobrowseDrive(resolve(rootDir, settings.autobrowseDir), o.account);
          const out = (await drive(`/drive/v3/files/${doc}/export`, {
            mimeType: "text/plain",
          })) as { text?: string };
          script = { url: o.script, text: (out.text ?? "").trim() };
        }
        const e = await withDb((db) =>
          addVideo(db, resolve(input), {
            ffmpeg: settings.ffmpeg,
            ...(script ? { script } : {}),
            ...(camBox ? { camBox: camBox as [number, number, number, number] } : {}),
            ...(o.offset !== undefined ? { offsetS: o.offset } : {}),
            ...(o.model ? { model: resolve(o.model) } : {}),
            ...(o.align ? {} : { align: false }),
            log: (l) => console.log(l),
          }),
        );
        const cut = e.cuts.filter((c) => c.state === "cut");
        console.log(
          `video ${e.id}: ${e.words.length} words, ${cut.length} silence cuts (${cut.reduce((n, c) => n + c.to - c.from, 0).toFixed(1)}s), ${e.cuts.length - cut.length} proposals${e.tracks.cam ? `, camera offset ${e.tracks.cam.offsetS}s` : ""}`,
        );
        // The page's finishing view plays and scrubs these; a failed upload only waits for render.
        if (settings.mediaBucket)
          await withDb((db) => finishMedia(db, e, settings.mediaBucket as string)).catch((err) =>
            console.log(
              `finishing view media not uploaded (${err instanceof Error ? err.message : err}): wren video source ${e.id}`,
            ),
          );
        console.log(
          `files go to ${e.dir}\nnext: wren video cuts ${e.id}, then wren video cut ${e.id}`,
        );
      },
    );

  video
    .command("list")
    .description("videos being edited, newest first")
    .action(() =>
      withDb(async (db) => {
        const rows = await db.select().from(videoEdits).orderBy(desc(videoEdits.id)).limit(50);
        if (!rows.length) console.log("no videos; wren video add <file|dir>");
        for (const e of rows) {
          const keep = keepSegments(e.cuts, e.tracks.main.durationS);
          const cutS = keep.reduce((n, k) => n + k.e - k.s, 0);
          console.log(
            `${e.id}\t${e.state}\t${t(e.tracks.main.durationS)} -> ${t(cutS)}\t${e.title}`,
          );
        }
      }),
    );

  video
    .command("show <id>")
    .description("the edit as JSON (what wren video set takes, plus words and tracks)")
    .action((v: string) => withDb(async (db) => console.log(editJson(await getEdit(db, id(v))))));

  type SetOpts = {
    file?: string;
    lock?: boolean;
    captionsStyle?: string;
    behind?: string;
    captionsLong?: string;
    captionsShort?: string;
  };
  video
    .command("set <id>")
    .description(
      "write fields of the edit from JSON (file or stdin): title, description, tags, chapters, cuts, layout, captions, shorts, formats, thumbnail, overlays, crops",
    )
    .option("--file <f>", "read the JSON from this file; else stdin")
    .option("--lock", "lock what this changes: the agent keeps it (wren video unlock)")
    .option("--captions-style <s>", `no JSON: the caption style, ${CAPTION_STYLES.join(", ")}`)
    .option("--behind <on|off>", "no JSON: stressed words behind the speaker (wren video stress)")
    .option(
      "--captions-long <screen|track>",
      "no JSON: the long video's captions burned in, or only the English CC track (default)",
    )
    .option(
      "--captions-short <screen|track>",
      "no JSON: the vertical's and Shorts' captions burned in (default), or none",
    )
    .action(async (v: string, o: SetOpts) => {
      if (o.behind !== undefined && o.behind !== "on" && o.behind !== "off")
        throw new Error("--behind is on or off");
      const flags = [o.captionsStyle, o.behind, o.captionsLong, o.captionsShort].some(
        (x) => x !== undefined,
      );
      const r = await withDb(async (db) => {
        if (!flags) {
          const text = (await readText(o.file)).trim();
          if (!text) throw new Error("no JSON: pass --file or pipe it in");
          return setEdit(db, id(v), JSON.parse(text), { by: "cli", lock: o.lock === true });
        }
        const { captions } = await getEdit(db, id(v));
        const next = {
          ...captions,
          ...(o.captionsStyle !== undefined ? { style: o.captionsStyle } : {}),
          ...(o.behind !== undefined ? { behind: o.behind === "on" } : {}),
          ...(o.captionsLong !== undefined ? { long: o.captionsLong } : {}),
          ...(o.captionsShort !== undefined ? { short: o.captionsShort } : {}),
        };
        return setEdit(db, id(v), { captions: next }, { by: "cli", lock: o.lock === true });
      });
      for (const m of r.snapped)
        console.log(`short ${m.n}: snapped to whole sentences (start ${m.from}s, end ${m.to}s)`);
      console.log(`video ${r.edit.id}: set (run ${r.run})`);
    });

  const CHECKED = /^(long|vertical|square|portrait|short-\d+)$/;
  /** Check each rendered output against the bar, a `video check` run each; how many failed. */
  async function checkOutputs(db: Db, e: VideoEdit, outputs: readonly string[], by: string) {
    loadLlmEnv(settings.llmEnvPath, rootDir);
    let failed = 0;
    for (const output of outputs) {
      const short = /^short-(\d+)$/.exec(output);
      const props = short ? shortProps(e, Number(short[1])) : longProps(e);
      const { stats } = await recordedRun(
        db,
        { command: VIDEO_CHECK, argv: { id: e.id, output, by } },
        async () => ({
          output,
          hash: e.files[hashKey(output)] ?? null,
          ...(await checkRender(e.files[output] as string, {
            format: short ? "short" : "long",
            durationS: props.durationInFrames / FPS,
            words: props.words,
            geminiKeys: fleetKeys(process.env, "gemini"),
            ffmpeg: settings.ffmpeg,
          })),
        }),
      );
      if (!stats.pass) failed++;
      console.log(`${output}: ${stats.pass ? "pass" : `${stats.issues.length} to fix`}`);
      for (const i of stats.issues) console.log(`  ${t(i.at)}  ${i.rule}  ${i.says}`);
    }
    return failed;
  }

  // The self-check before Approve (designs/2026-10-24-video-film-file.md, Decision 2).
  video
    .command("check <id>")
    .description(
      "check each rendered video against the edit bar (one Gemini look); a run per output",
    )
    .option("--only <output>", "one output: long, vertical, square, portrait, short-N")
    .option("--by <who>", "who asked", "cli")
    .action((v: string, o: { only?: string; by: string }) =>
      withDb(async (db) => {
        const e = await getEdit(db, id(v));
        const outputs = Object.keys(e.files).filter(
          (k) => CHECKED.test(k) && (!o.only || k === o.only),
        );
        if (!outputs.length)
          throw new Error(
            `video ${e.id}: nothing rendered${o.only ? ` as ${o.only}` : ""}; run wren video render ${e.id}`,
          );
        if ((await checkOutputs(db, e, outputs, o.by)) > 0) process.exitCode = 1;
      }),
    );

  // The edit as an OpenFilm film.html (designs/2026-10-24-video-film-file.md, Decision 1).
  video
    .command("film <id>")
    .description(
      "write the edit as an OpenFilm folder: film.html, its pages, the words as WebVTT, links to the recordings",
    )
    .option("--short <n>", "Short n (from 1), at 1080x1920; else the long video")
    .option("--out <dir>", "the folder (default: film/ or film-short-N/ beside the recording)")
    .action((v: string, o: { short?: string; out?: string }) =>
      withDb(async (db) => {
        const e = await getEdit(db, id(v));
        const n = o.short === undefined ? null : Number(o.short);
        const out = resolve(o.out ?? join(e.dir, n === null ? "film" : `film-short-${n}`));
        const files = n === null ? longFilm(e) : shortFilm(e, n);
        for (const [path, text] of Object.entries(files)) {
          await mkdir(dirname(join(out, path)), { recursive: true });
          await writeFile(join(out, path), text);
        }
        const assets = filmAssets(e);
        for (const [path, from] of [
          [assets.main, e.tracks.main.path],
          [assets.cam, e.tracks.cam?.path],
        ] as const) {
          if (!path || !from) continue;
          await rm(join(out, path), { force: true });
          await symlink(resolve(from), join(out, path));
        }
        console.log(`${out}/film.html (open it: npx -y openfilm@latest open ${out})`);
      }),
    );

  video
    .command("history <id>")
    .description("each change to the edit, newest first, as a diff of its film.html files")
    .option("--last <n>", "only the newest n changes", "10")
    .action((v: string, o: { last: string }) =>
      withDb(async (db) => {
        const e = await getEdit(db, id(v));
        const runs = (await videoChanges(db, e.id)).slice(0, Number(o.last));
        if (!runs.length) return console.log("no changes yet");
        for (const c of filmHistory(e, runs)) {
          console.log(
            `run ${c.run}  ${c.at}  ${c.command}  by ${c.by ?? "?"}  (${c.fields.join(", ")})`,
          );
          console.log(c.diff || "  (no change to any film)\n");
        }
      }),
    );

  for (const [name, what] of [
    ["lock", "lock parts of the edit so the agent keeps them"],
    ["unlock", "let the agent change these parts again"],
  ] as const)
    video
      .command(`${name} <id> [paths...]`)
      .description(
        `${what}: field paths, list items from 1 (cuts, shorts.2, crops.vertical); none lists them`,
      )
      .action((v: string, paths: string[]) =>
        withDb(async (db) => {
          const locked = paths.length
            ? await setLocks(db, id(v), name === "lock" ? { lock: paths } : { unlock: paths })
            : (await getEdit(db, id(v))).locked;
          console.log(locked.length ? `locked: ${locked.join(", ")}` : "nothing locked");
        }),
      );

  // The storyboard and a change in a sentence: the page's Storyboard, from here.
  registerVideoAsk(video, withDb, (o) => {
    loadLlmEnv(settings.llmEnvPath, rootDir);
    return withFallback(
      makeLlm(o.llm, process.env),
      o.fallback === "none" ? null : makeLlm(o.fallback, process.env),
    );
  });

  video
    .command("stress <id>")
    .description(
      "the words that carry the point (1-3 a minute), drawn big in the stress style and behind the speaker: a model proposes them; --add/--drop change one",
    )
    .option("--add <s>", "stress the word said at this second of the recording", Number)
    .option("--drop <s>", "unstress the word said at this second of the recording", Number)
    .option("--llm <spec>", "model for the proposal", "gateway")
    .option(
      "--fallback <spec>",
      'model when the gateway\'s free keys are spent or cooling (paid credits); "none" to fail instead',
      "gateway:cohere",
    )
    .action((v: string, o: { add?: number; drop?: number; llm: string; fallback: string }) =>
      withDb(async (db) => {
        const e = await getEdit(db, id(v));
        const show = (list: number[]) =>
          list.map((i) => `${e.words[i]?.w} @${t(e.words[i]?.s ?? 0)}`).join(", ") || "none";
        if (o.add !== undefined || o.drop !== undefined) {
          let next = [...e.stress];
          if (o.drop !== undefined) {
            const i = wordAt(e.words, o.drop);
            if (!next.includes(i)) throw new Error(`"${e.words[i]?.w}" isn't stressed`);
            next = next.filter((x) => x !== i);
          }
          if (o.add !== undefined) next = [...new Set([...next, wordAt(e.words, o.add)])];
          const r = await setStress(db, e.id, next, { by: "cli" });
          console.log(`video ${e.id}: stressed ${show(r.edit.stress)} (run ${r.run})`);
          return;
        }
        loadLlmEnv(settings.llmEnvPath, rootDir);
        // Free keys first; the paid fallback only answers once they're spent or cooling.
        const llm = withFallback(
          makeLlm(o.llm, process.env),
          o.fallback === "none" ? null : makeLlm(o.fallback, process.env),
        );
        const cut = stressCandidates(e, FPS);
        // One runs row: the list it replaced (for Undo), the model and what it offered.
        const p = await proposeStress(llm, cut);
        const r = await setStress(db, e.id, p.stress, {
          by: "cli",
          stats: { asked: p.asked, offered: p.offered, model: llm.answered.join(", ") },
        });
        console.log(
          `video ${e.id}: ${p.stress.length} stressed of ${p.offered} offered: ${show(p.stress)} (${llm.answered.join(", ")}, run ${r.run})`,
        );
      }),
    );

  video
    .command("words <id>")
    .description("fix a misheard word in the transcript before render: its text, never its times")
    .option("--fix <wrong=right>", 'every match, case kept: --fix "drug fooding=dogfooding"')
    .option("--at <s>", "the one word said at this second of the recording (with <text>)", Number)
    .option(
      "--punctuate",
      "a transcript with no punctuation: a model adds stops, commas and capitals (text only), so Shorts snap to sentences",
    )
    .option("--dry", "with --punctuate: print the punctuated text, write nothing")
    .option("--llm <spec>", "model for --punctuate", "gateway")
    .option(
      "--fallback <spec>",
      'model for --punctuate when the gateway\'s free keys are spent or cooling; "none" to fail instead',
      "gateway:cohere",
    )
    .argument("[text]", "the word's new text, with --at")
    .action(
      (
        v: string,
        text: string | undefined,
        o: {
          fix?: string;
          at?: number;
          punctuate?: boolean;
          dry?: boolean;
          llm: string;
          fallback: string;
        },
      ) =>
        withDb(async (db) => {
          if (o.punctuate) {
            const e = await getEdit(db, id(v));
            if (!unpunctuated(e.words))
              throw new Error(`video ${e.id}: the transcript has punctuation already`);
            loadLlmEnv(settings.llmEnvPath, rootDir);
            const llm = withFallback(
              makeLlm(o.llm, process.env),
              o.fallback === "none" ? null : makeLlm(o.fallback, process.env),
            );
            const p = await punctuate(llm, e.words);
            const said = `${p.changed} of ${e.words.length} words punctuated in ${p.asked} asks (${llm.answered.join(", ")})`;
            if (o.dry) {
              console.log(p.words.map((w) => w.w).join(" "));
              console.log(`video ${e.id}: ${said}; nothing written (--dry)`);
              return;
            }
            const r = await setWords(
              db,
              e.id,
              { words: p.words },
              { by: "cli", command: "video words" },
            );
            console.log(`video ${e.id}: ${said} (run ${r.run}); Shorts snap on the next set`);
            return;
          }
          let change: { wrong: string; right: string } | { at: number; text: string };
          if (o.fix) {
            const [wrong = "", ...rest] = o.fix.split("=");
            change = { wrong, right: rest.join("=") };
          } else if (o.at !== undefined && text) change = { at: o.at, text };
          else throw new Error('pass --fix "wrong=right", or --at <s> <text>');
          const r = await setWords(db, id(v), change, { by: "cli" });
          console.log(`video ${v}: ${r.n} ${r.n === 1 ? "word" : "places"} fixed (run ${r.run})`);
        }),
    );

  video
    .command("approve <id>")
    .description(
      "his yes: a YouTube draft of the rendered file, uploaded by the desk on the next pass",
    )
    .option("--short <n>", "a Short instead of the long video, 1 for the first", (n) => id(n))
    .option("--vertical", "the vertical cut (YouTube, plus an Instagram Reel draft)")
    .option("--privacy <p>", `who sees it: ${VIDEO_PRIVACY.join(", ")}`, "private")
    .option("--at <iso>", "upload at this time, not on the next pass")
    .option(
      "--replace",
      "the long video was uploaded already: upload this render as a new video (the old one stays until you hide it)",
    )
    .action(
      (
        v: string,
        o: { short?: number; vertical?: boolean; privacy: string; replace?: boolean; at?: string },
      ) =>
        withDb(async (db) => {
          const privacy = VIDEO_PRIVACY.find((p) => p === o.privacy);
          if (!privacy)
            throw new Error(`--privacy ${o.privacy}: one of ${VIDEO_PRIVACY.join(", ")}`);
          if (o.short && o.vertical) throw new Error("--short or --vertical, not both");
          const at = o.at ? new Date(o.at) : undefined;
          if (at && Number.isNaN(at.getTime())) throw new Error(`not a time: ${o.at}`);
          if (o.replace && (o.short || o.vertical))
            throw new Error("--replace is for the long video");
          const d = await approveVideo(db, id(v), {
            source: "cli",
            privacy,
            ...(o.replace ? { replace: true } : {}),
            ...(at ? { at } : {}),
            ...(o.short ? { short: o.short } : {}),
            ...(o.vertical ? { vertical: true } : {}),
          });
          console.log(
            d.again
              ? `video ${v}: already approved as draft ${d.id}`
              : `video ${v}: draft ${d.id} approved; it uploads, ${privacy}, on the next pass`,
          );
          if (d.reel && "missing" in d.reel) console.log(d.reel.missing);
          else if (d.reel && !d.reel.again)
            console.log(
              `Reel draft ${d.reel.id} waits in To approve (wren content approve ${d.reel.id})`,
            );
          for (const a of d.also ?? [])
            console.log(`${a.platform} draft ${a.id} waits in To approve`);
        }),
    );

  video
    .command("swap <id>")
    .description(
      "after a render: each approved Short draft not out yet points at the new file; slot, words and approval stay",
    )
    .option("--short <n>", "only Short n", id)
    .action((v: string, o: { short?: number }) =>
      withDb(async (db) => {
        const r = await swapShortMedia(db, id(v), {
          by: "cli",
          ...(o.short ? { short: o.short } : {}),
        });
        for (const d of r.swapped)
          console.log(`short ${d.short} ${d.platform} draft ${d.id}: ${d.to}`);
        for (const m of r.missing) console.log(m);
        console.log(
          `video ${v}: ${r.swapped.length} drafts point at the new render (run ${r.run})`,
        );
      }),
    );

  video
    .command("cuts <id>")
    .description("every cut with the words either side; long or word-touching cuts are flagged")
    .option("--redo", "rerun the silence pass with today's knobs (other cuts stay)")
    .action((v: string, o: { redo?: boolean }) =>
      withDb(async (db) => {
        if (o.redo) await redoSilence(db, id(v), settings.ffmpeg, "cli");
        const e = await getEdit(db, id(v));
        for (const r of reviewCuts(e.cuts, e.words)) {
          const flag = r.flags.length ? `  !! ${r.flags.join(", ")}` : "";
          console.log(
            `${String(r.n).padStart(3)}  ${r.cut.state.padEnd(8)} ${r.cut.why.padEnd(7)} ${t(r.cut.from)}-${t(r.cut.to)} ${r.lengthS.toFixed(2)}s  …${r.before} | ${r.after}…${flag}`,
          );
        }
        const keep = keepSegments(e.cuts, e.tracks.main.durationS);
        console.log(
          `${e.cuts.length} cuts; ${t(e.tracks.main.durationS)} -> ${t(keep.reduce((n, k) => n + k.e - k.s, 0))}. Undo one: wren video keep ${e.id} <n>`,
        );
      }),
    );

  video
    .command("keep <id> <n>")
    .description("undo cut n (from wren video cuts)")
    .action((v: string, n: string) =>
      withDb(async (db) => {
        await keepCut(db, id(v), id(n), "cli");
        console.log(`video ${v}: cut ${n} kept; wren video cut ${v} to apply`);
      }),
    );

  video
    .command("knobs [format]")
    .description(
      "the silence pass knobs (wren_settings studio.cuts): long (default) or short, which cuts shorter pauses in Shorts only; flags set them",
    )
    .option("--min-gap <s>", "shortest silence cut", Number)
    .option("--air <s>", "kept on each side of a word", Number)
    .option("--noise-margin <db>", "silence threshold over the measured noise floor", Number)
    .option("--snap <s>", "how far inward an edge may move to the quietest 20 ms", Number)
    .option(
      "--words <list>",
      "names Whisper should spell right on ingest, comma between (studio.words)",
    )
    .action(
      (
        format: string | undefined,
        o: { minGap?: number; air?: number; noiseMargin?: number; snap?: number; words?: string },
      ) =>
        withDb(async (db) => {
          const f = format ?? "long";
          if (f !== "long" && f !== "short") throw new Error(`format: long or short, not ${f}`);
          const patch = {
            ...(o.minGap !== undefined ? { minGapS: o.minGap } : {}),
            ...(o.air !== undefined ? { airS: o.air } : {}),
            ...(o.noiseMargin !== undefined ? { noiseMarginDb: o.noiseMargin } : {}),
            ...(o.snap !== undefined ? { snapS: o.snap } : {}),
          };
          const k = Object.keys(patch).length
            ? await setCutKnobs(db, patch, "cli", f)
            : await cutKnobs(db, f);
          const words =
            o.words !== undefined
              ? await setStudioWords(db, o.words.split(","), "cli")
              : await studioWords(db);
          console.log(JSON.stringify({ format: f, cuts: k, words }));
        }),
    );

  /**
   * The cut pass: both tracks cut to the edit's cuts, the files on the row. With `reuse`, skipped
   * when the cuts and recordings are what the cut files on disk were made from.
   */
  async function cutPass(db: Db, e: VideoEdit, reuse = false) {
    const same = cutHash(e);
    const have = [e.files.cutMain, e.tracks.cam ? e.files.cutCam : undefined];
    if (
      reuse &&
      e.files[CUT_HASH] === same &&
      have[0] &&
      existsSync(have[0]) &&
      (!e.tracks.cam || (have[1] && existsSync(have[1])))
    ) {
      console.log("cuts unchanged; keeping the cut files");
      return;
    }
    const keep = keepSegments(e.cuts, e.tracks.main.durationS, FPS);
    const started = Date.now();
    const { stats } = await recordedRun(
      db,
      { command: "video cut", argv: { id: e.id, segments: keep.length } },
      async () => {
        const files = await cutTracks(e.tracks, keep, e.dir, settings.ffmpeg);
        await setFiles(db, e.id, { ...files, [CUT_HASH]: same });
        return { files, seconds: Math.round((Date.now() - started) / 1000) };
      },
    );
    for (const f of Object.values(stats.files)) console.log(f);
    console.log(`${keep.length} segments in ${stats.seconds}s`);
  }

  video
    .command("cut <id>")
    .description("apply the cuts to both tracks: 1080p, 30 fps, VideoToolbox, 10 ms fades")
    .action((v: string) =>
      withDb(async (db) => {
        await cutPass(db, await getEdit(db, id(v)));
        console.log(`next: wren video studio ${v}`);
      }),
    );

  video
    .command("studio <id>")
    .description("Remotion Studio on this edit (Long: 16:9, corner cam, captions)")
    .option("--still <s>", "render one frame at this cut-time second to a png instead", Number)
    .action(async (v: string, o: { still?: number }) => {
      const e = await withDb((db) => getEdit(db, id(v)));
      const props = longProps(e);
      if (o.still !== undefined) console.log(await renderStill(studioDir, e.dir, props, o.still));
      else await openStudio(studioDir, e.dir, props);
    });

  video
    .command("render <id>")
    .description(
      "Remotion render to <dir>/out of what changed since each output's last render: the edit's formats (long 16:9, vertical 9:16, square 1:1, portrait 4:5), Shorts 9:16, 3 thumbnails; previews and stills to S3",
    )
    .option("--short <n>", "only Short n", id)
    .option(
      "--only <part>",
      `${PARTS.join(", ")} (a format renders even if the edit doesn't list it)`,
    )
    .option(
      "--cut",
      "run the cut pass first (the page's Render does), unless the cuts are unchanged",
    )
    .option("--again", "render every output again, changed or not (default: only what changed)")
    .option("--upload", "no render: upload what out/ already holds and mark it rendered")
    .option("--no-check", "skip the self-check of each new render (wren video check)")
    .option(
      "--still <s>",
      "no render: one frame per format at this second of the recording, to out/still-<format>-<s>.png",
      Number,
    )
    .action((v: string, o: RenderOpts) =>
      withDb(async (db) => {
        if (o.still !== undefined) return stillsOne(db, v, o.still);
        // Its state on the row for the page: rendering, then done (setRendered) or failed and why.
        const at = () => new Date().toISOString();
        await setRender(db, id(v), { state: "rendering", at: at() });
        const was = (await getEdit(db, id(v))).files;
        try {
          await renderOne(db, v, o);
        } catch (err) {
          const why = (err instanceof Error ? err.message : String(err)).slice(-500);
          await setRender(db, id(v), { state: "failed", at: at(), why });
          throw err;
        }
        if (o.check === false || o.upload) return;
        // Each output this render made new, checked before he Approves; a check error never fails it.
        const e = await getEdit(db, id(v));
        const fresh = Object.keys(e.files).filter(
          (k) => CHECKED.test(k) && (o.again || e.files[hashKey(k)] !== was[hashKey(k)]),
        );
        if (fresh.length)
          await checkOutputs(db, e, fresh, "render").catch((err: Error) =>
            console.log(`self-check skipped: ${err.message}`),
          );
      }),
    );

  /** The words behind the speaker need their mattes made first (kept ones reused). */
  async function mattesFor(e: VideoEdit, at?: number): Promise<Matte[]> {
    const { mattes, skipped } = await editMattes(studioDir, e, {
      ffmpeg: settings.ffmpeg,
      log: (l) => console.log(l),
      ...(at !== undefined ? { at } : {}),
    });
    for (const s of skipped) console.log(`behind: "${e.words[s.i]?.w}" skipped, ${s.why}`);
    return mattes;
  }

  /** A stressed word with nowhere it reads (70% clear of him) isn't drawn behind in that format. */
  const unread: OnSkip = (w, format) =>
    console.log(
      `behind: "${w.w}" at ${w.s.toFixed(1)}s skipped in ${format}, he covers it everywhere`,
    );

  async function stillsOne(db: Db, v: string, rawS: number) {
    const e = await getEdit(db, id(v));
    if (!e.files.cutMain) throw new Error(`video ${e.id}: not cut yet; wren video cut ${e.id}`);
    const keep = keepSegments(e.cuts, e.tracks.main.durationS, FPS);
    const at = onCut(rawS, keep);
    const mattes = await mattesFor(e, at);
    const files = await renderStills(
      studioDir,
      e.dir,
      {
        ...(e.formats.includes("long") ? { long: longProps(e, mattes, { skip: unread }) } : {}),
        framed: framedJob(e, mattes, (f) => e.formats.includes(f)),
        shorts: new Map(
          e.shorts.map((_, i) => [i + 1, shortProps(e, i + 1, mattes, { skip: unread })]),
        ),
      },
      at,
      String(rawS),
    );
    for (const f of Object.values(files)) console.log(f);
  }

  /** The whole cut in each cropped format `want` names. */
  const framedJob = (e: VideoEdit, mattes: Matte[], want: (f: CroppedFormat) => boolean) =>
    Object.fromEntries(
      CROPPED.filter(want).map((f) => [f, framedProps(e, f, mattes, { skip: unread })]),
    ) as NonNullable<RenderJob["framed"]>;

  /**
   * The finishing view's media (designs/2026-10-15-video-finishing.md), each made and uploaded
   * once: the raw recording's playback copy, the camera file's on main's clock, the filmstrip.
   */
  async function finishMedia(db: Db, e: VideoEdit, bucket: string, force = false) {
    const dir = join(e.dir, "finish");
    await mkdir(dir, { recursive: true });
    const keys: Record<string, string> = {};
    const { main, cam } = e.tracks;
    if (force || !e.keys.source)
      keys.source = await uploadMedia(
        await sourceProxy(main.path, join(dir, "source.mp4"), settings.ffmpeg),
        { bucket },
      );
    if (cam && (force || !e.keys["source-cam"]))
      keys["source-cam"] = await uploadMedia(
        await sourceProxy(cam.path, join(dir, "source-cam.mp4"), settings.ffmpeg, {
          shiftS: cam.offsetS,
          audio: false,
        }),
        { bucket },
      );
    if (force || !e.keys.strip)
      keys.strip = await uploadMedia(
        await filmstrip(main.path, join(dir, "strip.jpg"), main.durationS, settings.ffmpeg),
        { bucket },
      );
    await setKeys(db, e.id, keys);
    return Object.keys(keys);
  }

  video
    .command("source <id>")
    .description(
      "make and upload the finishing view's playback copy and filmstrip (add and render do it too)",
    )
    .option("--again", "make them again even if uploaded")
    .action((v: string, o: { again?: boolean }) =>
      withDb(async (db) => {
        const bucket = settings.mediaBucket;
        if (!bucket) throw new Error("WREN_MEDIA_BUCKET unset: nowhere to upload");
        await checkMediaStore({ bucket });
        const made = await finishMedia(db, await getEdit(db, id(v)), bucket, !!o.again);
        console.log(made.length ? `uploaded ${made.join(", ")}` : "already uploaded");
      }),
    );

  async function renderOne(db: Db, v: string, o: RenderOpts) {
    if (o.upload && o.cut) throw new Error("--upload uploads what is rendered; drop --cut");
    // A long render that can't upload at its end is lost time: check the session first.
    if (settings.mediaBucket) await checkMediaStore({ bucket: settings.mediaBucket });
    if (o.cut) await cutPass(db, await getEdit(db, id(v)), !o.again);
    const e = await getEdit(db, id(v));
    if (o.only && !PARTS.includes(o.only as (typeof PARTS)[number]))
      throw new Error(`--only is ${PARTS.join(", ")}`);
    const part = o.short ? "shorts" : o.only;
    // With no --only: the formats the edit lists, its Shorts and thumbnails.
    const want = (p: string) =>
      part ? part === p : isFormat(p) ? e.formats.includes(p as Format) : true;
    const numbers = o.short ? [o.short] : e.shorts.map((_, i) => i + 1);
    if (want("thumbs") && !e.thumbnail)
      console.log(`no thumbnail set; skipped (wren video set ${e.id} with "thumbnail")`);
    const out = join(e.dir, "out");
    // Every output this run is about, and which of them changed since their last render.
    const names = [
      ...(want("long") ? ["long"] : []),
      ...CROPPED.filter(want),
      ...(want("shorts") ? numbers.map((n) => `short-${n}`) : []),
      ...(want("thumbs") && e.thumbnail ? [1, 2, 3].map((n) => `thumb-${n}`) : []),
    ];
    if (!o.upload && !e.files.cutMain)
      throw new Error(`video ${e.id}: not cut yet; run wren video cut ${e.id}`);
    const hashes = o.upload ? await readHashes(out) : outputHashes(e);
    const todo = o.upload
      ? names
      : names.filter(
          (n) => o.again || hashes[n] !== e.files[hashKey(n)] || !existsSync(outFile(out, n)),
        );
    const kept = names.filter((n) => !todo.includes(n));
    if (kept.length) console.log(`unchanged since their last render: ${kept.join(", ")}`);
    // The long video's English subtitles, for YouTube's CC (approve sends them): the desk
    // reads this Mac's path. Written every run: it is the words, and costs nothing.
    const srt = want("long") ? join(out, "long.en.srt") : null;
    if (srt) {
      await mkdir(out, { recursive: true });
      await writeFile(srt, longSrt(e));
    }
    if (!o.upload && !todo.length) {
      if (srt) await setFiles(db, e.id, { captions: srt });
      await setRender(db, e.id, null);
      console.log(`video ${e.id}: nothing changed since the last render (--again renders anyway)`);
      return;
    }
    const go = (n: string) => todo.includes(n);
    const videos = names.some((n) => !n.startsWith("thumb-") && go(n));
    const mattes = videos && !o.upload ? await mattesFor(e) : [];
    const job: RenderJob = o.upload
      ? {}
      : {
          ...(go("long") ? { long: longProps(e, mattes, { skip: unread }) } : {}),
          framed: framedJob(e, mattes, go),
          ...(numbers.some((n) => go(`short-${n}`))
            ? {
                shorts: new Map(
                  numbers
                    .filter((n) => go(`short-${n}`))
                    .map((n) => [n, shortProps(e, n, mattes, { skip: unread })]),
                ),
              }
            : {}),
          ...(todo.some((n) => n.startsWith("thumb-"))
            ? {
                thumbnails: (thumbnailProps(e) ?? []).filter((p) => go(`thumb-${p.variant}`)),
              }
            : {}),
        };
    const started = Date.now();
    const { stats } = await recordedRun(
      db,
      {
        command: "video render",
        argv: {
          id: e.id,
          short: o.short ?? null,
          only: part ?? null,
          upload: !!o.upload,
          again: !!o.again,
          outputs: todo,
        },
      },
      async () => {
        const { files, seconds } = o.upload
          ? { files: onDisk(out, todo), seconds: {} }
          : await renderAll(studioDir, e.dir, job, (l) => console.log(l), settings.ffmpeg);
        if (o.upload && !Object.keys(files).length)
          throw new Error(`nothing rendered in ${out}: run wren video render ${e.id}`);
        // What each file in out/ was made from, kept with it until the upload is done.
        const made = { ...(await readHashes(out)), ...(o.upload ? {} : hashes) };
        if (!o.upload)
          await writeFile(
            join(out, HASHES),
            JSON.stringify({
              ...(await readHashes(out)),
              ...Object.fromEntries(Object.keys(files).map((n) => [n, hashes[n]])),
            }),
          );
        // Previews (540p) and stills to the private media bucket, keyed by content hash. Each
        // full Short goes up too, as its Instagram Reel: Graph fetches a URL, not a Mac path.
        const keys: Record<string, string> = {};
        const covers: Record<string, string> = {};
        const bucket = settings.mediaBucket;
        if (bucket)
          try {
            // His cover frame, exactly as the render drew it (Reels' cover picture).
            const cover = async (name: CroppedFormat, file: string) => {
              if (!e.thumbnail) return;
              const at = onCut(e.thumbnail.at, keepSegments(e.cuts, e.tracks.main.durationS, FPS));
              const jpg = await frameAt(file, at, join(out, `cover-${name}.jpg`), settings.ffmpeg);
              keys[`cover-${name}`] = await uploadMedia(jpg, { bucket });
              covers[hashKey(`cover-${name}`)] = coverHash(made[name], e.thumbnail.at);
            };
            for (const [name, file] of Object.entries(files)) {
              const up = file.endsWith(".mp4")
                ? await preview(file, join(out, `${name}-540.mp4`), settings.ffmpeg)
                : file;
              keys[name] = await uploadMedia(up, { bucket });
              const short = /^short-(\d+)$/.exec(name);
              const framed = CROPPED.find((f) => f === name);
              if (short || framed)
                keys[reelKey(short ? Number(short[1]) : (framed as CroppedFormat))] =
                  await uploadMedia(file, { bucket });
              if (framed) await cover(framed, file);
            }
            // A cover moved on a format not rendered again: the frame comes from its file.
            for (const f of CROPPED.filter(want))
              if (
                !files[f] &&
                e.thumbnail &&
                existsSync(outFile(out, f)) &&
                e.files[hashKey(`cover-${f}`)] !== coverHash(e.files[hashKey(f)], e.thumbnail.at)
              )
                await cover(f, outFile(out, f));
            await finishMedia(db, e, bucket);
          } catch (err) {
            // The render is good and stays in out/: only the upload needs doing again.
            const why = err instanceof Error ? err.message : String(err);
            throw new Error(
              `rendered, but the upload failed (${why}): ${AWS_LOGIN_HINT}, then wren video render ${e.id} --upload${part ? ` --only ${part}` : ""}`,
            );
          }
        else console.log("WREN_MEDIA_BUCKET unset: previews and Reels not uploaded");
        await setRendered(
          db,
          e.id,
          {
            ...files,
            ...hashFiles(made, Object.keys(files)),
            ...covers,
            ...(srt ? { captions: srt } : {}),
          },
          keys,
        );
        return {
          files,
          seconds,
          keys: Object.keys(keys),
          total: (Date.now() - started) / 1000,
        };
      },
    );
    for (const f of Object.values(stats.files)) console.log(f);
    console.log(
      `video ${e.id}: ${o.upload ? "uploaded from out/" : "rendered"} ${todo.join(", ")} in ${stats.total.toFixed(1)}s; ${stats.keys.length} previews/stills in S3`,
    );
  }

  video
    .command("promo <script>")
    .description(
      "a product promo from a JSON script (text, toasts, screen, stat, end; designs/2026-10-11-promo-video.md) to <its folder>/out/promo.mp4; a screen's url is captured first",
    )
    .option("--still <s>", "render one frame at this second to a png instead", Number)
    .option("--recapture", "capture every screen url again")
    .action(async (file: string, o: { still?: number; recapture?: boolean }) => {
      const path = resolve(file);
      const dir = dirname(path);
      const script = promoScript.parse(JSON.parse(await readFile(path, "utf8")));
      for (const [i, s] of script.scenes.entries()) {
        if (s.kind !== "screen" || !s.url) continue;
        const name = `shot-${i + 1}.png`;
        if (o.recapture || !existsSync(join(dir, name))) {
          console.log(`capturing ${s.url}`);
          await capturePage(s.url, join(dir, name));
        }
        s.image = name;
      }
      const sizes: Record<string, [number, number]> = {};
      for (const s of script.scenes)
        if (s.kind === "screen" && s.image) {
          const head = await readFile(join(dir, s.image)).then((b) => b.subarray(0, 24));
          // A png's header holds its width and height at bytes 16 and 20.
          if (head.toString("latin1", 1, 4) === "PNG")
            sizes[s.image] = [head.readUInt32BE(16), head.readUInt32BE(20)];
        }
      const props = promoProps(script, sizes);
      console.log(await renderPromo(studioDir, dir, props, o.still));
      console.log(
        `${(props.durationInFrames / props.fps).toFixed(1)}s, ${props.scenes.length} scenes`,
      );
    });

  withWatchOptions(
    video
      .command("watch [input]")
      .description(
        "with a URL or file: read the video (speech, on-screen text by frame time, cuts), stores nothing. With none: add each new finished OBS or Cap recording once (the desk runs this every minute)",
      )
      .option(
        "--quiet <s>",
        "no input: seconds an OBS file stays untouched before it counts as finished",
        Number,
        60,
      ),
  ).action(async (input: string | undefined, o: { quiet: number } & WatchFlags) => {
    if (input) return watchVideo(input, o, settings, rootDir);
    const obs = await obsRecordingDir();
    // OBS files are finished once quiet and closed; a Cap project once its meta says Complete.
    const found = [
      ...(obs ? await findRecordings(obs, o.quiet) : []),
      ...(await findCapProjects()),
    ];
    // Seen ones live here, so a minute with nothing new never opens the database.
    const ledger = join(homedir(), ".cache/wren/recordings-seen.json");
    const seen: string[] = JSON.parse((await readFile(ledger, "utf8").catch(() => "[]")) || "[]");
    for (const input of found.filter((f) => !seen.includes(f))) {
      if (!isCap(input) && (await isOpen(input))) continue;
      // Once each, whatever comes of it: a failed add is retried by hand (wren video add).
      seen.push(input);
      await mkdir(dirname(ledger), { recursive: true });
      await writeFile(ledger, JSON.stringify(seen));
      await withDb(async (db) => {
        // A Cap project's tracks are files inside it.
        const had = await db
          .select({ id: videoEdits.id })
          .from(videoEdits)
          .where(
            sql`${videoEdits.tracks}->'main'->>'path' = ${input} OR starts_with(${videoEdits.tracks}->'main'->>'path', ${`${input}/`})`,
          );
        if (had.length) return console.log(`${input}: already video ${had[0]?.id}`);
        const e = await addVideo(db, input, {
          ffmpeg: settings.ffmpeg,
          log: (l) => console.log(l),
        });
        console.log(`${input}: added as video ${e.id}`);
        // The editing agent's first pass (designs/2026-10-13-video-review.md): it arrives edited.
        await clients
          .connect(ingressOf(settings))
          .serviceSendClient<{ edit: (ctx: unknown, req: { id: number }) => Promise<unknown> }>({
            name: "VideoDesk",
          })
          .edit({ id: e.id })
          .then(
            () => console.log(`video ${e.id}: the agent is editing it`),
            (err: unknown) =>
              console.error(
                `video ${e.id}: the agent didn't start (${err instanceof Error ? err.message : err}); run it from the page`,
              ),
          );
      }).catch((err: unknown) =>
        console.error(`${input}: ${err instanceof Error ? err.message : err}`),
      );
    }
  });

  video
    .command("look <id>")
    .description("a model watches the cut file: moments, Shorts ideas, chapters, thumbnail frames")
    .requiredOption("--with <provider>", LOOK_PROVIDERS.join(" or "))
    .action((v: string, o: { with: string }) =>
      withDb(async (db) => {
        const e = await getEdit(db, id(v));
        if (!e.files.cutMain) throw new Error(`video ${e.id}: not cut yet; wren video cut ${e.id}`);
        const keep = keepSegments(e.cuts, e.tracks.main.durationS, FPS);
        const durationS = keep.reduce((n, k) => n + k.e - k.s, 0);
        let looker: Looker;
        if (o.with === "gemini") {
          // Keys from llm.env, as the SOP reader loads them; never logged.
          loadLlmEnv(settings.llmEnvPath, rootDir);
          looker = geminiLooker(fleetKeys(process.env, "gemini"));
        } else if (o.with === "cohere") {
          loadLlmEnv(settings.llmEnvPath, rootDir);
          looker = cohereLooker(fleetKeys(process.env, "cohere"), { ffmpeg: settings.ffmpeg });
        } else if (o.with === "twelvelabs") {
          const s = await stat(e.files.cutMain);
          looker = twelvelabsLooker(process.env.TWELVELABS_API_KEY, {
            usedMinutes: await twelvelabsMinutes(db),
            durationS,
            cut: `${s.mtimeMs}-${s.size}`,
          });
        } else throw new Error(`--with is ${LOOK_PROVIDERS.join(" or ")}`);
        const { stats } = await recordedRun(
          db,
          { command: "video look", argv: { id: e.id, with: o.with }, model: o.with },
          async () => {
            const proxy = await proxy360(
              e.files.cutMain as string,
              e.files.cutCam,
              join(e.dir, "look-360.mp4"),
              settings.ffmpeg,
            );
            const look = toRaw(
              await looker(proxy, cutTranscript(e.words, keep), e.looks[o.with]?.media),
              keep,
            );
            await setLook(db, e.id, o.with, look);
            return {
              moments: look.moments.length,
              shorts: look.shorts.length,
              minutes: look.media?.minutes ?? null,
            };
          },
        );
        console.log(
          `video ${e.id}: ${o.with} looked (${JSON.stringify(stats)}); in wren video show ${e.id} under looks`,
        );
      }),
    );

  video
    .command("find <id> <words>")
    .description("search the video for a moment (TwelveLabs; needs a look --with twelvelabs first)")
    .action((v: string, words: string) =>
      withDb(async (db) => {
        const e = await getEdit(db, id(v));
        const media = e.looks.twelvelabs?.media;
        if (!media)
          throw new Error(`video ${e.id}: not indexed; wren video look ${e.id} --with twelvelabs`);
        const keep = keepSegments(e.cuts, e.tracks.main.durationS, FPS);
        const hits = await twelvelabsFind(process.env.TWELVELABS_API_KEY, media, words);
        if (!hits.length) console.log("no match");
        for (const h of hits)
          console.log(
            `cut ${t(h.start)}-${t(h.end)}  raw ${t(fromCutTime(h.start, keep))}-${t(fromCutTime(h.end, keep))}${h.rank ? `  rank ${h.rank}` : ""}`,
          );
      }),
    );
}
