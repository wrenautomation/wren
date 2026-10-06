/**
 * `wren video add|list|show|set|approve|cuts|keep|knobs|cut|studio|render|look|find`: the video
 * editor (designs/2026-10-06-video-editor.md). Claude Code edits through `show` and `set`; every
 * write leaves a runs row. Runs on William's Mac: whisper.cpp, ffmpeg (VideoToolbox), Remotion.
 */
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Settings } from "@wren/config";
import { approveVideo, uploadMedia } from "@wren/content";
import { recordedRun } from "@wren/core";
import type { Db } from "@wren/db";
import { fleetKeys, loadLlmEnv } from "@wren/llm";
import {
  addVideo,
  cutKnobs,
  cutTracks,
  cutTranscript,
  FPS,
  fromCutTime,
  geminiLooker,
  getEdit,
  keepCut,
  keepSegments,
  LOOK_PROVIDERS,
  type Looker,
  longProps,
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
  setRendered,
  shortProps,
  thumbnailProps,
  toRaw,
  twelvelabsFind,
  twelvelabsLooker,
  twelvelabsMinutes,
  type VideoEdit,
  videoEdits,
} from "@wren/studio";
import type { Command } from "commander";
import { desc } from "drizzle-orm";
import { readText } from "./content.js";
import { autobrowseDrive } from "./sop.js";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const OBS_NOTE = `
Input: an OBS recording. One file (OBS scene, cam already placed; give --cam once per scene so
Shorts can crop it), or a folder with the recording and the camera file. For the camera file:
OBS > Tools > Source Record on the camera source, same folder as the main recording. The two are
lined up by their audio. Needs: brew install whisper-cpp, and the model in ~/.cache/wren/whisper.`;

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
    .description("ingest an OBS recording (file or folder): sync, transcribe, silence cuts")
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
      "write fields of the edit from JSON (file or stdin): title, description, tags, chapters, cuts, layout, captions, shorts, thumbnail",
    )
    .option("--file <f>", "read the JSON from this file; else stdin")
    .action(async (v: string, o: { file?: string }) => {
      const text = (await readText(o.file)).trim();
      if (!text) throw new Error("no JSON: pass --file or pipe it in");
      const r = await withDb((db) => setEdit(db, id(v), JSON.parse(text), { by: "cli" }));
      console.log(`video ${r.edit.id}: set (run ${r.run})`);
    });

  video
    .command("approve <id>")
    .description(
      "his yes: a private YouTube draft of the rendered file, uploaded by the desk on the next pass",
    )
    .option("--short <n>", "a Short instead of the long video, 1 for the first", (n) => id(n))
    .action((v: string, o: { short?: number }) =>
      withDb(async (db) => {
        const d = await approveVideo(db, id(v), {
          source: "cli",
          ...(o.short ? { short: o.short } : {}),
        });
        console.log(
          d.again
            ? `video ${v}: already approved as draft ${d.id}`
            : `video ${v}: draft ${d.id} approved; it uploads, private, on the next pass`,
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
    .action((o: { minGap?: number; air?: number; noiseMargin?: number; snap?: number }) =>
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
        console.log(JSON.stringify(k));
      }),
    );

  video
    .command("cut <id>")
    .description("apply the cuts to both tracks: 1080p, 30 fps, VideoToolbox, 10 ms fades")
    .action((v: string) =>
      withDb(async (db) => {
        const e = await getEdit(db, id(v));
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
        console.log(`${keep.length} segments in ${stats.seconds}s; wren video studio ${e.id}`);
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
      "Remotion render to <dir>/out: long 16:9, Shorts 9:16, 3 thumbnails; previews and stills to S3",
    )
    .option("--short <n>", "only Short n", id)
    .option("--only <part>", "long, shorts or thumbs")
    .action((v: string, o: { short?: number; only?: string }) =>
      withDb(async (db) => {
        const e = await getEdit(db, id(v));
        if (o.only && !["long", "shorts", "thumbs"].includes(o.only))
          throw new Error("--only is long, shorts or thumbs");
        const part = o.short ? "shorts" : o.only;
        const want = (p: string) => !part || part === p;
        const numbers = o.short ? [o.short] : e.shorts.map((_, i) => i + 1);
        const thumbs = want("thumbs") ? thumbnailProps(e) : null;
        if (want("thumbs") && !thumbs)
          console.log(`no thumbnail set; skipped (wren video set ${e.id} with "thumbnail")`);
        const job: RenderJob = {
          ...(want("long") ? { long: longProps(e) } : {}),
          ...(want("shorts") ? { shorts: new Map(numbers.map((n) => [n, shortProps(e, n)])) } : {}),
          ...(thumbs ? { thumbnails: thumbs } : {}),
        };
        const started = Date.now();
        const { stats } = await recordedRun(
          db,
          {
            command: "video render",
            argv: { id: e.id, short: o.short ?? null, only: part ?? null },
          },
          async () => {
            const { files, seconds } = await renderAll(studioDir, e.dir, job, (l) =>
              console.log(l),
            );
            // Previews (540p) and stills to the private media bucket, keyed by content hash.
            const keys: Record<string, string> = {};
            if (settings.mediaBucket)
              for (const [name, file] of Object.entries(files)) {
                const up = file.endsWith(".mp4")
                  ? await preview(file, join(e.dir, "out", `${name}-540.mp4`), settings.ffmpeg)
                  : file;
                keys[name] = await uploadMedia(up, { bucket: settings.mediaBucket });
              }
            else console.log("WREN_MEDIA_BUCKET unset: previews not uploaded");
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
          `video ${e.id}: rendered in ${stats.total.toFixed(1)}s; ${stats.keys.length} previews/stills in S3`,
        );
      }),
    );

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
