/**
 * `wren sites`: every page we run (designs/2026-10-07-sites.md). Offer landers and listicles as
 * data, code pages registered by URL. Same calls as the portal's Sites app (`sitesApi`), on
 * Wren's database, as the operator at this terminal. `--client` names the page's owner.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Settings } from "@wren/config";
import type { Db } from "@wren/db";
import { loadLlmEnv, makeLlm } from "@wren/llm";
import { pageApprovalId, sitesApi } from "@wren/sites/console";
import { WREN_SITE } from "@wren/sites/model";
import { type Found, landerPages, type RepoFile, sitemapUrls, unlisted } from "@wren/sites/scan";
import { partsOf, templateOf } from "@wren/sites/templates";
import type { Command } from "commander";
import { InvalidArgumentError } from "commander";
import { sql } from "drizzle-orm";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

/** The person on every change: an operator, so the portal's checks pass as they would for one. */
const BY = process.env.CLAUDECODE ? "claude-code" : "cli";
const VIEWER = { email: BY, operator: true, team: { role: "admin", clients: null } } as never;

const print = (x: unknown) => console.log(JSON.stringify(x, null, 2));
const numberOf = (v: string) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1) throw new InvalidArgumentError("a version number");
  return n;
};

interface Row {
  id: string;
  title: string;
  url: string | null;
  kind: string;
  source: string;
  owner: string;
  status: string;
  waiting: number | null;
  offer: string | null;
  views: number | null;
  forms: number | null;
  books: number | null;
  spend: number | null;
}

export function registerSitePages(
  program: Command,
  withMainDb: WithDb,
  settings: Settings,
  rootDir: string,
  client: () => string | undefined,
) {
  const api = (db: Db, ai = false) => {
    if (!ai) return sitesApi({ db, write: null });
    if (settings.llm === "fake")
      throw new Error("a Claude draft needs a real model; WREN_LLM is fake");
    // Provider keys live in llm.env (or the host's env); never logged.
    loadLlmEnv(settings.llmEnvPath, rootDir);
    const llm = makeLlm(settings.llm, process.env, { anthropicModel: settings.llmModel });
    return sitesApi({ db, write: (p) => llm.complete(p).then((r) => r.text) });
  };
  const owner = () => client() ?? null;

  const sites = program
    .command("sites")
    .description("Pages we run: offer landers and listicles as data, code pages by URL");

  sites
    .command("list")
    .description("Every page with its status, visits, forms, bookings and ad spend")
    .option("--offer <id>", "only this offer's pages")
    .option("--status <status>", "draft, live or retired")
    .option("--all", "also videos, portal hosts and booking pages")
    .option("--json", "rows as JSON")
    .action(async (o: { offer?: string; status?: string; all?: boolean; json?: boolean }) => {
      const who = owner();
      const rows = (await withMainDb((db) =>
        db.execute(sql`
          select id, title, url, kind, source, owner, status, waiting, offer, views, forms, books, spend
          from site_page_records
          where (${o.all ?? false}::boolean or source <> 'derived')
            and (${o.offer ?? null}::text is null or offer = ${o.offer ?? null})
            and (${o.status ?? null}::text is null or status = ${o.status ?? null})
            and (${who}::text is null or owner = ${who})
          order by changed desc nulls last limit 500`),
      )) as unknown as Row[];
      if (o.json) return print(rows);
      if (!rows.length) return console.log("No pages match.");
      for (const r of rows) {
        const waiting = r.waiting ? `, v${r.waiting} waiting` : "";
        const n =
          r.source === "derived"
            ? ""
            : `  ${r.views ?? 0} visits, ${r.forms ?? 0} forms, ${r.books ?? 0} bookings, $${(r.spend ?? 0).toFixed(2)}`;
        console.log(`${r.id}  ${r.status}${waiting}  ${r.kind}/${r.source}  ${r.title}`);
        console.log(`  ${r.url ?? "(no URL yet)"}${r.offer ? `  offer ${r.offer}` : ""}${n}`);
      }
    });

  sites
    .command("show <id>")
    .description("One page: URL, status, versions, numbers by source, ads that link to it")
    .action(async (id: string) => {
      const out = await withMainDb(async (db) => {
        const [row] = (await db.execute(
          sql`select id, title, url, kind, source, owner, status, offer from site_page_records where id = ${id}`,
        )) as unknown as Row[];
        if (!row) throw new Error(`no such page: ${id}`);
        const d = await api(db).detail({ viewer: VIEWER, id });
        return {
          ...row,
          live: d.live,
          waiting: d.waiting,
          draft: d.draft?.number ?? null,
          parts:
            d.template && d.draft
              ? partsOf(templateOf(d.template.id), d.draft.content).map(
                  (p) => `${p.key} (${p.label})`,
                )
              : [],
          preview: d.preview,
          repoPath: d.repoPath,
          kit: d.kit,
          versions: d.versions,
          visits30d: d.days.reduce((n, x) => n + x.views, 0),
          forms30d: d.days.reduce((n, x) => n + x.forms, 0),
          sources: d.sources,
          ads: d.ads,
          variants: d.variants,
        };
      });
      print(out);
    });

  sites
    .command("offers")
    .description("The offers and templates a new page starts from")
    .action(async () => print(await withMainDb((db) => api(db).offers({ viewer: VIEWER }))));

  sites
    .command("new")
    .description("A new page from an offer, as a draft. Nothing goes live until a yes")
    .requiredOption("--offer <id>", "the offer it sells (see `wren sites offers`)")
    .option("--template <id>", "lander or listicle", "lander")
    .option("--angle <words>", "the angle it leads with")
    .option("--audience <words>", "who it's for")
    .option("--title <words>", "its name in the list")
    .option("--slug <slug>", "its address after /o/")
    .option("--ai", "Claude writes the first draft, checked against the facts")
    .action(
      async (o: {
        offer: string;
        template: string;
        angle?: string;
        audience?: string;
        title?: string;
        slug?: string;
        ai?: boolean;
      }) =>
        print(
          await withMainDb((db) =>
            api(db, o.ai).create({
              viewer: VIEWER,
              offer: o.offer,
              template: o.template,
              angle: o.angle ?? null,
              audience: o.audience ?? null,
              title: o.title ?? null,
              slug: o.slug ?? null,
              owner: owner(),
              ai: o.ai ?? false,
            }),
          ),
        ),
    );

  sites
    .command("save <id>")
    .description("Save copy from a JSON file of the template's fields as a new draft")
    .requiredOption("--file <path>", "content.json (- for stdin)")
    .option("--why <line>", "one line: why")
    .action(async (id: string, o: { file: string; why?: string }) => {
      const raw = o.file === "-" ? await stdin() : await readFile(o.file, "utf8");
      let content: unknown;
      try {
        content = JSON.parse(raw);
      } catch {
        throw new Error("the file isn't JSON");
      }
      print(
        await withMainDb((db) => api(db).save({ viewer: VIEWER, id, content, why: o.why ?? null })),
      );
    });

  sites
    .command("rewrite <id>")
    .description("Claude rewrites one part of the draft to an ask, checked against the facts")
    .requiredOption("--part <key>", "group:<name> or section:<id> (see `sites show`)")
    .requiredOption("--ask <line>", "what to change")
    .action(async (id: string, o: { part: string; ask: string }) =>
      print(
        await withMainDb((db) =>
          api(db, true).rewrite({ viewer: VIEWER, id, part: o.part, ask: o.ask }),
        ),
      ),
    );

  sites
    .command("ask <id>")
    .description("Ask for the draft (or a version) to go live: it waits in To approve")
    .option("--version <n>", "a version; the draft when left out", numberOf)
    .action(async (id: string, o: { version?: number }) =>
      print(
        await withMainDb((db) => api(db).ask({ viewer: VIEWER, id, number: o.version ?? null })),
      ),
    );

  sites
    .command("approve <id>")
    .description("Say yes to the version waiting: it goes live")
    .option("--version <n>", "the version waiting; read from the page when left out", numberOf)
    .action(async (id: string, o: { version?: number }) =>
      print(
        await withMainDb(async (db) => {
          const d = await api(db).detail({ viewer: VIEWER, id });
          const n = o.version ?? d.waiting;
          if (!n) throw new Error("nothing is waiting on this page; `wren sites ask` first");
          return api(db).approve({ viewer: VIEWER, ids: [pageApprovalId(id, n)] });
        }),
      ),
    );

  sites
    .command("retire <ids...>")
    .description("Take pages down: their URLs answer 410, their numbers stay")
    .action(async (ids: string[]) =>
      print(await withMainDb((db) => api(db).retire({ viewer: VIEWER, ids }))),
    );

  sites
    .command("duplicate <id>")
    .description("A variant: the page's draft copied to a new draft")
    .option("--angle <words>", "the variant's angle")
    .option("--audience <words>", "who the variant is for")
    .option("--title <words>", "its name in the list")
    .action(async (id: string, o: { angle?: string; audience?: string; title?: string }) =>
      print(
        await withMainDb((db) =>
          api(db).duplicate({
            viewer: VIEWER,
            ids: [id],
            angle: o.angle ?? null,
            audience: o.audience ?? null,
            title: o.title ?? null,
          }),
        ),
      ),
    );

  sites
    .command("add")
    .description("Register a code page by its URL (added, or updated when known)")
    .requiredOption("--url <url>", "where it's live, https")
    .option("--repo-path <path>", "where its source is: repo and path")
    .option("--offer <id>", "the offer it sells")
    .option("--title <words>", "its name in the list")
    .option("--kind <kind>", "lander, listicle, pitch, demo, booking, thank-you or portal")
    .action(
      async (o: {
        url: string;
        repoPath?: string;
        offer?: string;
        title?: string;
        kind?: string;
      }) =>
        print(
          await withMainDb((db) =>
            api(db).add({
              viewer: VIEWER,
              url: o.url,
              owner: owner(),
              ...(o.repoPath !== undefined ? { repoPath: o.repoPath } : {}),
              ...(o.offer !== undefined ? { offer: o.offer } : {}),
              ...(o.title !== undefined ? { title: o.title } : {}),
              ...(o.kind !== undefined ? { kind: o.kind } : {}),
            }),
          ),
        ),
    );

  sites
    .command("scan")
    .description(
      "Live pages not in the list: the lander repo's pages and each live host's sitemap. Read only",
    )
    .option("--lander <dir>", "the lander repo", "../lander")
    .option("--no-fetch", "skip the sitemaps: the repo only")
    .action(async (o: { lander: string; fetch: boolean }) => {
      const dir = resolve(rootDir, o.lander);
      const found = landerPages(await landerFiles(dir), `https://${WREN_SITE}`);
      const { known, hosts } = await withMainDb(async (db) => ({
        known: (await db.execute(sql`select url from site_page_records where url is not null`)).map(
          (r) => String(r.url),
        ),
        hosts: (
          await db.execute(
            sql`select hostname, client_id from client_domains where status = 'active' order by hostname`,
          )
        ).map((r) => ({ host: String(r.hostname), client: String(r.client_id) })),
      }));
      const misses: string[] = [];
      if (o.fetch)
        for (const host of [WREN_SITE, ...hosts.map((h) => h.host)]) {
          const got = await sitemapOf(host);
          if (typeof got === "string") misses.push(`${host}: ${got}`);
          else found.push(...got);
        }
      const client = new Map(hosts.map((h) => [h.host, h.client]));
      print({
        unlisted: unlisted(known, found, (h) => client.get(h)),
        ...(misses.length ? { sitemapsMissed: misses } : {}),
      });
    });

  return sites;
}

/** The lander's page sources: its content YAML and its top-level Astro pages. */
async function landerFiles(dir: string): Promise<RepoFile[]> {
  const out: RepoFile[] = [];
  const add = async (rel: string, test: RegExp) => {
    const names = await readdir(join(dir, rel)).catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return [] as string[];
      throw e;
    });
    for (const name of names.filter((n) => test.test(n)).sort())
      out.push({ path: `${rel}/${name}`, text: await readFile(join(dir, rel, name), "utf8") });
  };
  for (const c of ["hub", "pitches", "niches"]) await add(`src/content/${c}`, /\.ya?ml$/);
  await add("src/pages", /\.astro$/);
  if (out.length === 0) throw new Error(`no lander pages under ${dir}; pass --lander <dir>`);
  return out;
}

/** A host's sitemap URLs, or why it couldn't be read. A host with none has none to add. */
async function sitemapOf(host: string): Promise<Found[] | string> {
  const at = `https://${host}/sitemap.xml`;
  try {
    const res = await fetch(at, { signal: AbortSignal.timeout(10_000), redirect: "follow" });
    if (res.status === 404) return [];
    if (!res.ok) return `HTTP ${res.status}`;
    return sitemapUrls(await res.text(), at);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

async function stdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
