/**
 * `wren fetch`: pull a niche's bulk files from their publisher into
 * `<data>/<niche>/bulk/<dataset>/`, newest first, skipping what is already on disk.
 * Import them afterwards with `wren email import` / `import-people`.
 */
import { resolve } from "node:path";
import type { Settings } from "@wren/config";
import { datasetsFor } from "@wren/niches";
import { fetchDataset, PoliteFetcher, userAgent } from "@wren/research/fetch";
import type { Command } from "commander";

export function registerFetch(program: Command, settings: Settings): void {
  const fetch = program
    .command("fetch")
    .description("bulk files from publishers (SEC catalogs, directory profiles)");

  fetch
    .command("list")
    .description("The datasets each niche knows how to pull")
    .option("--data <dir>", "data directory", "data")
    .action((opts: { data: string }) => {
      for (const { niche, dataset } of datasetsFor(resolve(opts.data)).values())
        console.log(`  ${dataset.name.padEnd(26)} ${niche.padEnd(9)} ${dataset.description}`);
    });

  fetch
    .command("get <dataset>")
    .description("Download the newest files of one dataset")
    .option("--months <n>", "how many newest files (monthly datasets)", "1")
    .option("--data <dir>", "data directory", "data")
    .action(async (name: string, opts: { months: string; data: string }) => {
      const dataDir = resolve(opts.data);
      const found = datasetsFor(dataDir).get(name);
      if (!found) throw new Error(`unknown dataset ${name}; see \`wren fetch list\``);
      if (!settings.fetchContact)
        throw new Error(
          "WREN_FETCH_CONTACT is unset: every fetch identifies itself with a contact",
        );
      // Regulator catalogs and directories alike get a slow, identified, jittered client.
      const fetcher = new PoliteFetcher(userAgent(settings.fetchContact), {
        minInterval: 2,
        jitter: [0.5, 2],
        timeout: 120,
      });
      const files = await fetchDataset(fetcher, found.dataset, {
        limit: Number(opts.months),
        destRoot: resolve(dataDir, found.niche, "bulk"),
        onFile: (f) =>
          console.log(`${f.downloaded ? "fetched" : "cached "} ${f.path} (${f.size} bytes)`),
      });
      console.log(`${files.length} file(s); ${files.filter((f) => f.downloaded).length} new`);
    });
}
