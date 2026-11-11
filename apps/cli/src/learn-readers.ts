/**
 * The Mac's readers for Learn, shared by `wren learn` and `wren sop`: the video reader (a film is
 * watched for its cuts, YouTube read from captions plus frames, other video by its frames and
 * speech, audio heard by the ear) and the breakdown judge per workspace.
 */
import type { Settings } from "@wren/config";
import type { Db } from "@wren/db";
import { judges, type VideoReader } from "@wren/learn";
import { type LlmClient, loadLlmEnv, makeLlm } from "@wren/llm";
import { audioSource, videoSource, youtubeSource } from "@wren/research/sops";
import { s3MediaStore } from "@wrenautomation/read/s3";
import type { VideoMeta } from "@wrenautomation/read/video";
import { watchEyes } from "./video-watch.js";

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

/** An episode has no other reader. */
function needEar<T>(ear: T | undefined): T {
  if (!ear) throw new Error("no ear: no whisper model here and no COHERE key in llm.env");
  return ear;
}

export function learnReaders(settings: Settings, rootDir: string) {
  /** The video reader: frames read by Claude, speech by the ear, one path for every kind (WA-904). */
  const reader = (): VideoReader => {
    // one eye and ear per batch: Claude on the frames, the ear on speech (WA-904)
    let eyes: ReturnType<typeof watchEyes> | undefined;
    const watching = () => {
      eyes ??= watchEyes(settings, rootDir);
      return eyes;
    };
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
              ear: needEar(watching().ear),
              ffmpeg: settings.ffmpeg,
            })
          : kind === "film"
            ? await videoSource(url, settings.ytDlp, undefined, {
                ...watching(),
                sceneDetect: settings.sceneDetect,
                ...(store ? { store } : {}),
              })
            : youtube
              ? await youtubeSource(url, settings.ytDlp, undefined, {
                  ...watching(),
                  ...(store ? { store } : {}),
                })
              : await videoSource(url, settings.ytDlp, undefined, {
                  ...watching(),
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
