/**
 * `wren video …`: the video editor (./studio.ts), and under `wren video demo …` per-lead demo
 * videos. `try` records one for a firm name into
 * a local file (nothing stored). `render` records, publishes and keeps one per
 * firm as a `video` enrichment; Ctrl-C and run again to resume, a firm that has
 * this walk's video is skipped. `show` prints what a firm has. Always the main
 * database. A niche needs `--limit`: a batch is a decision, not a default.
 */
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Settings } from "@wren/config";
import { recordedRun } from "@wren/core";
import type { Db } from "@wren/db";
import { displayFirm, renderWalk, videoForCompany, WALK } from "@wren/reactivation/video";
import { findCompanyIds, nicheCompanyIds } from "@wren/research/dossier";
import { enrichments } from "@wren/research/schema";
import type { Command } from "commander";
import { and, desc, eq, inArray } from "drizzle-orm";
import { registerStudio } from "./studio.js";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const PAGE = 200;

export function registerVideo(
  program: Command,
  withDb: WithDb,
  settings: Settings,
  rootDir: string,
): void {
  const video = program
    .command("video")
    .description("the video editor (add, cut, studio, look) and per-lead demo videos (demo)");
  registerStudio(video, withDb, settings, rootDir);
  const demo = video
    .command("demo")
    .description("per-lead demo videos: the reactivation demo, made for one firm");

  demo
    .command("try <firm>")
    .description("record the walk for a firm name into a local mp4 (and .jpg); stores nothing")
    .option("--out <file>", "where the mp4 goes", "video.mp4")
    .action(async (firm: string, opts: { out: string }) => {
      const name = displayFirm(firm);
      if (!name) throw new Error(`"${firm}" has no words to show`);
      const dir = await mkdtemp(join(tmpdir(), "wren-video-"));
      try {
        const encoded = await renderWalk(
          { companyId: 0, firm: name, domain: null },
          { dir, ffmpeg: settings.ffmpeg },
        );
        const out = resolve(rootDir, opts.out);
        await copyFile(encoded.mp4, out);
        await copyFile(encoded.poster, out.replace(/\.mp4$/i, "") + ".jpg");
        console.log(`${out} (${encoded.seconds.toFixed(1)}s, "${name}")`);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

  demo
    .command("render [company]")
    .description("record, publish and keep a firm's video: one by id, domain or name, or --niche")
    .option("--niche <niche>", "every firm in a niche, in id order (needs --limit)")
    .option("--limit <n>", "with --niche: at most this many firms", (v) => Number.parseInt(v, 10))
    .action((query: string | undefined, opts: { niche?: string; limit?: number }) =>
      withDb(async (db) => {
        if (!settings.videosBucket || !settings.videosOrigin)
          throw new Error("set WREN_VIDEOS_BUCKET and WREN_VIDEOS_ORIGIN (tofu output videos_*)");
        if (!query === !opts.niche) throw new Error("give a company or --niche, not both");
        if (opts.niche && !(opts.limit && opts.limit > 0))
          throw new Error("--niche needs --limit: how many videos is a decision");
        const options = {
          workDir: join(tmpdir(), "wren-video"),
          ffmpeg: settings.ffmpeg,
          store: { bucket: settings.videosBucket, origin: settings.videosOrigin },
          watchUrl: (id: string) => `${settings.videosWatchBase}${id}`,
        };
        const { run, stats } = await recordedRun(
          db,
          {
            command: "video render",
            argv: { query: query ?? null, ...opts },
            niche: opts.niche ?? null,
            model: WALK.name,
          },
          async (r) => {
            const stats = { made: 0, had: 0, skipped: 0, seconds: 0 };
            for await (const companyId of companyIdsOf(db, query, opts)) {
              const v = await videoForCompany(db, companyId, { ...options, runId: r.id });
              stats[v.status]++;
              if (v.status === "made") stats.seconds += Math.round(v.seconds);
              const note = v.status === "skipped" ? v.why : v.url;
              console.log(`${companyId}\t${v.status}\t${note}`);
            }
            return stats;
          },
        );
        console.log(`run ${run.id}: ${JSON.stringify(stats)}`);
      }),
    );

  demo
    .command("show <company>")
    .description("a firm's videos, newest first")
    .action((query: string) =>
      withDb(async (db) => {
        const ids = await findCompanyIds(db, query, 5);
        if (!ids.length) {
          console.log(`no company matches "${query}"`);
          return;
        }
        const rows = await db
          .select()
          .from(enrichments)
          .where(and(inArray(enrichments.companyId, ids), eq(enrichments.kind, "video")))
          .orderBy(desc(enrichments.createdAt));
        if (!rows.length) console.log("no videos");
        for (const r of rows) {
          const o = r.output as { url?: string; mp4?: string; seconds?: number; firm?: string };
          const when = r.createdAt.toISOString().slice(0, 10);
          console.log(
            `${r.companyId}\t${when}\t${r.model}@${r.promptVersion}\t"${o.firm}"\t${o.seconds}s\t${o.url}\t${o.mp4}`,
          );
        }
      }),
    );
}

/** The one company a query names, or a niche's firms a page at a time. */
async function* companyIdsOf(
  db: Db,
  query: string | undefined,
  opts: { niche?: string; limit?: number },
): AsyncGenerator<number> {
  if (query) {
    const ids = await findCompanyIds(db, query, 5);
    if (ids.length !== 1)
      throw new Error(
        ids.length
          ? `"${query}" matches ${ids.length} firms (${ids.join(", ")}); give an id`
          : `no company matches "${query}"`,
      );
    yield ids[0] as number;
    return;
  }
  const cap = opts.limit ?? 0;
  let given = 0;
  let afterId = 0;
  while (given < cap) {
    const ids = await nicheCompanyIds(
      db,
      opts.niche as string,
      Math.min(PAGE, cap - given),
      afterId,
    );
    if (!ids.length) return;
    for (const id of ids) yield id;
    given += ids.length;
    afterId = ids[ids.length - 1] ?? afterId;
  }
}
