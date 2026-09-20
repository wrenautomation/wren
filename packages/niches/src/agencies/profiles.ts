/**
 * The one sanctioned fetching path in the agencies niche: Shopify partner profile
 * pages for exactly the slugs a human already found in the hand-saved listing pages.
 * robots.txt allows the clean `/partners/directory/partner/<slug>` URLs; the fetch is
 * a one-shot, jittered, identified crawl (the fetcher's UA carries contact info). The
 * machine never discovers pages, only visits the ones a human already found.
 *
 * Fetched files cache on disk; a response that doesn't look like a profile is deleted
 * and the run stops loudly rather than caching a challenge page as data. The operator
 * decides whether to resume or fall back to manual clicks; the fetcher never escalates.
 */
import { readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Dataset, DownloadResult, PoliteFetcher, RemoteFile } from "@wren/research/fetch";
import { FetchError } from "@wren/research/fetch";
import {
  listingSlugs,
  looksLikeProfile,
  PROFILE_DATASET_NAME,
  profileUrl,
} from "./shopify-pages.js";

const HUMAN_PAUSE_S: readonly [number, number] = [3, 8];
const LONG_PAUSE_S: readonly [number, number] = [12, 25];
const LONG_PAUSE_CHANCE = 0.05;
const uniform = ([lo, hi]: readonly [number, number]) => lo + Math.random() * (hi - lo);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Every hand-saved listing page under `<listingRoot>/<category>/*.html`. */
function listingPages(listingRoot: string): string[] {
  const pages: string[] = [];
  for (const entry of readdirSync(listingRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const name of readdirSync(join(listingRoot, entry.name))) {
      if (name.toLowerCase().endsWith(".html")) pages.push(join(listingRoot, entry.name, name));
    }
  }
  return pages.sort();
}

/**
 * The profile dataset over one listing root (`data/agencies/shopify`). `limit` is
 * ignored on purpose: profile discovery is all-or-nothing, and already-fetched files
 * are skipped at download time, so re-runs only pull what is missing.
 */
export function shopifyProfileDataset(listingRoot: string): Dataset {
  return {
    name: PROFILE_DATASET_NAME,
    description: `Shopify partner profile pages for slugs found under ${listingRoot} (jittered one-shot crawl; robots-allowed paths only)`,
    listFiles: async () =>
      listingSlugs(listingPages(listingRoot)).map((slug) => ({
        dataset: PROFILE_DATASET_NAME,
        fileName: `${slug}.html`,
        url: profileUrl(slug),
        period: "",
      })),
    download: downloadProfile,
  };
}

export async function downloadProfile(
  fetcher: PoliteFetcher,
  remote: RemoteFile,
  dest: string,
  pause: (ms: number) => Promise<void> = sleep,
): Promise<DownloadResult> {
  const existing = (() => {
    try {
      return statSync(dest);
    } catch {
      return null;
    }
  })();
  // Skip BEFORE the pause: a resumed run flies through its cached prefix.
  if (existing) return { path: dest, downloaded: false, size: existing.size };
  let delay = uniform(HUMAN_PAUSE_S);
  if (Math.random() < LONG_PAUSE_CHANCE) delay += uniform(LONG_PAUSE_S); // an occasional human-length pause
  await pause(delay * 1000);
  const result = await fetcher.download(remote.url, dest);
  const text = readFileSync(dest, "utf8");
  // Positive profile markers, not path echoes: a 200-OK bot challenge commonly echoes
  // the requested URL. Never cache a page without profile content.
  if (!looksLikeProfile(text)) {
    unlinkSync(dest);
    throw new FetchError(`${remote.url}: response is not a partner profile — stopping the run`);
  }
  return result;
}
