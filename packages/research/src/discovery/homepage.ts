/**
 * The default HomepageFetcher: the domain's homepage as text, trying https, then
 * www, then http. robots.txt is honored per host: the ownership gate fetches pages
 * exactly like the crawler does and owes the same etiquette.
 */
import { FetchError, type Fetcher } from "../fetch/fetcher.js";
import { readPage } from "../fetch/htmltext.js";
import { canFetch, type RobotsCache } from "../fetch/robots.js";
import type { HomepageFetcher } from "./service.js";

export function politeHomepageFetcher(fetcher: Fetcher): HomepageFetcher {
  return async (domain) => {
    const robots: RobotsCache = new Map();
    for (const url of [`https://${domain}`, `https://www.${domain}`, `http://${domain}`]) {
      if (!(await canFetch(fetcher, url, robots))) continue;
      let resp: Awaited<ReturnType<Fetcher["get"]>>;
      try {
        resp = await fetcher.get(url);
      } catch (err) {
        if (err instanceof FetchError) continue;
        throw err;
      }
      if (resp.status >= 400) continue;
      const content = readPage(resp.text, resp.url);
      return { url: resp.url, title: content.title, text: content.text };
    }
    return null;
  };
}
