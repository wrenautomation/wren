/**
 * The hunt's YouTube search (WA-1029): the Data API, exact counts, no home IP. 100 units a
 * search on YOUTUBE_API_KEY, whose 10k a day birdwatch shares. yt-dlp only with no key or the
 * day's quota spent.
 */
import { cleanUrl, type Find, type TopicSearch, youtubeSearch } from "@wren/learn";
import { QuotaSpent, type YoutubeApi, youtubeApi } from "@wrenautomation/birdwatch/sources";

type Hit = Awaited<ReturnType<YoutubeApi["search"]>>[number];

export const findOf = (h: Hit): Find => ({
  url: cleanUrl(h.url),
  title: h.title?.trim() || h.url,
  creator: h.channel ?? null,
  views: h.metrics?.views ?? null,
  publishedAt: h.date ? new Date(`${h.date}T00:00:00Z`) : null,
  duration: h.length ?? null,
});

export function huntSearch(o: {
  key: string | undefined;
  ytDlp: string;
  say: (line: string) => void;
  fetch?: typeof fetch;
}): TopicSearch {
  const scrape = youtubeSearch(o.ytDlp);
  if (!o.key) {
    o.say("youtube: no YOUTUBE_API_KEY in llm.env, so yt-dlp searches");
    return scrape;
  }
  const api = youtubeApi({ key: o.key, ...(o.fetch ? { fetch: o.fetch } : {}) });
  let spent = false;
  return async (query, n) => {
    if (!spent)
      try {
        return (await api.search(query, n)).map(findOf);
      } catch (e) {
        if (!(e instanceof QuotaSpent)) throw e;
        spent = true;
        o.say(`youtube: ${e.message}; yt-dlp for the rest of this hunt`);
      }
    return scrape(query, n);
  };
}
