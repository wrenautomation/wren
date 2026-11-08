/**
 * The Mac's readers for Learn, shared by `wren learn` and `wren sop`: the video reader (a film is
 * watched for its cuts, YouTube read from captions plus the screen, other video by Cohere, audio
 * cut by ffmpeg) and the breakdown judge per workspace.
 */
import type { Settings } from "@wren/config";
import type { Db } from "@wren/db";
import { judges, type VideoReader } from "@wren/learn";
import { type LlmClient, loadLlmEnv, makeLlm } from "@wren/llm";
import { audioSource, videoSource, youtubeSource } from "@wren/research/sops";
import type { Model } from "@wrenautomation/models";
import { s3MediaStore } from "@wrenautomation/read/s3";
import type { VideoMeta } from "@wrenautomation/read/video";
import { geminiModel, needGemini, watchEyes } from "./video-watch.js";

/** What the feed said, as yt-dlp's fields: `upload_date` is YYYYMMDD. */
export function metaOf(i: {
  text: string | null;
  creator: string | null;
  publishedAt: Date | null;
}): Partial<VideoMeta> {
  return {
    ...(i.text?.trim() ? { description: i.text.trim() } : {}),
    ...(i.creator ? { uploader: i.creator.replace(/^@/, "") } : {}),
    ...(i.publishedAt
      ? { upload_date: i.publishedAt.toISOString().slice(0, 10).replaceAll("-", "") }
      : {}),
  };
}

export function learnReaders(settings: Settings, rootDir: string) {
  /** The video reader: YouTube by captions plus the screen, other video by Cohere, audio cut by ffmpeg. */
  const reader = (): VideoReader => {
    // One key check per batch, not per video.
    let probe: Promise<Model | null> | undefined;
    const gemini = () => {
      probe ??= geminiModel(settings, rootDir);
      return probe;
    };
    const watching = async () => ({ ...watchEyes(settings, rootDir), video: await gemini() });
    // A video downloads and reads once (WA-1029, WA-1184): the media bucket's cache/, on the Mac's AWS chain.
    const store = settings.mediaBucket ? s3MediaStore(settings.mediaBucket) : undefined;
    return async ({ url, kind, title, creator, mediaUrl, text, publishedAt }) => {
      const youtube = /^https:\/\/youtube\.com\//.test(url);
      // A film is watched, never read from its captions: its cuts are the point (`filmFacts`).
      const s =
        kind === "episode" && mediaUrl
          ? await audioSource(mediaUrl, {
              url,
              title,
              creator,
              // An episode has no other reader: no working key fails it.
              model: needGemini(await gemini()),
              ffmpeg: settings.ffmpeg,
            })
          : kind === "film"
            ? await videoSource(url, settings.ytDlp, undefined, {
                ...(await watching()),
                sceneDetect: settings.sceneDetect,
                ...(store ? { store } : {}),
              })
            : youtube
              ? await youtubeSource(url, settings.ytDlp, undefined, {
                  ...(await watching()),
                  ...(store ? { store } : {}),
                })
              : await videoSource(url, settings.ytDlp, undefined, {
                  ...(await watching()),
                  ...(store ? { store } : {}),
                  // Graph's mp4 before yt-dlp, and its caption, author and date over yt-dlp's.
                  ...(mediaUrl ? { mediaUrl } : {}),
                  meta: metaOf({ text, creator, publishedAt }),
                });
      return { file: s.name, md: s.md };
    };
  };
  const scorer = (model: string): LlmClient => {
    loadLlmEnv(settings.llmEnvPath, rootDir);
    return makeLlm(model, process.env);
  };
  /** Each workspace's judge: Wren on the plain model; a client on its models allowance. */
  const judgeFor = (db: Db, model: string) => judges({ db, llm: scorer(model) });
  return { reader, scorer, judgeFor };
}
