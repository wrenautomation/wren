/**
 * `wren video add|list|show|set|words|approve|cuts|keep|knobs|cut|studio|render|look|find`: the video
 * editor (designs/2026-10-06-video-editor.md). Claude Code edits through `show` and `set`; every
 * write leaves a runs row. Runs on William's Mac: whisper.cpp, ffmpeg (VideoToolbox), Remotion.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Settings } from "@wren/config";
import {
  AWS_LOGIN_HINT,
  approveVideo,
  checkMediaStore,
  reelKey,
  uploadMedia,
  VIDEO_PRIVACY,
} from "@wren/content";
import { recordedRun } from "@wren/core";
import type { Db } from "@wren/db";
import { fleetKeys, loadLlmEnv } from "@wren/llm";
import {
  addVideo,
  cutKnobs,
  cutTracks,
  cutTranscript,
  FPS,
  findCapProjects,
  findRecordings,
  fromCutTime,
  geminiLooker,
  getEdit,
  isCap,
  isOpen,
  keepCut,
  keepSegments,
  LOOK_PROVIDERS,
  type Looker,
  longProps,
  obsRecordingDir,
  openStudio,
  preview,
  proxy360,
  type RenderJob,
  redoSilence,
  renderAll,
  renderStill,
  reviewCuts,
  setCutKnobs,
  setEdit,
  setFiles,
  setLook,
  setRender,
  setRendered,
  setStudioWords,
  setWords,
  shortProps,
  studioWords,
  thumbnailProps,
  toRaw,
  twelvelabsFind,
  twelvelabsLooker,
  twelvelabsMinutes,
  type VideoEdit,
  verticalProps,
  videoEdits,
} from "@wren/studio";
import type { Command } from "commander";
import { desc, sql } from "drizzle-orm";
import { readText } from "./content.js";
import { autobrowseDrive } from "./sop.js";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const OBS_NOTE = `
Input: an OBS recording. One file (OBS scene, cam already placed; give --cam once per scene so
Shorts can crop it), or a folder with the recording and the camera file. For the camera file:
OBS > Tools > Source Record on the camera source, same folder as the main recording. The two are
lined up by their audio. Or a Cap project (<name>.cap): its screen, mic and camera files, lined
up by Cap's start times. Needs: brew install whisper-cpp, and the model in ~/.cache/wren/whisper.`;

/** What `render --only` takes: a format, or the Shorts or thumbnails alone. */
const PARTS = ["long", "vertical", "shorts", "thumbs"] as const;

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

type RenderOpts = { short?: number; only?: string; cut?: boolean; upload?: boolean };

/** What the job would render that out/ already holds, by output name (`--upload`). */
function rendered(out: string, job: RenderJob): Record<string, string> {
  const videos = [
    ...(job.long ? ["long"] : []),
    ...(job.vertical ? ["vertical"] : []),
    ...[...(job.shorts?.keys() ?? [])].map((n) => `short-${n}`),
  ].map((n) => [n, join(out, `${n}.mp4`)] as const);
  const thumbs = (job.thumbnails ?? []).map(
    (p) => [`thumb-${p.variant}`, join(out, `thumb-${p.variant}.jpg`)] as const,
  );
  return Object.fromEntries([...videos, ...thumbs].filter(([, f]) => existsSync(f)));
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
    .addHelpText("after", OBS_NOTE)
    .action(
      async (
        input: string,
        o: { script?: string; account?: string; cam?: string; offset?: number; model?: string },
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
            log: (l) => console.log(l),
          }),
        );
        const cut = e.cuts.filter((c) => c.state === "cut");
        console.log(
          `video ${e.id}: ${e.words.length} words, ${cut.length} silence cuts (${cut.reduce((n, c) => n + c.to - c.from, 0).toFixed(1)}s), ${e.cuts.length - cut.length} proposals${e.tracks.cam ? `, camera offset ${e.tracks.cam.offsetS}s` : ""}`,
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

  video
    .command("set <id>")
    .description(
      "write fields of the edit from JSON (file or stdin): title, description, tags, chapters, cuts, layout, captions, shorts, formats, thumbnail",
    )
    .option("--file <f>", "read the JSON from this file; else stdin")
    .action(async (v: string, o: { file?: string }) => {
      const text = (await readText(o.file)).trim();
      if (!text) throw new Error("no JSON: pass --file or pipe it in");
      const r = await withDb((db) => setEdit(db, id(v), JSON.parse(text), { by: "cli" }));
      console.log(`video ${r.edit.id}: set (run ${r.run})`);
    });

  video
    .command("words <id>")
    .description("fix a misheard word in the transcript before render: its text, never its times")
    .option("--fix <wrong=right>", 'every match, case kept: --fix "drug fooding=dogfooding"')
    .option("--at <s>", "the one word said at this second of the recording (with <text>)", Number)
    .argument("[text]", "the word's new text, with --at")
    .action((v: string, text: string | undefined, o: { fix?: string; at?: number }) =>
      withDb(async (db) => {
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
    .action((v: string, o: { short?: number; vertical?: boolean; privacy: string }) =>
      withDb(async (db) => {
        const privacy = VIDEO_PRIVACY.find((p) => p === o.privacy);
        if (!privacy) throw new Error(`--privacy ${o.privacy}: one of ${VIDEO_PRIVACY.join(", ")}`);
        if (o.short && o.vertical) throw new Error("--short or --vertical, not both");
        const d = await approveVideo(db, id(v), {
          source: "cli",
          privacy,
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
    .command("knobs")
    .description("the silence pass knobs (wren_settings studio.cuts); flags set them")
    .option("--min-gap <s>", "shortest silence cut", Number)
    .option("--air <s>", "kept on each side of a word", Number)
    .option("--noise-margin <db>", "silence threshold over the measured noise floor", Number)
    .option("--snap <s>", "how far inward an edge may move to the quietest 20 ms", Number)
    .option(
      "--words <list>",
      "names Whisper should spell right on ingest, comma between (studio.words)",
    )
    .action(
      (o: { minGap?: number; air?: number; noiseMargin?: number; snap?: number; words?: string }) =>
        withDb(async (db) => {
          const patch = {
            ...(o.minGap !== undefined ? { minGapS: o.minGap } : {}),
            ...(o.air !== undefined ? { airS: o.air } : {}),
            ...(o.noiseMargin !== undefined ? { noiseMarginDb: o.noiseMargin } : {}),
            ...(o.snap !== undefined ? { snapS: o.snap } : {}),
          };
          const k = Object.keys(patch).length
            ? await setCutKnobs(db, patch, "cli")
            : await cutKnobs(db);
          const words =
            o.words !== undefined
              ? await setStudioWords(db, o.words.split(","), "cli")
              : await studioWords(db);
          console.log(JSON.stringify({ cuts: k, words }));
        }),
    );

  /** The cut pass: both tracks cut to the edit's cuts, the files on the row. */
  async function cutPass(db: Db, e: VideoEdit) {
    const keep = keepSegments(e.cuts, e.tracks.main.durationS, FPS);
    const started = Date.now();
    const { stats } = await recordedRun(
      db,
      { command: "video cut", argv: { id: e.id, segments: keep.length } },
      async () => {
        const files = await cutTracks(e.tracks, keep, e.dir, settings.ffmpeg);
        await setFiles(db, e.id, files);
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
      "Remotion render to <dir>/out: the edit's formats (long 16:9, vertical 9:16), Shorts 9:16, 3 thumbnails; previews and stills to S3",
    )
    .option("--short <n>", "only Short n", id)
    .option(
      "--only <part>",
      `${PARTS.join(", ")} (a format renders even if the edit doesn't list it)`,
    )
    .option("--cut", "run the cut pass first (the page's Render does)")
    .option("--upload", "no render: upload what out/ already holds and mark it rendered")
    .action((v: string, o: RenderOpts) =>
      withDb(async (db) => {
        // Its state on the row for the page: rendering, then done (setRendered) or failed and why.
        const at = () => new Date().toISOString();
        await setRender(db, id(v), { state: "rendering", at: at() });
        try {
          await renderOne(db, v, o);
        } catch (err) {
          const why = (err instanceof Error ? err.message : String(err)).slice(-500);
          await setRender(db, id(v), { state: "failed", at: at(), why });
          throw err;
        }
      }),
    );

  async function renderOne(db: Db, v: string, o: RenderOpts) {
    if (o.upload && o.cut) throw new Error("--upload uploads what is rendered; drop --cut");
    // A long render that can't upload at its end is lost time: check the session first.
    if (settings.mediaBucket) await checkMediaStore({ bucket: settings.mediaBucket });
    if (o.cut) await cutPass(db, await getEdit(db, id(v)));
    const e = await getEdit(db, id(v));
    if (o.only && !PARTS.includes(o.only as (typeof PARTS)[number]))
      throw new Error(`--only is ${PARTS.join(", ")}`);
    const part = o.short ? "shorts" : o.only;
    // With no --only: the formats the edit lists, its Shorts and thumbnails.
    const want = (p: string) =>
      part ? part === p : p === "long" || p === "vertical" ? e.formats.includes(p) : true;
    const numbers = o.short ? [o.short] : e.shorts.map((_, i) => i + 1);
    const thumbs = want("thumbs") ? thumbnailProps(e) : null;
    if (want("thumbs") && !thumbs)
      console.log(`no thumbnail set; skipped (wren video set ${e.id} with "thumbnail")`);
    const job: RenderJob = {
      ...(want("long") ? { long: longProps(e) } : {}),
      ...(want("vertical") ? { vertical: verticalProps(e) } : {}),
      ...(want("shorts") ? { shorts: new Map(numbers.map((n) => [n, shortProps(e, n)])) } : {}),
      ...(thumbs ? { thumbnails: thumbs } : {}),
    };
    const started = Date.now();
    const { stats } = await recordedRun(
      db,
      {
        command: "video render",
        argv: { id: e.id, short: o.short ?? null, only: part ?? null, upload: !!o.upload },
      },
      async () => {
        const { files, seconds } = o.upload
          ? { files: await rendered(join(e.dir, "out"), job), seconds: {} }
          : await renderAll(studioDir, e.dir, job, (l) => console.log(l), settings.ffmpeg);
        if (o.upload && !Object.keys(files).length)
          throw new Error(
            `nothing rendered in ${join(e.dir, "out")}: run wren video render ${e.id}`,
          );
        // Previews (540p) and stills to the private media bucket, keyed by content hash. Each
        // full Short goes up too, as its Instagram Reel: Graph fetches a URL, not a Mac path.
        const keys: Record<string, string> = {};
        const bucket = settings.mediaBucket;
        if (bucket)
          try {
            for (const [name, file] of Object.entries(files)) {
              const up = file.endsWith(".mp4")
                ? await preview(file, join(e.dir, "out", `${name}-540.mp4`), settings.ffmpeg)
                : file;
              keys[name] = await uploadMedia(up, { bucket });
              const short = /^short-(\d+)$/.exec(name);
              if (short || name === "vertical")
                keys[reelKey(short ? Number(short[1]) : "vertical")] = await uploadMedia(file, {
                  bucket,
                });
            }
          } catch (err) {
            // The render is good and stays in out/: only the upload needs doing again.
            const why = err instanceof Error ? err.message : String(err);
            throw new Error(
              `rendered, but the upload failed (${why}): ${AWS_LOGIN_HINT}, then wren video render ${e.id} --upload${part ? ` --only ${part}` : ""}`,
            );
          }
        else console.log("WREN_MEDIA_BUCKET unset: previews and Reels not uploaded");
        await setRendered(db, e.id, files, keys);
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
      `video ${e.id}: ${o.upload ? "uploaded from out/" : "rendered"} in ${stats.total.toFixed(1)}s; ${stats.keys.length} previews/stills in S3`,
    );
  }

  video
    .command("watch")
    .description(
      "add each new finished OBS or Cap recording once (the desk runs this every minute)",
    )
    .option(
      "--quiet <s>",
      "seconds an OBS file stays untouched before it counts as finished",
      Number,
      60,
    )
    .action(async (o: { quiet: number }) => {
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
