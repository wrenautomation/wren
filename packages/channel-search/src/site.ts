/**
 * The site as the model reads it: each page's title and description (what a
 * search result shows), then `/llms.txt` (the words, from the same content
 * files as the pages). Read live, so a proposal quotes what is up now.
 */
import type { FetchLike } from "@wren/channel-email";

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

export async function siteText(
  fetch: FetchLike,
  origin: string,
  urls: readonly string[],
): Promise<string> {
  const heads: string[] = [];
  for (const url of urls) {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) continue;
    const html = await res.text();
    const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? "";
    const description = /<meta name="description" content="([^"]*)"/i.exec(html)?.[1] ?? "";
    heads.push(
      `Page ${new URL(url).pathname}\ntitle: ${decode(title)}\ndescription: ${decode(description)}`,
    );
  }
  const llms = await fetch(new URL("/llms.txt", origin).href, { method: "GET" });
  return [...heads, "", llms.ok ? await llms.text() : ""].join("\n\n");
}
