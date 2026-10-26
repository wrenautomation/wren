/**
 * The Mac's readers for Learn, shared by `wren learn` and `wren sop hunt`: the video reader (a film
 * is watched for its cuts, YouTube read from captions plus the screen, other video by Cohere, audio
 * cut by ffmpeg), the scoring judge per workspace, and the creator pager (Instagram through the
 * desk, TikTok by yt-dlp here).
 */
import type { Settings } from "@wren/config";
import { contentPlaybooks } from "@wren/content/schema";
import type { Db } from "@wren/db";
import {
  type CatalogReader,
  type CreatorPage,
  instagramPage,
  judges,
  type Practice,
  practiceOf,
  tiktokPage,
  type VideoReader,
} from "@wren/learn";
import { fleetKeys, type LlmClient, loadLlmEnv, makeLlm } from "@wren/llm";
import { audioSource, videoSource, youtubeSource } from "@wren/research/sops";
import { desc } from "drizzle-orm";
import { ingressSites } from "./sites.js";
import { watchKeys } from "./video-watch.js";

/** A desk page read waits this long: a Graph discovery read takes seconds, the desk's queue minutes. */
const PAGE_MS = 120_000;

/** Each pushed SOP's newest text: what an item is scored against. */
export async function practicesOf(db: Db): Promise<Practice[]> {
  const rows = await db
    .selectDistinctOn([contentPlaybooks.sop], {
      sop: contentPlaybooks.sop,
      text: contentPlaybooks.text,
    })
    .from(contentPlaybooks)
    .orderBy(contentPlaybooks.sop, desc(contentPlaybooks.createdAt));
  return rows.map((r) => practiceOf(r.sop, r.text));
}

export function learnReaders(settings: Settings, rootDir: string) {
  /** The video reader: YouTube by captions plus the screen, other video by Cohere, audio cut by ffmpeg. */
  const reader = (): VideoReader => {
    // Gemini keys come from llm.env; never logged.
    loadLlmEnv(settings.llmEnvPath, rootDir);
    const geminiKeys = fleetKeys(process.env, "gemini");
    return async ({ url, kind, title, creator, mediaUrl }) => {
      const youtube = /^https:\/\/youtube\.com\//.test(url);
      // A film is watched, never read from its captions: its cuts are the point (`filmFacts`).
      const s =
        kind === "episode" && mediaUrl
          ? await audioSource(mediaUrl, {
              url,
              title,
              creator,
              geminiKeys,
              ffmpeg: settings.ffmpeg,
            })
          : kind === "film"
            ? await videoSource(url, settings.ytDlp, undefined, {
                ...watchKeys(settings, rootDir),
                sceneDetect: settings.sceneDetect,
              })
            : youtube
              ? await youtubeSource(url, settings.ytDlp, undefined, {
                  geminiKeys,
                })
              : await videoSource(url, settings.ytDlp, undefined, watchKeys(settings, rootDir));
      return { file: s.name, md: s.md };
    };
  };
  const scorer = (model: string): LlmClient => {
    loadLlmEnv(settings.llmEnvPath, rootDir);
    return makeLlm(model, process.env);
  };
  /** Each workspace's judge: Wren's pushed SOPs; a client's own, on its models allowance. */
  const judgeFor = (db: Db, model: string) =>
    judges({ db, llm: scorer(model), wrenPractices: () => practicesOf(db) });
  /** Instagram profiles page through the desk (Graph discovery), TikTok's by yt-dlp here. */
  const catalogReader = (): CatalogReader => {
    const sites = ingressSites(settings, "wren:learn", undefined, PAGE_MS);
    const paged = (kind: string, handle: string, page: Promise<CreatorPage>) =>
      page.catch((err: unknown) => {
        if (err instanceof Error && err.name === "TimeoutError")
          throw new Error(`${kind} @${handle}: no answer in ${PAGE_MS / 1000}s (is the desk up?)`);
        throw err;
      });
    return (kind, handle, page) =>
      kind === "instagram"
        ? paged(kind, handle, instagramPage(sites, handle, page))
        : kind === "tiktok"
          ? tiktokPage(settings.ytDlp, handle, page)
          : null;
  };
  return { reader, scorer, judgeFor, catalogReader };
}
