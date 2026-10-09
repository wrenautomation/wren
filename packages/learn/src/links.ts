/**
 * Links as Learn keeps them: one address per thing, whoever shared it. A share from the phone
 * carries tracking params (igsh, si, utm_*) and short hosts (youtu.be); its feed entry doesn't.
 * Both clean to the same url, so they're one item.
 */
import type { ItemKind, ItemType, SourceKind } from "./schema.js";

const TRACKING = /^(utm_[a-z]+|igsh|igshid|si|fbclid|gclid|mc_[a-z]+|ref_src|_r|_t)$/i;
/** X and TikTok add their own on every share. */
const SHARE_PARAMS = /^(s|t|is_from_webapp|sender_device|web_id)$/i;
const SHARE_HOST = /(^|\.)(x\.com|twitter\.com|tiktok\.com)$/i;

const YOUTUBE_HOST = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i;

/** The YouTube video id in a watch, short, embed or youtu.be address; null when there's none. */
export function youtubeId(url: URL): string | null {
  if (!YOUTUBE_HOST.test(url.hostname)) return null;
  if (/youtu\.be$/i.test(url.hostname)) return url.pathname.slice(1).split("/")[0] || null;
  const v = url.searchParams.get("v");
  if (v) return v;
  const m = /^\/(shorts|embed|live|v)\/([\w-]{6,})/.exec(url.pathname);
  return m?.[2] ?? null;
}

/** A link as Learn keeps it; throws on anything but http(s). */
export function cleanUrl(raw: string): string {
  const url = new URL(raw.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("not a web address");
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^(www\.|m\.|mobile\.)/, "");
  const yt = youtubeId(url);
  if (yt) {
    // Shorts stay shorts: a reel, read as one.
    const short = url.pathname.startsWith("/shorts/");
    return short ? `https://youtube.com/shorts/${yt}` : `https://youtube.com/watch?v=${yt}`;
  }
  const share = SHARE_HOST.test(url.hostname);
  for (const k of [...url.searchParams.keys()])
    if (TRACKING.test(k) || (share && SHARE_PARAMS.test(k))) url.searchParams.delete(k);
  url.protocol = "https:";
  const out = url.toString();
  return out.endsWith("/") && url.pathname !== "/" ? out.slice(0, -1) : out;
}

const REEL_HOST = /(^|\.)(instagram\.com|tiktok\.com|x\.com|twitter\.com|threads\.net)$/i;

/** What an address is: a YouTube video, a short video elsewhere, or text. An audio enclosure is an episode. */
export function kindOf(clean: string, audio?: string | null): ItemKind {
  if (audio) return "episode";
  const url = new URL(clean);
  if (youtubeId(url)) return url.pathname.startsWith("/shorts/") ? "reel" : "video";
  if (REEL_HOST.test(url.hostname)) {
    if (/instagram\.com$/i.test(url.hostname))
      return /^\/(reel|reels|p|tv)\//.test(url.pathname) ? "reel" : "article";
    if (/tiktok\.com$/i.test(url.hostname))
      return /\/video\/|^\/t\//.test(url.pathname) || /^vm\./.test(url.hostname)
        ? "reel"
        : "article";
    // An X or Threads post may be text only; the reader tells, so it's read as a reel.
    return /\/status\/|\/post\//.test(url.pathname) ? "reel" : "article";
  }
  return "article";
}

/**
 * Whether the Mac's reader reads it: video needs yt-dlp, a home IP and the Gemini keys (the worker
 * tries YouTube first), and an episode's audio needs ffmpeg. An episode with no audio file is read
 * from its show notes.
 */
export const needsMac = (kind: ItemKind, media?: string | null): boolean =>
  kind === "video" || kind === "reel" || (kind === "episode" && !!media);

/** A profile on a site whose creators can't be followed yet: public reads only, in development. */
export function creatorSite(raw: string): string | null {
  const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  if (/(^|\.)instagram\.com$/.test(host)) return "Instagram";
  if (/(^|\.)tiktok\.com$/.test(host)) return "TikTok";
  if (/(^|\.)(x|twitter)\.com$/.test(host)) return "X";
  if (/(^|\.)threads\.net$/.test(host)) return "Threads";
  return null;
}

const NEWSLETTER_HOST = /(^|\.)(substack\.com|beehiiv\.com|buttondown\.(email|com))$/i;

/**
 * How an item is consumed, from its address, its kind and its source's kind. A saved link with
 * nothing else to go on is a link.
 */
export function typeOf(clean: string, kind: ItemKind, sourceKind?: SourceKind | null): ItemType {
  const url = new URL(clean);
  const host = url.hostname;
  if (youtubeId(url)) return url.pathname.startsWith("/shorts/") ? "shorts" : "youtube";
  if (/(^|\.)instagram\.com$/i.test(host)) return "instagram";
  if (/(^|\.)tiktok\.com$/i.test(host)) return "tiktok";
  if (/(^|\.)(x\.com|twitter\.com)$/i.test(host)) return "x";
  if (/(^|\.)reddit\.com$/i.test(host) || sourceKind === "reddit") return "reddit";
  if (kind === "episode" || sourceKind === "podcast") return "podcast";
  if (sourceKind === "newsletter" || NEWSLETTER_HOST.test(host)) return "newsletter";
  if (sourceKind === "releases") return "releases";
  if (sourceKind === "youtube") return "youtube";
  if (sourceKind === "blog" || sourceKind === "forum") return "blog";
  return "link";
}

/** A YouTube video's thumbnail, from its address; null for anything else. */
export function youtubeThumb(clean: string): string | null {
  const id = youtubeId(new URL(clean));
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}
