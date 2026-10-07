/**
 * `wren sites scan`: pages that are live but not in the list. Two places to look: the lander
 * repo's pages (its content YAML and static Astro pages) and the sitemaps of the hosts we serve
 * (wrenautomation.com and each client's live host). Read only: it prints the `wren sites add`
 * line for each, and adds nothing.
 *
 * Pure, so tests need no disk and no network: the CLI reads the files and fetches the sitemaps.
 */
import { cleanUrl } from "./store.js";

/** A page found somewhere, with what its source says about it. */
export interface Found {
  url: string;
  /** Where it was found: a repo path or a sitemap's URL. */
  from: string;
  title?: string;
  offer?: string;
  kind?: string;
  /** Where its source is, for `--repo-path`. */
  repoPath?: string;
}

export interface Unlisted extends Found {
  /** The line that adds it. */
  add: string;
}

/** A file in the lander repo, by its path from the repo root. */
export interface RepoFile {
  path: string;
  text: string;
}

/** A top-level `key: value` line of a YAML file. Enough for `path`, `offer` and `title`. */
function top(text: string, key: string): string | undefined {
  const m = new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, "m").exec(text);
  if (!m?.[1]) return undefined;
  const v = m[1].replace(/^(["'])(.*)\1$/, "$2").trim();
  return v && !v.startsWith("|") && !v.startsWith(">") ? v : undefined;
}

/** Static pages with no page of their own to list: errors, and routes that need an id. */
const SKIP = new Set(["404", "v", "[niche]", "[...slug]"]);
const KIND: Record<string, string> = { hub: "lander", pitches: "pitch", niches: "lander" };

/** The lander's pages from its repo: hub and pitch pages by `path:`, niches by file name, static pages by route. */
export function landerPages(files: RepoFile[], origin: string, repo = "lander"): Found[] {
  const out: Found[] = [];
  for (const f of files) {
    const content = /^src\/content\/(hub|pitches|niches)\/([a-z0-9-]+)\.ya?ml$/.exec(f.path);
    if (content) {
      const [, dir = "", name = ""] = content;
      const path = dir === "niches" ? `/${name}` : top(f.text, "path");
      if (!path?.startsWith("/")) continue;
      const title = top(f.text, "title");
      const offer = top(f.text, "offer");
      out.push({
        url: new URL(path, origin).href,
        from: `${repo}/${f.path}`,
        kind: KIND[dir] ?? "lander",
        repoPath: `${repo}/${f.path}`,
        ...(title ? { title } : {}),
        ...(offer ? { offer } : {}),
      });
      continue;
    }
    const page = /^src\/pages\/([a-z0-9[\].-]+)\.astro$/.exec(f.path);
    if (!page?.[1] || SKIP.has(page[1])) continue;
    const route = page[1] === "index" ? "/" : `/${page[1]}`;
    out.push({
      url: new URL(route, origin).href,
      from: `${repo}/${f.path}`,
      repoPath: `${repo}/${f.path}`,
      ...(page[1] === "schedule" ? { kind: "booking" } : {}),
    });
  }
  return out;
}

/** Every `<loc>` in a sitemap. Anything else (an app's HTML, an error page) has none. */
export function sitemapUrls(xml: string, from: string): Found[] {
  const out: Found[] = [];
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    const url = m[1]?.replace(/&amp;/g, "&");
    if (url) out.push({ url, from });
  }
  return out;
}

/** A URL as the list keeps it, or null when it can't be one (not https, not a link). */
function keyOf(url: string): string | null {
  try {
    return cleanUrl(url);
  } catch {
    return null;
  }
}

const quote = (s: string) => (/^[\w./:@-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`);

/** The `wren sites add` line for a page, with what its source said. */
export function addLine(f: Found, client?: string): string {
  const parts = ["wren"];
  if (client) parts.push("--client", quote(client));
  parts.push("sites", "add", "--url", quote(f.url));
  if (f.title) parts.push("--title", quote(f.title));
  if (f.offer) parts.push("--offer", quote(f.offer));
  if (f.kind) parts.push("--kind", f.kind);
  if (f.repoPath) parts.push("--repo-path", quote(f.repoPath));
  return parts.join(" ");
}

/**
 * Found pages not in the list, once each, in the order found. A page found twice (the repo and
 * the sitemap) keeps the first, fullest record. `clientOf` names a host's client for its line.
 */
export function unlisted(
  known: Iterable<string | null>,
  found: Found[],
  clientOf: (host: string) => string | undefined = () => undefined,
): Unlisted[] {
  const have = new Set<string>();
  for (const u of known) {
    const k = u ? keyOf(u) : null;
    if (k) have.add(k);
  }
  const out: Unlisted[] = [];
  for (const f of found) {
    const k = keyOf(f.url);
    if (!k || have.has(k)) continue;
    have.add(k);
    out.push({ ...f, url: k, add: addLine({ ...f, url: k }, clientOf(new URL(k).host)) });
  }
  return out;
}
