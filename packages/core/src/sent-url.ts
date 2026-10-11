/**
 * Where a sent thing can be seen: the reply's own permalink when the platform gives one, else
 * the place it went (the post, the thread, the person's profile). Every `sent` step carries it,
 * so Inbox → Done links straight to it (designs/2026-10-11-done.md).
 */
export function whereSent(
  platform: string,
  place: string | null,
  ref: string | null,
): string | null {
  if (!ref) return place;
  switch (platform) {
    case "youtube":
      // A comment or reply opens highlighted at `lc`.
      return place ? withParam(place, "lc", ref) : null;
    case "reddit": {
      // `t1_<id>` or a bare id, under its thread: /comments/<post>/comment/<id>/.
      const post = place?.match(/^(https:\/\/(?:www\.)?reddit\.com\/r\/[^/]+\/comments\/[^/]+)/);
      return post ? `${post[1]}/comment/${ref.replace(/^t1_/, "")}/` : place;
    }
    case "x":
      return /^\d+$/.test(ref) ? `https://x.com/i/status/${ref}` : place;
    default:
      return place;
  }
}

function withParam(url: string, key: string, value: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set(key, value);
    return u.toString();
  } catch {
    return url;
  }
}
