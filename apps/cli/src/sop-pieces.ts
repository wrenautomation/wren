/**
 * `wren sop breakdown | call | ads`: pieces in Canon (designs/2026-11-09-knowledge-repo.md, WA-1317).
 * A breakdown goes on the source's `breakdown` field; a call is a `verdict` from `owner` citing the
 * source; a competitor ad is one source per ad (designs/2026-11-11-competitor-ads.md), pulled from
 * the Meta Ad Library on the desk (signed out, $0) or taken from a Weaver export, read here (the
 * media links expire) and broken down.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Settings } from "@wren/config";
import {
  type AdsAnswer,
  adCopy,
  adFacts,
  adImages,
  adImagesPage,
  adImagesPrompt,
  adImagesSchema,
  adPage,
  adTitle,
  adUrl,
  adVideos,
  type Breakdown,
  type BrokenDown,
  breakdownPiece,
  FACT_CALLS,
  factRows,
  ITEM_PATH,
  isBrokenDown,
  isFactCall,
  isWinner,
  type LibraryAd,
  WINNER_TAGS,
} from "@wren/content-standard";
import { DESK } from "@wren/core/autobrowse/restate";
import { type LlmClient, loadLlmEnv, makeLlm } from "@wren/llm";
import { type Loaded, loadWorking, write } from "@wrenautomation/knowledge";
import type { Model } from "@wrenautomation/models";
import { s3MediaStore } from "@wrenautomation/read/s3";
import { type MediaStore, renderWatched, watchFile } from "@wrenautomation/read/video";
import type { Command } from "commander";
import { ingressSites } from "./sites.js";
import { watchEyes } from "./video-watch.js";

const say = (line: string) => console.error(line);
/** Images read per ad; a carousel past this is its first ones. */
const MAX_IMAGES = 10;
/** A pull of 600 ads is 20 library pages on the desk. */
const PULL_MS = 20 * 60_000;

/** A source's kind to its rubric; an ad page is an `ad`. */
const RUBRIC: Record<string, BrokenDown> = {
  reel: "reel",
  video: "video",
  page: "post",
  post: "post",
};

type Fm = Record<string, unknown>;
const docOf = (root: string, id: string): Loaded => {
  const d = loadWorking(root).docs.find((l) => l.doc.fm.id === id);
  if (!d) throw new Error(`no record ${id} in Canon`);
  return d;
};
const section = (body: string, head: string) =>
  body.match(new RegExp(`## ${head}\\n\\n([\\s\\S]*?)(?=\\n## |$)`))?.[1]?.trim() ?? "";

/** The breakdown model: `llm.env`'s keys, the plain model. */
export function breakdownLlm(settings: Settings, rootDir: string, model: string): LlmClient {
  loadLlmEnv(settings.llmEnvPath, rootDir);
  return makeLlm(model, process.env);
}

/** Break a source down and write it on the record; null when it can't be (no rubric, no facts). */
export async function breakdownSource(
  root: string,
  id: string,
  llm: LlmClient,
  o: { kind?: BrokenDown; by: string; why: string },
): Promise<Breakdown | null> {
  const { doc } = docOf(root, id);
  const fm = doc.fm as Fm;
  const prior = (fm.breakdown as Fm | undefined)?.kind;
  const kind =
    o.kind ??
    (fm.ad
      ? "ad"
      : typeof prior === "string" && isBrokenDown(prior)
        ? prior
        : RUBRIC[String(fm.kind)]);
  if (!kind) throw new Error(`${id}: kind ${String(fm.kind)} has no rubric; pass --kind`);
  const b = await breakdownPiece(llm, {
    kind,
    title: String(fm.title ?? id),
    url: String(fm.url ?? ""),
    text: section(doc.body, "Caption") || section(doc.body, "Copy") || doc.body,
    transcript: doc.body,
  });
  if (!b) return null;
  await write(root, [{ op: "edit", id, breakdown: b }], { by: o.by, why: o.why });
  return b;
}

export function registerSopPieces(
  sop: Command,
  d: { root: string; settings: Settings; rootDir: string; by: string },
): void {
  const { root, settings, rootDir, by } = d;

  sop
    .command("breakdown <source...>")
    .description(
      "break a source down (hook, beats, call to action, its kind's facts) onto its record; again on one with a breakdown replaces it",
    )
    .option("--kind <kind>", "reel | video | post | film | ad (default: from the source)")
    .option("--model <name>", "the breakdown model", "cohere")
    .action(async (ids: string[], o: { kind?: string; model: string }) => {
      if (o.kind && !isBrokenDown(o.kind)) throw new Error(`--kind: reel, video, post, film or ad`);
      const llm = breakdownLlm(settings, rootDir, o.model);
      for (const id of ids) {
        const b = await breakdownSource(root, id, llm, {
          ...(o.kind ? { kind: o.kind as BrokenDown } : {}),
          by,
          why: `sop breakdown ${id}`,
        });
        console.log(
          b ? `${id}: ${b.kind}, ${b.hookStyle}, ${b.beats.length} beats` : `${id}: no breakdown`,
        );
      }
    });

  sop
    .command("call <source> <path> <call>")
    .description(
      `his call on a piece: ${FACT_CALLS.join(" | ")} on the whole piece (/) or one fact (hook_style, beats/2, facts/format); a verdict from owner citing the source. Paths: run with path ?`,
    )
    .option("--comment <words>", "his words, as he said them")
    .option("--from <person>", "who called it", "william")
    .action(
      async (source: string, path: string, call: string, o: { comment?: string; from: string }) => {
        const { doc } = docOf(root, source);
        const b = (doc.fm as Fm).breakdown as Breakdown | undefined;
        const rows = b ? factRows(b) : [];
        if (path === "?") {
          console.log(`${ITEM_PATH}  Whole piece`);
          for (const r of rows) console.log(`${r.path}  ${r.label}: ${r.value}`);
          return;
        }
        if (!isFactCall(call)) throw new Error(`call: ${FACT_CALLS.join(", ")}`);
        if (path !== ITEM_PATH && !rows.some((r) => r.path === path))
          throw new Error(`${source}: no fact at ${path} (paths: run with path ?)`);
        const word = { keep: "kept", tune: "tuned", drop: "dropped" }[call];
        const what = path === ITEM_PATH ? "the whole piece" : path;
        const out = await write(
          root,
          [
            {
              op: "add",
              type: "verdict",
              title: `${o.from} ${word} ${source}${path === ITEM_PATH ? "" : ` ${path}`}`,
              from: "owner",
              call,
              path,
              at: new Date().toISOString(),
              cites: [source],
              provider: { kind: "human", who: o.from },
              ...(o.comment ? { comment: o.comment } : {}),
              body: `${o.from} ${word} ${what}.${o.comment ? ` "${o.comment}"` : ""}`,
            },
          ],
          { by, why: `sop call ${source} ${path} ${call}` },
        );
        console.log(JSON.stringify(out));
      },
    );

  sop
    .command("ads")
    .description(
      "competitor ads from the Meta Ad Library (desk, signed out): an advertiser's (--page), a keyword's (--q) or a Weaver run's kept ads (--ads); one Canon source per ad, read here and broken down",
    )
    .option("--page <page>", "advertiser: page id, page URL or username")
    .option("--ads <file>", "a Weaver run's kept ads (`weaver export <run> --source ads`)")
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
    .option("--sop <name>", "tag each ad with this SOP")
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
        sop?: string;
      }) => {
        if ([o.page, o.q, o.ads].filter(Boolean).length !== 1)
          throw new Error("give one of --page, --q or --ads");
        const answer = o.ads ? await keptAds(o.ads) : await pull(settings, o);
        if (answer.found === false) throw new Error(`no Ad Library page for ${o.page}`);
        const { eye, ear } = watchEyes(settings, rootDir);
        const store = settings.mediaBucket ? s3MediaStore(settings.mediaBucket) : undefined;
        const media = {
          eye,
          ...(ear ? { ear } : {}),
          ffmpeg: settings.ffmpeg,
          ...(store ? { store } : {}),
        };
        const llm = breakdownLlm(settings, rootDir, o.model);
        const who = { by, why: `sop ads ${o.ads ?? o.page ?? o.q}` };
        const rows = [];
        for (const ad of answer.ads) {
          const id = `facebook-ad-${ad.libraryId}`;
          const prev = loadWorking(root).docs.find((l) => l.doc.fm.id === id);
          const winner = isWinner(ad);
          const tags = [...(winner ? WINNER_TAGS : []), ...(o.sop ? [o.sop] : [])];
          const video = adVideos(ad)[0];
          const fields = {
            title: adTitle(ad),
            kind: video ? "video" : "page",
            url: adUrl(ad.libraryId),
            ...(ad.advertiser?.name ? { handle: ad.advertiser.name } : {}),
            ...(ad.started ? { date: ad.started } : {}),
            ...((video?.poster ?? adImages(ad)[0])
              ? { image: video?.poster ?? adImages(ad)[0] }
              : {}),
            ...(answer.pageId ? { pageId: answer.pageId } : {}),
            ad,
          };
          const read = !/## Ad\n/.test(prev?.doc.body ?? "");
          let body =
            prev?.doc.body ?? `# ${fields.title}\n\n## Copy\n\n${adCopy(ad) || "(no copy)"}\n`;
          let status = "kept";
          if (read && o.read) {
            try {
              const m = await readMedia(ad, media);
              body = `# ${fields.title}\n\n${adPage(ad, adFacts(ad, m), m.md)}`;
              status = "read";
            } catch (err) {
              status = err instanceof Error ? err.message : String(err);
            }
          }
          await write(
            root,
            [
              prev
                ? {
                    op: "edit",
                    id,
                    ...fields,
                    tags: [...new Set([...prev.doc.fm.tags, ...tags])].sort(),
                    body,
                  }
                : {
                    op: "add",
                    type: "source",
                    id,
                    tags,
                    provider: { kind: "agent", who: o.ads ? "weaver" : by },
                    ...fields,
                    body,
                  },
            ],
            who,
          );
          const broken =
            status === "read" && !!(await breakdownSource(root, id, llm, { kind: "ad", ...who }));
          say(`${id}${winner ? " winner" : ""} ${status}${broken ? " broken down" : ""}`);
          rows.push({ id, libraryId: ad.libraryId, fresh: !prev, winner, read: status, broken });
        }
        console.log(
          JSON.stringify(
            {
              query: answer.query,
              pageId: answer.pageId ?? null,
              total: answer.total ?? null,
              pulled: answer.ads.length,
              winners: rows.filter((r) => r.winner).length,
              ads: rows,
            },
            null,
            2,
          ),
        );
      },
    );
}

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
): Promise<{ md: string; speech: boolean | null; cuts: number | null }> {
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
      return { md: renderWatched(w), speech: !!w.speech.trim(), cuts: w.cuts.length };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  const urls = adImages(ad).slice(0, MAX_IMAGES);
  if (!urls.length) return { md: "", speech: null, cuts: null };
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
  return { md: adImagesPage(a.value), speech: null, cuts: null };
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
  const sites = ingressSites(settings, "sop ads", DESK, PULL_MS);
  return sites.call<AdsAnswer>("fb-public", "GET", "/ads", {
    ...(o.page ? { page: o.page } : { q: o.q }),
    country: o.country,
    inactive: !!o.inactive,
    max: o.max,
  });
}
