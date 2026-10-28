/**
 * A post's own player address from its link: YouTube's id, and the embeds the CSP lets in
 * (`public/_headers` frame-src). Learn's item page and Research's sources both read it.
 */

/** The YouTube id in a watch, short, Shorts or embed address. */
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m|music)\./, "");
    if (host === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;
    const v = u.searchParams.get("v");
    if (v) return v;
    const m = /^\/(?:shorts|embed|live|v)\/([\w-]{6,})/.exec(u.pathname);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

/** An Instagram, TikTok or X post's own embed address, or null when the link isn't one. */
export function embedOf(type: string, url: string): { src: string; box: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (type === "instagram") {
    const m = /^\/(?:[\w.]+\/)?(p|reels?|tv)\/([\w-]+)/.exec(u.pathname);
    if (!m) return null;
    const kind = m[1] === "p" ? "p" : "reel";
    return {
      src: `https://www.instagram.com/${kind}/${m[2]}/embed`,
      box: "h-[720px] max-w-[400px]",
    };
  }
  if (type === "tiktok") {
    const m = /\/video\/(\d+)/.exec(u.pathname);
    if (!m) return null;
    return { src: `https://www.tiktok.com/embed/v2/${m[1]}`, box: "h-[740px] max-w-[340px]" };
  }
  if (type === "x") {
    const m = /\/status(?:es)?\/(\d+)/.exec(u.pathname);
    if (!m) return null;
    return {
      src: `https://platform.twitter.com/embed/Tweet.html?id=${m[1]}&dnt=true`,
      box: "h-[620px] max-w-[550px]",
    };
  }
  return null;
}

/** The embed site a link is on, if any. */
export function embedSite(url: string): "instagram" | "tiktok" | "x" | null {
  try {
    const host = new URL(url).hostname.replace(/^(www|m|mobile)\./, "");
    if (host === "instagram.com") return "instagram";
    if (host === "tiktok.com") return "tiktok";
    if (host === "x.com" || host === "twitter.com") return "x";
  } catch {}
  return null;
}
