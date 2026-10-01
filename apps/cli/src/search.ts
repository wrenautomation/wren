/**
 * `wren search …`: the site in Google and the answer engines. Keywords (seeds
 * by hand, fan-out questions by the model, queries Search Console already
 * shows), what each engine answers for them, and small edits (written by the
 * `/search-week` skill, gated here) that ship as a lander pull request a person
 * merges. `watch` runs the reading on Restate; the edits stay a person's step.
 */
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import * as clients from "@restatedev/restate-sdk-clients";
import { expandHome, loadServiceAccountKey } from "@wren/channel-email";
import {
  activeKeywords,
  addKeywords,
  applyProposals,
  ask,
  brief,
  discoverKeywords,
  dueKeywords,
  ENGINES,
  type Engine,
  fanOut,
  formatBrief,
  formatChanges,
  ProposalBatch,
  pullRequestBody,
  recordAnswer,
  retireKeyword,
  searchConsoleClient,
  searchProposals,
  sitemapUrls,
  siteText,
  storeProposals,
  syncSearch,
} from "@wren/channel-search";
import { SEARCH_KEY, type SearchWatch, type SearchWeek } from "@wren/channel-search/restate";
import { ingressOf, type Settings } from "@wren/config";
import { recordedRun } from "@wren/core";
import { DESK } from "@wren/core/content/restate";
import type { Db } from "@wren/db";
import { loadLlmEnv, makeLlm } from "@wren/llm";
import type { Command } from "commander";
import { eq, inArray } from "drizzle-orm";
import { ingressSites } from "./sites.js";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const json = (v: unknown) => console.log(JSON.stringify(v, null, 2));
const today = () => new Date().toISOString().slice(0, 10);
const idOf = (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`not an id: ${v}`);
  return n;
};

/** Runs a command in `cwd`; its output goes to the terminal; a failure throws. */
function sh(cwd: string, cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (r.status !== 0)
    throw new Error(`${cmd} ${args.join(" ")}: ${(r.stderr || r.stdout).trim().slice(-800)}`);
  return r.stdout.trim();
}

async function contentFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile() && /\.(ya?ml|md|mdx|json)$/.test(e.name)) out.push(join(e.parentPath, e.name));
  }
  return out.sort();
}

export function registerSearch(
  program: Command,
  withDb: WithDb,
  settings: Settings,
  rootDir: string,
): Command {
  const need = () => {
    if (!settings.searchSite || !settings.searchOrigin)
      throw new Error("set WREN_SEARCH_SITE (sc-domain:…) and WREN_SEARCH_ORIGIN (https://…)");
    return { site: settings.searchSite, origin: settings.searchOrigin };
  };
  const llm = () => {
    loadLlmEnv(settings.llmEnvPath, rootDir);
    return makeLlm(settings.llm, process.env, { anthropicModel: settings.llmModel });
  };
  const ingress = () => clients.connect(ingressOf(settings));
  const watch = () => ingress().objectClient<SearchWatch>({ name: "SearchWatch" }, SEARCH_KEY);

  const search = program
    .command("search")
    .description("the site in Google and the answer engines: keywords, answers, edits");

  search
    .command("sync")
    .description("Search Console now: the last days' queries, each sitemap page's index state")
    .option("--days <n>", "days to re-read", "7")
    .action(async (o: { days: string }) => {
      const { site, origin } = need();
      const console_ = searchConsoleClient(
        loadServiceAccountKey(expandHome(settings.googleServiceAccount)),
      );
      const urls = await sitemapUrls((u, i) => fetch(u, i), new URL("/sitemap.xml", origin).href);
      const { stats } = await withDb((db) =>
        recordedRun(db, { command: "search sync", argv: { site, days: Number(o.days) } }, (run) =>
          syncSearch(db, {
            console: console_,
            site,
            urls,
            today: today(),
            days: Number(o.days),
            runId: run.id,
          }),
        ),
      );
      console.log(
        `${stats.rows} rows (${stats.window}), ${stats.indexed}/${stats.inspected} pages indexed`,
      );
      for (const l of formatChanges(stats.changes)) console.log(`  ${l}`);
    });

  const kw = search.command("keywords").description("the phrases the site should be found for");
  kw.command("list", { isDefault: true }).action(async () => {
    const rows = await withDb((db) => activeKeywords(db));
    for (const k of rows)
      console.log(
        `${k.id}\t${k.source}\t${k.page ?? "-"}\t${k.phrase}${k.parentId ? `\t(from #${k.parentId})` : ""}`,
      );
  });
  kw.command("add <phrase...>")
    .description("seeds: what a buyer would type; one quoted phrase per argument")
    .option("--page <path>", "the page that should answer it, e.g. /agencies")
    .action(async (phrases: string[], o: { page?: string }) => {
      const n = await withDb((db) =>
        addKeywords(db, phrases, { source: "seed", page: o.page ?? null }),
      );
      console.log(`${n} added`);
    });
  kw.command("retire <phrase>").action(async (phrase: string) => {
    console.log(
      (await withDb((db) => retireKeyword(db, phrase))) ? "retired" : "no such active keyword",
    );
  });

  search
    .command("discover")
    .description("queries Search Console already shows the site for become keywords")
    .option("--min <n>", "least impressions over 28 days", "5")
    .action(async (o: { min: string }) => {
      const { stats } = await withDb((db) =>
        recordedRun(db, { command: "search discover", argv: o }, async (run) => ({
          added: await discoverKeywords(db, {
            today: today(),
            minImpressions: Number(o.min),
            runId: run.id,
          }),
        })),
      );
      console.log(`${stats.added} added`);
    });

  search
    .command("fanout")
    .description(
      "the model splits each new seed into the narrower questions AI engines search (paid)",
    )
    .action(async () => {
      const { origin } = need();
      const about = await siteText((u, i) => fetch(u, i), origin, []);
      const { stats } = await withDb((db) =>
        recordedRun(db, { command: "search fanout", argv: {} }, (run) =>
          fanOut(db, llm(), { about, runId: run.id }),
        ),
      );
      console.log(
        `${stats.seeds} seeds, ${stats.added} questions added${stats.failed.length ? `, failed: ${stats.failed.join("; ")}` : ""}`,
      );
    });

  search
    .command("answers")
    .description("ask Google and Perplexity (on the Mac's desk) whether they cite the site")
    .option("--engine <e>", `one of ${ENGINES.join(", ")}`)
    .option("--limit <n>", "keywords per engine", "10")
    .action(async (o: { engine?: string; limit: string }) => {
      const { origin } = need();
      const host = new URL(origin).hostname.replace(/^www\./, "");
      const desk = ingressSites(settings, DESK);
      if (o.engine && !(ENGINES as readonly string[]).includes(o.engine))
        throw new Error(`--engine: one of ${ENGINES.join(", ")}`);
      const engines = (o.engine ? [o.engine] : [...ENGINES]) as Engine[];
      await withDb(async (db) => {
        for (const engine of engines) {
          for (const k of await dueKeywords(db, engine, today(), Number(o.limit))) {
            try {
              const a = await ask(desk, engine, k.phrase, host);
              const added = await recordAnswer(db, k, engine, a, { today: today(), runId: null });
              console.log(
                `${engine}\t${a.cited ? "CITED" : "-"}\t${a.rank ?? "-"}\t${k.phrase}${added ? `\t+${added} questions` : ""}`,
              );
            } catch (err) {
              console.log(
                `${engine}\tfailed\t${k.phrase}\t${err instanceof Error ? err.message.slice(0, 160) : err}`,
              );
            }
          }
        }
      });
    });

  search
    .command("brief")
    .description("every keyword's numbers and answers, and each page's index state")
    .option("--days <n>", "window", "28")
    .action(async (o: { days: string }) => {
      const b = await withDb((db) => brief(db, { today: today(), days: Number(o.days) }));
      for (const l of formatBrief(b)) console.log(l);
    });

  search
    .command("propose <file>")
    .description(
      "gate a batch of edits (JSON) against the live site and store the ones that pass; open ones from before go stale",
    )
    .option("--dry", "gate only; store nothing")
    .action(async (file: string, o: { dry?: boolean }) => {
      const { origin } = need();
      const drafts = ProposalBatch.parse(JSON.parse(await readFile(file, "utf8")));
      const fetch_ = (u: string, i?: RequestInit) => fetch(u, i);
      const urls = await sitemapUrls(fetch_, new URL("/sitemap.xml", origin).href);
      const site = await siteText(fetch_, origin, urls);
      const { stats } = await withDb((db) =>
        recordedRun(db, { command: "search propose", argv: { file, dry: !!o.dry } }, (run) =>
          storeProposals(db, drafts, { site, today: today(), runId: run.id, dry: !!o.dry }),
        ),
      );
      console.log(
        `${stats.made} ${o.dry ? "pass" : "stored"}, ${stats.refused.length} refused${stats.staled ? `, ${stats.staled} older dropped` : ""}`,
      );
      for (const r of stats.refused)
        console.log(`  refused ${r.kind} on ${r.page} ("${r.current.slice(0, 60)}"): ${r.reason}`);
    });

  search
    .command("proposals")
    .description("open proposals")
    .option("--all", "every state")
    .action(async (o: { all?: boolean }) => {
      const rows = await withDb((db) =>
        o.all
          ? db.select().from(searchProposals).orderBy(searchProposals.id)
          : db
              .select()
              .from(searchProposals)
              .where(eq(searchProposals.state, "open"))
              .orderBy(searchProposals.id),
      );
      for (const p of rows) {
        console.log(
          `#${p.id} ${p.state} ${p.kind} on ${p.page} (${p.madeOn})${p.pr ? ` ${p.pr}` : ""}`,
        );
        console.log(`  why: ${p.why}`);
        if (p.current) console.log(`  was: ${p.current}`);
        console.log(`  now: ${p.proposed.replace(/\n/g, "\n       ")}`);
      }
    });

  search.command("drop <id...>").action(async (ids: string[]) => {
    const n = await withDb((db) =>
      db
        .update(searchProposals)
        .set({ state: "dropped" })
        .where(inArray(searchProposals.id, ids.map(idOf)))
        .returning({ id: searchProposals.id }),
    );
    console.log(`${n.length} dropped`);
  });

  search
    .command("pr")
    .description(
      "open proposals as a lander pull request: exact single matches applied, the rest listed",
    )
    .option("--lander <dir>", "the lander checkout", resolve(rootDir, "../lander"))
    .option("--dry", "print the body and the changed files; no branch")
    .action(async (o: { lander: string; dry?: boolean }) => {
      const open = await withDb((db) =>
        db
          .select()
          .from(searchProposals)
          .where(eq(searchProposals.state, "open"))
          .orderBy(searchProposals.id),
      );
      if (!open.length) return console.log("no open proposals");
      // A worktree off origin/main: the checkout's own branch and edits stay untouched.
      sh(o.lander, "git", ["fetch", "origin", "main"]);
      const branch = `search/${today()}-${open[0]?.id}`;
      const wt = await mkdtemp(join(tmpdir(), "wren-search-"));
      sh(o.lander, "git", ["worktree", "add", "-b", branch, wt, "origin/main"]);
      try {
        const dir = join(wt, "src/content");
        const sources = await Promise.all(
          (await contentFiles(dir)).map(async (path) => ({
            path,
            text: await readFile(path, "utf8"),
          })),
        );
        const a = applyProposals(sources, open);
        const body = pullRequestBody(a);
        if (o.dry) {
          console.log(body);
          for (const f of a.files) console.log(`changes ${relative(wt, f.path)}`);
          return;
        }
        for (const f of a.files) await writeFile(f.path, f.text);
        let url: string | null = null;
        if (a.files.length) {
          // The lander's own gate before anything is pushed: a broken file never reaches review.
          await symlink(join(o.lander, "node_modules"), join(wt, "node_modules"));
          sh(wt, "npm", ["run", "check"]);
          sh(wt, "git", ["add", ...a.files.map((f) => relative(wt, f.path))]);
          sh(wt, "git", [
            "commit",
            "-m",
            `Search proposals ${a.applied.map((p) => `#${p.id}`).join(" ")}`,
          ]);
          sh(wt, "git", ["push", "-u", "origin", branch]);
          url =
            sh(wt, "gh", [
              "pr",
              "create",
              "--base",
              "main",
              "--head",
              branch,
              "--title",
              `Search: ${a.applied.length} edit(s) for the keywords`,
              "--body",
              body,
            ])
              .split("\n")
              .pop() ?? null;
        }
        const taken = a.applied.map((p) => p.id);
        if (taken.length)
          await withDb((db) =>
            db
              .update(searchProposals)
              .set({ state: "taken", pr: url })
              .where(inArray(searchProposals.id, taken)),
          );
        console.log(
          url ? `${url}\n${taken.length} applied, ${a.byHand.length} by hand (in the body)` : body,
        );
      } finally {
        sh(o.lander, "git", ["worktree", "remove", "--force", wt]);
        sh(o.lander, "git", ["branch", "-D", branch]); // pushed or not, the local copy is done
        await rm(wt, { recursive: true, force: true });
      }
    });

  const w = search
    .command("watch")
    .description(
      "SearchWatch: Search Console daily, keywords and engines Mondays; off until started",
    );
  w.command("status").action(async () => json(await watch().status()));
  w.command("start").action(async () => json(await watch().start()));
  w.command("stop").action(async () => json(await watch().stop()));
  w.command("sync")
    .description("one daily pass now")
    .action(async () => json(await watch().sync()));
  w.command("week")
    .description("the weekly run now (waits on the Mac's desk)")
    .action(async () => {
      await ingress().serviceSendClient<SearchWeek>({ name: "SearchWeek" }).run({ today: today() });
      console.log("sent: SearchWeek.run");
    });

  return search;
}
