/**
 * Bulk-dataset vocabulary for the fetch command. A Dataset is a strategy: `listFiles`
 * reads whatever catalog the publisher exposes and returns the newest N files. The
 * implementations are niche-specific (an SEC FOIA catalog, a directory's profile
 * pages) and live in their niche package; this module only defines the shapes the
 * command iterates, so a new niche's datasets plug in through the registry without
 * touching research.
 */
import { join } from "node:path";
import type { DownloadResult, PoliteFetcher } from "./fetcher.js";

export interface RemoteFile {
  dataset: string;
  fileName: string;
  url: string;
  /** ISO-sortable: "2026-07" or "2026-09-02". */
  period: string;
}

export interface Dataset {
  name: string;
  description: string;
  listFiles: (fetcher: PoliteFetcher, limit: number) => Promise<RemoteFile[]>;
  /**
   * How bytes reach disk when a plain GET isn't enough (validation, human-length
   * pauses). Absent = the fetcher's own download: skip-if-present, .part then rename.
   */
  download?: (fetcher: PoliteFetcher, remote: RemoteFile, dest: string) => Promise<DownloadResult>;
}

export interface FetchedFile extends DownloadResult {
  remote: RemoteFile;
}

/**
 * Pull a dataset's newest files under `<destRoot>/<dataset>/`. Files already on disk
 * are skipped, so a run interrupted mid-way resumes by being run again; `onFile` sees
 * each one as it lands.
 */
export async function fetchDataset(
  fetcher: PoliteFetcher,
  dataset: Dataset,
  opts: { limit: number; destRoot: string; onFile?: (file: FetchedFile) => void },
): Promise<FetchedFile[]> {
  const files = await dataset.listFiles(fetcher, opts.limit);
  const download = dataset.download ?? ((f, remote, dest) => f.download(remote.url, dest));
  const fetched: FetchedFile[] = [];
  for (const remote of files) {
    const dest = join(opts.destRoot, dataset.name, remote.fileName);
    const result = await download(fetcher, remote, dest);
    const file = { ...result, remote };
    opts.onFile?.(file);
    fetched.push(file);
  }
  return fetched;
}
