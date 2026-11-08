/**
 * `wren folders`: the one folder tree for chats, Vireo subjects and Weaver runs
 * (designs/2026-11-08-folders.md). JSON out. The agents run it as `folders <command>`.
 */
import type { Db } from "@wren/db";
import { type Folder, FolderError, folderTree, ITEM_KINDS, type ItemKind } from "@wren/folders";
import type { Command } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const print = (v: unknown) => console.log(JSON.stringify(v, null, 2));

/** "Plumbers / Openers" for each folder. */
const pathsOf = (list: Folder[]) => {
  const by = new Map(list.map((f) => [f.id, f]));
  const path = (f: Folder): string => {
    const up = f.parent == null ? undefined : by.get(f.parent);
    return up ? `${path(up)} / ${f.name}` : f.name;
  };
  return new Map(list.map((f) => [f.id, path(f)]));
};

/** A folder by id or by path ("Plumbers/Openers"), case-insensitive. */
const pick = (list: Folder[], arg: string): number => {
  if (/^\d+$/.test(arg) && list.some((f) => f.id === Number(arg))) return Number(arg);
  const want = arg
    .split("/")
    .map((s) => s.trim().toLowerCase())
    .join(" / ");
  const hit = [...pathsOf(list)].find(([, p]) => p.toLowerCase() === want);
  if (!hit) throw new FolderError(`no folder “${arg}”; see \`folders tree\``, 404);
  return hit[0];
};

export function registerFolders(program: Command, withDb: WithDb, by: string): void {
  const f = program
    .command("folders")
    .description("One folder tree for chats, Vireo subjects and Weaver runs");
  const run = (fn: (t: ReturnType<typeof folderTree>) => Promise<unknown>) =>
    withDb(async (db) => {
      try {
        print(await fn(folderTree(db)));
      } catch (err) {
        if (!(err instanceof FolderError)) throw err;
        print({ error: err.message });
        process.exitCode = 1;
      }
    });
  const list = async (t: ReturnType<typeof folderTree>) => (await t.tree()).folders;

  f.command("tree")
    .description("Every folder with its path, and what is filed where")
    .option("--kind <kind>", `only items of one kind: ${ITEM_KINDS.join(", ")}`)
    .action((o: { kind?: ItemKind }) =>
      run(async (t) => {
        const tree = await t.tree(o.kind);
        const paths = pathsOf(tree.folders);
        return {
          folders: tree.folders.map((x) => ({ ...x, path: paths.get(x.id) })),
          filed: tree.filed,
        };
      }),
    );
  f.command("new <name>")
    .description("Make a folder")
    .option("--in <folder>", "inside this folder (id or path)")
    .action((name: string, o: { in?: string }) =>
      run(async (t) => t.make({ name, parent: o.in ? pick(await list(t), o.in) : null, by })),
    );
  f.command("rename <folder> <name>").action((folder: string, name: string) =>
    run(async (t) => t.rename(pick(await list(t), folder), name, by)),
  );
  f.command("move <folder>")
    .description("Put a folder inside another, or at the top")
    .requiredOption("--to <folder>", "a folder (id or path), or `top`")
    .action((folder: string, o: { to: string }) =>
      run(async (t) => {
        const all = await list(t);
        return t.move(pick(all, folder), o.to === "top" ? null : pick(all, o.to), by);
      }),
    );
  f.command("drop <folder>")
    .description("Remove a folder; what it holds goes up one level (unfiled at the top)")
    .action((folder: string) => run(async (t) => t.drop(pick(await list(t), folder), by)));
  f.command("file <kind> <refs...>")
    .description(`File items into a folder. Kinds: ${ITEM_KINDS.join(", ")}`)
    .option("--to <folder>", "the folder (id or path)")
    .option("--out", "unfile them")
    .action((kind: string, refs: string[], o: { to?: string; out?: boolean }) =>
      run(async (t) => {
        if (!o.to === !o.out) throw new FolderError("give --to <folder> or --out");
        const folder = o.to ? pick(await list(t), o.to) : null;
        return t.file({ kind, refs, folder, by });
      }),
    );
}
