/**
 * `wren [--client <id>] notes …`: Notes from the terminal (designs/2026-10-07-notes.md, Agents).
 * Reads see every note, as the CLI does every table, unless `--as <email>` reads as that person.
 * `add` and `append` write as `agent:claude` (or `--agent <name>`), and an added note is shared
 * with the workspace so its people see what the agent wrote. Words come from the arguments, or
 * from stdin when there are none. `export` writes a note as Word or Markdown.
 */
import { writeFile } from "node:fs/promises";
import { listOperators, normalEmail } from "@wren/core/clients";
import type { Db } from "@wren/db";
import {
  AGENT,
  appendNote,
  createNote,
  fromMarkdown,
  isNoteId,
  type ListView,
  listNotes,
  type NoteJson,
  nameOf,
  noteById,
  type Reader,
  roleOn,
  toMarkdown,
  versionsOf,
} from "@wren/notes";
import { type Command, InvalidArgumentError } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const VIEWS: readonly ListView[] = ["recent", "mine", "shared", "starred", "archived", "all"];
const WREN = "wren";

async function wordsOf(parts: readonly string[]): Promise<string> {
  if (parts.length) return parts.join(" ");
  if (process.stdin.isTTY) throw new Error("say what to write, or pipe it in");
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const agentOf = (name: string | undefined) => {
  const n = (name ?? "claude").trim().toLowerCase();
  if (!/^[a-z0-9][\w.-]{0,40}$/.test(n))
    throw new InvalidArgumentError("an agent's name: letters, digits, . _ -");
  return `${AGENT}${n}`;
};

const limitOf = (v: string) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1 || n > 500) throw new InvalidArgumentError("1 to 500");
  return n;
};

const day = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");

export function registerNotes(
  program: Command,
  dbs: { withDb: WithDb; withMainDb: WithDb; client: () => string | undefined },
): void {
  const { withDb, withMainDb } = dbs;
  const cmd = program
    .command("notes")
    .description(
      "Notes: list, search, read, export, add and append (agents write as agent:<name>)",
    );

  /** The reader `--as` names, or every note when there's none. */
  const readerOf = async (as: string | undefined): Promise<Omit<Reader, "cap"> | null> => {
    if (!as) return null;
    const email = normalEmail(as);
    const team = (await withMainDb(listOperators)).includes(email);
    const client = dbs.client() ?? null;
    return { email, team, inWorkspace: client ? true : team, client };
  };
  const NOBODY: Omit<Reader, "cap"> = { email: "", team: false, inWorkspace: false, client: null };

  const list = async (
    view: ListView,
    q: string | null,
    o: { as?: string; limit?: number; json?: boolean },
  ) => {
    const r = await readerOf(o.as);
    const rows = await withDb((db) =>
      listNotes(db, r ?? NOBODY, {
        view: r ? view : "all",
        q,
        limit: o.limit ?? 50,
        everything: !r,
      }),
    );
    if (o.json) return console.log(JSON.stringify(rows, null, 2));
    if (!rows.length) return console.log(q ? `no note has "${q}"` : "no notes");
    for (const n of rows) {
      const tags = [
        n.kind === "dump" ? "dump" : "",
        n.archivedAt ? "archived" : "",
        n.general === "workspace" ? "shared" : "private",
      ]
        .filter(Boolean)
        .join(", ");
      console.log(
        `${n.id}  ${day(n.updatedAt)}  ${nameOf(n.title, n.text)}  (${n.owner}; ${tags})`,
      );
      if (q) console.log(`    ${n.excerpt.replace(/\s+/g, " ").trim()}`);
    }
  };

  cmd
    .command("ls")
    .description("Notes, newest first")
    .option("--view <view>", `${VIEWS.join(" | ")} (with --as)`, "recent")
    .option("--as <email>", "read as this person: only the notes they can open")
    .option("--limit <n>", "at most this many (default 50)", limitOf)
    .option("--json", "rows as JSON")
    .action(async (o: { view: string; as?: string; limit?: number; json?: boolean }) => {
      if (!VIEWS.includes(o.view as ListView))
        throw new Error(`--view is one of ${VIEWS.join(", ")}`);
      await list(o.view as ListView, null, o);
    });

  cmd
    .command("search")
    .description("Full-text search over titles and words; best match first")
    .argument("<words...>")
    .option("--as <email>", "read as this person")
    .option("--limit <n>", "at most this many (default 50)", limitOf)
    .option("--json", "rows as JSON")
    .action(async (words: string[], o: { as?: string; limit?: number; json?: boolean }) => {
      await list("all", words.join(" "), o);
    });

  cmd
    .command("show")
    .description("A note as Markdown, then its versions")
    .argument("<id>")
    .option("--as <email>", "read as this person; refused when they can't open it")
    .option("--json", "the note's fields and body as JSON")
    .action(async (id: string, o: { as?: string; json?: boolean }) => {
      if (!isNoteId(id)) throw new Error(`not a note id: ${id}`);
      const r = await readerOf(o.as);
      const out = await withDb(async (db) => {
        const note = await noteById(db, id);
        if (!note || (r && !(await roleOn(db, note, r)))) return null;
        return { note, versions: await versionsOf(db, id) };
      });
      if (!out) throw new Error(r ? `no such note for ${r.email}` : "no such note");
      const { note, versions } = out;
      if (o.json) {
        const { yState: _y, ...rest } = note;
        return console.log(JSON.stringify({ ...rest, versions }, null, 2));
      }
      console.log(`# ${nameOf(note.title, note.text)}\n`);
      console.log(toMarkdown(note.body as never).trim());
      console.log(`\n---\n${note.owner}, ${note.general}${note.archivedAt ? ", archived" : ""}`);
      for (const v of versions)
        console.log(
          `v${v.number}  ${day(v.at)}  ${v.authors.join(", ")}${v.name ? `  "${v.name}"` : ""}${v.kind === "auto" ? "" : `  (${v.kind})`}`,
        );
    });

  cmd
    .command("export")
    .description("A note as a Word (.docx) or Markdown file; images stay as their alt text")
    .argument("<id>")
    .argument("<file>", "where to write it: name.docx or name.md")
    .option("--as <email>", "read as this person; refused when they can't open it")
    .action(async (id: string, file: string, o: { as?: string }) => {
      if (!isNoteId(id)) throw new Error(`not a note id: ${id}`);
      const kind = /\.docx$/i.test(file) ? "docx" : /\.(md|markdown)$/i.test(file) ? "md" : null;
      if (!kind) throw new Error("the file ends in .docx or .md");
      const r = await readerOf(o.as);
      const note = await withDb(async (db) => {
        const n = await noteById(db, id);
        return n && (!r || (await roleOn(db, n, r))) ? n : null;
      });
      if (!note) throw new Error(r ? `no such note for ${r.email}` : "no such note");
      const title = nameOf(note.title, note.text);
      const body = note.body as NoteJson;
      if (kind === "docx") {
        const { toDocx } = await import("@wren/notes/docx");
        await writeFile(file, await toDocx(body, { title }));
      } else await writeFile(file, `# ${title}\n\n${toMarkdown(body)}`);
      console.log(file);
    });

  cmd
    .command("add")
    .description("A new note from Markdown, shared with the workspace; prints its id")
    .argument("[words...]", "Markdown; stdin when left out")
    .option("--title <title>", "its title (else the first line names it)")
    .option("--agent <name>", "write as agent:<name> (default claude)")
    .option("--private", "only the agent can open it; share it in the portal")
    .action(async (parts: string[], o: { title?: string; agent?: string; private?: boolean }) => {
      const by = agentOf(o.agent);
      const md = (await wordsOf(parts)).trim();
      if (!md) throw new Error("nothing to write");
      const note = await withDb((db) =>
        createNote(db, {
          owner: by,
          by,
          via: "agent",
          body: fromMarkdown(md),
          ...(o.title ? { title: o.title.trim().slice(0, 300) } : {}),
          general: o.private ? "private" : "workspace",
          generalRole: "edit",
        }),
      );
      console.log(note.id);
      process.stderr.write(`/notes/doc/${note.id} in ${dbs.client() ?? WREN}\n`);
    });

  cmd
    .command("append")
    .description("Add Markdown at the end of a note, as a new edit in its history")
    .argument("<id>")
    .argument("[words...]", "Markdown; stdin when left out")
    .option("--agent <name>", "write as agent:<name> (default claude)")
    .action(async (id: string, parts: string[], o: { agent?: string }) => {
      if (!isNoteId(id)) throw new Error(`not a note id: ${id}`);
      const by = agentOf(o.agent);
      const md = (await wordsOf(parts)).trim();
      if (!md) throw new Error("nothing to write");
      const c = await withDb(async (db) => {
        if (!(await noteById(db, id))) throw new Error("no such note");
        return appendNote(db, id, by, fromMarkdown(md));
      });
      console.log(`appended; v${c.version}`);
    });
}
