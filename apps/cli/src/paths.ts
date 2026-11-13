/**
 * `wren paths`: every product's records as one tree of home paths (designs/2026-11-12-explorer.md
 * D3). JSON out. `export` writes the home tree as folders for `rg`: each item an `index.md` and a
 * `links.json`, no symlinks, a `.stamp` at the top.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Settings } from "@wren/config";
import {
  type Adapter,
  allChildren,
  childrenAt,
  homeAt,
  homeOf,
  type Item,
  lineAt,
  mapAt,
  PathError,
  rooted,
  rootOf,
  segments,
  wholeAt,
} from "@wren/core/paths";
import type { Db } from "@wren/db";
import { cliRoots } from "@wren/paths/roots";
import type { Command } from "commander";
import { isLoopback, syncHere } from "./canon.js";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const print = (v: unknown) => console.log(JSON.stringify(v, null, 2));

interface Node extends Item {
  children?: Node[];
}

/** The tree under a route: relation folders shown, never opened; a home seen above is not opened again. */
async function treeOf(a: Adapter, route: string, depth: number): Promise<Node[]> {
  const walk = async (at: string, home: string, left: number, above: Set<string>) => {
    const rows = await allChildren(a, home);
    return Promise.all(
      rows.map(async (r): Promise<Node> => {
        const path = `${at}/${segments(r.path).at(-1) ?? ""}`;
        const node: Node = { ...r, path };
        const h = homeOf(r);
        if (left > 1 && !r.leaf && r.kind !== "relation" && !above.has(h))
          node.children = await walk(path, h, left - 1, new Set([...above, h]));
        return node;
      }),
    );
  };
  const home = await homeAt(a, route);
  return walk(segments(route).join("/"), home, depth, new Set([home]));
}

const yaml = (o: Record<string, unknown>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");

/** The home tree under a route into `dir`: each home once, aliases and relations in links.json. */
async function exportTree(
  a: Adapter,
  route: string,
  dir: string,
): Promise<{ items: number; failed: { path: string; error: string }[] }> {
  const start = await homeAt(a, route);
  const queue = [start];
  const seen = new Set<string>();
  const failed: { path: string; error: string }[] = [];
  let busy = 0;
  const one = async (home: string) => {
    const w = await a.whole(home);
    const rows = w.leaf ? [] : await allChildren(a, home);
    const at = join(dir, ...segments(home));
    await mkdir(at, { recursive: true });
    const { body, links, data: _, ...item } = w;
    await writeFile(join(at, "index.md"), `---\n${yaml({ ...item })}\n---\n\n${body ?? ""}\n`);
    const aliases = rows
      .filter((r) => r.original && r.kind !== "relation")
      .map((r) => ({
        name: r.name,
        kind: r.kind,
        home: r.original,
        ...(r.from ? { from: r.from } : {}),
      }));
    await writeFile(
      join(at, "links.json"),
      `${JSON.stringify(
        {
          path: home,
          aliases,
          links: links.map((l) => ({
            ...l,
            items: l.items.map((i) => ({
              name: i.name,
              kind: i.kind,
              home: homeOf(i),
              ...(i.mark ? { mark: i.mark } : {}),
            })),
          })),
        },
        null,
        2,
      )}\n`,
    );
    for (const r of rows) if (!r.original && r.kind !== "relation") queue.push(r.path);
  };
  // 8 at once: each item is a few small reads
  const workers = Array.from({ length: 8 }, async () => {
    for (;;) {
      const home = queue.shift();
      if (home === undefined) {
        // another worker may still add rows
        if (busy === 0) return;
        await new Promise((r) => setTimeout(r, 20));
        continue;
      }
      if (seen.has(home)) continue;
      seen.add(home);
      busy++;
      try {
        await one(home);
      } catch (e) {
        if (!(e instanceof PathError)) throw e;
        failed.push({ path: home, error: `${e.code}: ${e.message}` });
      } finally {
        busy--;
      }
    }
  });
  await Promise.all(workers);
  return { items: seen.size - failed.length, failed };
}

export function registerPaths(
  program: Command,
  withDb: WithDb,
  settings: Settings,
  rootDir: string,
): void {
  const p = program
    .command("paths")
    .description(
      "Canon, Vireo, Weaver, the business map and folders as one tree of paths: canon/topics/<t>/sets/<set>/<line>, canon/references/<id>, vireo/subjects/<slug>/batches/<batch>/<sample>, weaver/<run>/pages/<doc>, metro/lines/<line>/<group>/<station>, folders/<id>/… (Weaver reads weaver serve on this Mac)",
    );
  const run = (route: string, fn: (a: Adapter) => Promise<unknown>) =>
    withDb(async (db) => {
      // an agent's eyes: Vireo hides nothing (blind is for a person judging)
      const roots = cliRoots({ db, media: null, canonRemote: settings.canonRemote });
      try {
        if (!roots[rootOf(route)])
          throw new PathError(
            "unknown-path",
            `no root ${rootOf(route)}: ${Object.keys(roots).join(", ")}`,
          );
        // one adapter over every root: a folder's alias walks on into vireo/ or weaver/
        print(await fn(rooted(roots, rootOf(route))));
      } catch (e) {
        if (!(e instanceof PathError)) throw e;
        print({ error: e.code, message: e.message });
        process.exitCode = 1;
      }
    });

  p.command("ls [path]")
    .description("the rows under a path (an alias path too), one page; relation folders last")
    .option("--after <cursor>", "the next page: the `next` of the last one")
    .action((path = "canon", o: { after?: string }) =>
      run(path, async (a) => ({
        path,
        home: await homeAt(a, path),
        ...(await childrenAt(a, path, o.after)),
      })),
    );
  p.command("tree [path]")
    .description("the tree under a path; relation folders listed, not opened")
    .option("--depth <n>", "levels", (v) => Number.parseInt(v, 10), 2)
    .action((path = "canon", o: { depth: number }) =>
      run(path, async (a) => ({ path, tree: await treeOf(a, path, Math.max(1, o.depth)) })),
    );
  p.command("cat <path>")
    .description(
      "one item whole: its body, its links (backs, cites, used by …) and the product's data",
    )
    .action((path: string) => run(path, (a) => wholeAt(a, path)));
  p.command("find <words>")
    .description("items whose name or id holds every word")
    .option("--under <path>", "only under this path", "canon")
    .action((words: string, o: { under: string }) =>
      run(o.under, async (a) => ({ items: await a.find(words, await homeAt(a, o.under)) })),
    );
  p.command("map [root]")
    .description(
      "the Map under a fold: boxes (open ones read whole, up to 200) and the links between them, bundled per pair of boxes",
    )
    .option("--depth <n>", "levels open", (v) => Number.parseInt(v, 10), 1)
    .option("--open <paths>", "also open these, comma separated", "")
    .option("--closed <paths>", "hold these closed, comma separated", "")
    .action((root = "canon", o: { depth: number; open: string; closed: string }) =>
      run(root, async (a) => {
        const list = (s: string) => s.split(",").filter(Boolean);
        const open = Object.fromEntries([
          ...list(o.open).map((k) => [k, true] as const),
          ...list(o.closed).map((k) => [k, false] as const),
        ]);
        // the cost, split: the edges read, and the child reads the open boxes take
        const took = { reads: 0, readMs: 0, edgesMs: 0 };
        const timed = <T>(p: Promise<T>, k: "readMs" | "edgesMs") => {
          const t = performance.now();
          return p.finally(() => {
            took[k] += performance.now() - t;
          });
        };
        const edges = a.edges?.bind(a);
        const counted: typeof a = {
          ...a,
          children: (path, after) => {
            took.reads++;
            return timed(a.children(path, after), "readMs");
          },
          ...(edges
            ? {
                edges: (home: string, shown?: ReadonlySet<string>) =>
                  timed(edges(home, shown), "edgesMs"),
              }
            : {}),
        };
        const t0 = performance.now();
        const map = await mapAt(counted, { depth: Math.max(0, o.depth), open });
        const ms = (n: number) => Math.round(n);
        return {
          ms: ms(performance.now() - t0),
          edgesMs: ms(took.edgesMs),
          reads: took.reads,
          readMs: ms(took.readMs),
          ...map,
        };
      }),
    );
  p.command("line <from> <to>")
    .description(
      "a Map line's links, one page: every link from under <from> to under <to>; --open-from/--open-to for an open box (only its own links)",
    )
    .option("--open-from", "the <from> box is open")
    .option("--open-to", "the <to> box is open")
    .option("--after <cursor>", "the next page: the `next` of the last one")
    .action(
      (from: string, to: string, o: { openFrom?: boolean; openTo?: boolean; after?: string }) =>
        run(from, (a) =>
          lineAt(a, { path: from, open: !!o.openFrom }, { path: to, open: !!o.openTo }, o.after),
        ),
    );
  p.command("export <path> <dir>")
    .description(
      "the home tree under a path as folders, for rg: index.md (body) and links.json (aliases, relations) per item, .stamp at the top. Replaces an older export in <dir>",
    )
    .option("--no-sync", "skip the local Canon sync first (a loopback database only)")
    .action(async (path: string, out: string, o: { sync: boolean }) => {
      const dir = resolve(out);
      if (existsSync(dir) && (await readdir(dir)).length && !existsSync(join(dir, ".stamp")))
        throw new Error(`${dir} holds files and no .stamp: not an export; pick an empty folder`);
      if (o.sync && rootOf(path) === "canon" && isLoopback(settings.databaseUrl))
        console.error(JSON.stringify({ synced: await syncHere(settings, rootDir) }));
      const tmp = join(dirname(dir), `.${segments(dir).at(-1)}.${process.pid}`);
      await run(path, async (a) => {
        const done = await exportTree(a, path, tmp);
        const stamp = { from: path, at: new Date().toISOString(), ...((await a.stamp?.()) ?? {}) };
        await writeFile(join(tmp, ".stamp"), `${JSON.stringify(stamp, null, 2)}\n`);
        await rm(dir, { recursive: true, force: true });
        await rename(tmp, dir);
        return { dir, ...stamp, ...done };
      }).finally(() => rm(tmp, { recursive: true, force: true }));
    });
}
