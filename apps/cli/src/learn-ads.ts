/**
 * `wren learn ads` (designs/2026-11-11-competitor-ads.md): pull an advertiser's or a keyword's ads
 * from the Meta Ad Library (autobrowse `fb-public GET /ads` on the desk, signed out, $0), save each
 * whole, read it here (the media links expire: a video through the watch core, images through the
 * eye) and break it down. `--ads`: a Weaver run's kept ads (`weaver export <run> --source ads`),
 * no desk read. `--winners` lists the long runners.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Settings } from "@wren/config";
import { DESK } from "@wren/core/autobrowse/restate";
import type { Db } from "@wren/db";
import {
  type AdsAnswer,
  adFacts,
  adImages,
  adImagesPage,
  adImagesPrompt,
  adImagesSchema,
  adPage,
  adUrl,
  adVideos,
  breakdownItem,
  items,
  type JudgeFor,
  type LibraryAd,
  saveAd,
  winningAds,
} from "@wren/learn";
import type { Model } from "@wrenautomation/models";
import { s3MediaStore } from "@wrenautomation/read/s3";
import { type MediaStore, renderWatched, watchFile } from "@wrenautomation/read/video";
import type { Command } from "commander";
import { eq } from "drizzle-orm";
import { ingressSites } from "./sites.js";
import { watchEyes } from "./video-watch.js";

const BY = "cli";
/** Images read per ad; a carousel past this is its first ones. */
const MAX_IMAGES = 10;
/** A pull of 600 ads is 20 library pages on the desk. */
const PULL_MS = 20 * 60_000;
const say = (line: string) => console.error(line);

async function fetched(url: string): Promise<{ data: Uint8Array; type: string }> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`media ${r.status}`);
  const type = r.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  return { data: new Uint8Array(await r.arrayBuffer()), type };
}

/** What the media showed and said, with the speech and cuts for the facts. */
async function readMedia(
  ad: LibraryAd,
  o: {
    eye: Model;
    ear?: Parameters<typeof watchFile>[1]["ear"];
    ffmpeg: string;
    store?: MediaStore;
  },
): Promise<{ md: string; speech: boolean | null; cuts: number | null; durationS: number | null }> {
  const video = adVideos(ad)[0];
  const src = video?.hd ?? video?.sd;
  if (src) {
    const dir = await mkdtemp(join(tmpdir(), "ad-"));
    try {
      const file = join(dir, `${ad.libraryId}.mp4`);
      await writeFile(file, (await fetched(src)).data);
      // the link expires: the file is kept, keyed by the library id
      await o.store?.put(`meta-ad-${ad.libraryId}`, file, {
        id: ad.libraryId,
        title: ad.advertiser?.name ?? ad.libraryId,
        webpage_url: adUrl(ad.libraryId),
      });
      const w = await watchFile(file, {
        eye: o.eye,
        ...(o.ear ? { ear: o.ear } : {}),
        ffmpeg: o.ffmpeg,
        look: "all",
      });
      return {
        md: renderWatched(w),
        speech: !!w.speech.trim(),
        cuts: w.cuts.length,
        durationS: w.durationS,
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  const urls = adImages(ad).slice(0, MAX_IMAGES);
  if (!urls.length) return { md: "", speech: null, cuts: null, durationS: null };
  const parts = await Promise.all(
    urls.map(async (u) => {
      const f = await fetched(u);
      return { type: "image" as const, data: f.data, mediaType: f.type };
    }),
  );
  const a = await o.eye.ask(
    [...parts, { type: "text" as const, text: adImagesPrompt(parts.length) }],
    adImagesSchema,
  );
  return { md: adImagesPage(a.value), speech: null, cuts: null, durationS: null };
}

/** Read one saved ad into its item's page; the error text when it fails (kept on the item). */
async function readAd(
  db: Db,
  id: number,
  ad: LibraryAd,
  o: Parameters<typeof readMedia>[1],
): Promise<"read" | string> {
  try {
    const m = await readMedia(ad, o);
    await db
      .update(items)
      .set({
        transcript: adPage(ad, adFacts(ad, m), m.md),
        readAt: new Date(),
        readFailure: null,
        ...(m.durationS ? { duration: Math.round(m.durationS) } : {}),
      })
      .where(eq(items.id, id));
    return "read";
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    await db
      .update(items)
      .set({ readFailure: why.slice(0, 500) })
      .where(eq(items.id, id));
    return why;
  }
}

export function registerLearnAds(
  learn: Command,
  d: {
    inWorkspace: <T>(fn: (db: Db, client: string) => Promise<T>) => Promise<T>;
    judgeFor: (db: Db, model: string) => JudgeFor;
    settings: Settings;
    rootDir: string;
  },
): void {
  learn
    .command("ads")
    .description(
      "competitor ads from the Meta Ad Library (desk, signed out): an advertiser's (--page) or a keyword's (--q), each saved whole, read here and broken down; --winners lists the long runners",
    )
    .option("--page <page>", "advertiser: page id, page URL or username")
    .option(
      "--ads <file>",
      "ads already pulled, as a JSON array: a Weaver run's kept ads (`weaver export <run> --source ads`)",
    )
    .option("--q <words>", "keyword search")
    .option("--country <code>", "ISO code or ALL", "US")
    .option("--inactive", "ended ads too")
    .option(
      "--max <n>",
      "ads to pull, 1 to 600 (30 a library page)",
      (v) => Number.parseInt(v, 10),
      30,
    )
    .option("--no-read", "only save them")
    .option("--model <name>", "the breakdown model", "cohere")
    .option("--winners", "list the winners kept so far (with --page: that advertiser's)")
    .option("--limit <n>", "winners to list", (v) => Number.parseInt(v, 10), 30)
    .action(
      async (o: {
        page?: string;
        ads?: string;
        q?: string;
        country: string;
        inactive?: boolean;
        max: number;
        read: boolean;
        model: string;
        winners?: boolean;
        limit: number;
      }) => {
        if (o.winners) {
          const out = await d.inWorkspace((db, client) =>
            winningAds(db, client, { ...(o.page ? { pageId: o.page } : {}), limit: o.limit }),
          );
          console.log(JSON.stringify(out, null, 2));
          return;
        }
        if ([o.page, o.q, o.ads].filter(Boolean).length !== 1)
          throw new Error("give one of --page, --q or --ads");
        const answer = o.ads ? await keptAds(o.ads) : await pull(d.settings, o);
        if (answer.found === false) throw new Error(`no Ad Library page for ${o.page}`);
        const media = (() => {
          const { eye, ear } = watchEyes(d.settings, d.rootDir);
          const store = d.settings.mediaBucket ? s3MediaStore(d.settings.mediaBucket) : undefined;
          return {
            eye,
            ...(ear ? { ear } : {}),
            ffmpeg: d.settings.ffmpeg,
            ...(store ? { store } : {}),
          };
        })();
        const out = await d.inWorkspace(async (db, client) => {
          const judge = d.judgeFor(db, o.model);
          const rows: Array<{
            id: number;
            libraryId: string;
            fresh: boolean;
            winner: boolean;
            read: string | null;
            broken: boolean;
          }> = [];
          for (const ad of answer.ads) {
            const saved = await saveAd(db, {
              client,
              ad,
              pageId: answer.pageId ?? null,
              by: o.ads ? "weaver" : BY,
              via: "cli",
            });
            const read = saved.unread && o.read ? await readAd(db, saved.id, ad, media) : null;
            const broken = read === "read" && (await breakdownItem(db, judge, saved.id));
            say(
              `${saved.id} ${ad.libraryId}${saved.winner ? " winner" : ""} ${read ?? "kept"}${broken ? " broken down" : ""}`,
            );
            rows.push({
              id: saved.id,
              libraryId: ad.libraryId,
              fresh: saved.fresh,
              winner: saved.winner,
              read,
              broken,
            });
          }
          return rows;
        });
        console.log(
          JSON.stringify(
            {
              query: answer.query,
              pageId: answer.pageId ?? null,
              total: answer.total ?? null,
              pulled: answer.ads.length,
              winners: out.filter((r) => r.winner).length,
              ads: out,
            },
            null,
            2,
          ),
        );
      },
    );
}

/** A Weaver export: the ads whole, each with its library id. */
async function keptAds(file: string): Promise<AdsAnswer> {
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  const list = Array.isArray(parsed) ? parsed : (parsed as { ads?: unknown })?.ads;
  if (!Array.isArray(list)) throw new Error(`${file}: not a JSON array of ads`);
  const ads = list.filter(
    (a): a is LibraryAd => typeof a === "object" && a !== null && typeof a.libraryId === "string",
  );
  if (ads.length < list.length)
    say(`${file}: ${list.length - ads.length} items without a libraryId skipped`);
  return { query: { file }, ads };
}

function pull(
  settings: Settings,
  o: { page?: string; q?: string; country: string; inactive?: boolean; max: number },
): Promise<AdsAnswer> {
  const sites = ingressSites(settings, "learn ads", DESK, PULL_MS);
  return sites.call<AdsAnswer>("fb-public", "GET", "/ads", {
    ...(o.page ? { page: o.page } : { q: o.q }),
    country: o.country,
    inactive: !!o.inactive,
    max: o.max,
  });
}
