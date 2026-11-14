/**
 * `wren project new|show|list|set|film` (designs/2026-11-13-studio-suite.md, D7): a video from the
 * idea on, the rows Studio's Projects page reads. JSON out.
 */

import type { Db } from "@wren/db";
import {
  linkEdit,
  listProjects,
  newProject,
  type ProjectPatch,
  setProject,
  showProject,
} from "@wren/starling-studio/projects";
import { PROJECT_KINDS, type ProjectInspiration } from "@wren/starling-studio/schema";
import type { Command } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const out = (v: unknown) => console.log(JSON.stringify(v, null, 2));
const idOf = (v: string, what = "project") => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`not a ${what} id: ${v}`);
  return n;
};

/** `post:<creator_posts id>` or `canon:<record id>`, `=why` after it. */
export function inspirationOf(v: string): ProjectInspiration {
  const m = /^(post|canon):([^=]+)(?:=(.+))?$/.exec(v.trim());
  if (!m) throw new Error(`--from takes post:<id> or canon:<id>, optional =why: ${v}`);
  return {
    kind: m[1] as "post" | "canon",
    ref: (m[2] as string).trim(),
    ...(m[3] ? { why: m[3].trim() } : {}),
  };
}
const collect = (v: string, prev: string[] = []) => [...prev, v];

export function registerProject(program: Command, withDb: WithDb, actor: string): void {
  const project = program
    .command("project")
    .description("video projects: Studio's spine from the idea to the edit (JSON out)");

  project
    .command("new <title>")
    .description("a new project")
    .option("--kind <k>", PROJECT_KINDS.join(", "), "long")
    .option("--brief <text>", "what it is and why")
    .option("--from <ref>", "post:<id> or canon:<id>[=why], repeatable", collect)
    .option("--by <who>", "an agent's session id", actor)
    .action((title: string, o: { kind: string; brief?: string; from?: string[]; by: string }) =>
      withDb(async (db) =>
        out(
          await newProject(
            db,
            {
              title,
              kind: o.kind as (typeof PROJECT_KINDS)[number],
              brief: o.brief ?? "",
              inspiration: (o.from ?? []).map(inspirationOf),
            },
            o.by,
          ),
        ),
      ),
    );

  project
    .command("list")
    .description("projects, newest change first")
    .action(() => withDb(async (db) => out(await listProjects(db))));

  project
    .command("show <id>")
    .description("one project, with its edit once filmed")
    .action((v: string) => withDb(async (db) => out(await showProject(db, idOf(v)))));

  project
    .command("set <id>")
    .description("change title, kind, brief or inspiration (--from replaces the list)")
    .option("--title <t>")
    .option("--kind <k>", PROJECT_KINDS.join(", "))
    .option("--brief <text>")
    .option("--from <ref>", "post:<id> or canon:<id>[=why], repeatable", collect)
    .option("--subject <kind=id>", "a Vireo subject per part kind (hook=12), repeatable", collect)
    .option("--folder <id>", "the Vireo folder its subjects sit in")
    .action(
      (
        v: string,
        o: {
          title?: string;
          kind?: string;
          brief?: string;
          from?: string[];
          subject?: string[];
          folder?: string;
        },
      ) =>
        withDb(async (db) => {
          const id = idOf(v);
          const patch: ProjectPatch = {};
          if (o.title !== undefined) patch.title = o.title;
          if (o.kind !== undefined) patch.kind = o.kind as (typeof PROJECT_KINDS)[number];
          if (o.brief !== undefined) patch.brief = o.brief;
          if (o.from) patch.inspiration = o.from.map(inspirationOf);
          if (o.folder !== undefined) patch.folder = idOf(o.folder, "folder");
          if (o.subject) {
            const now = (await showProject(db, id)).subjects;
            const add = Object.fromEntries(
              o.subject.map((s) => {
                const [k, n] = s.split("=");
                if (!k || !n) throw new Error(`--subject takes kind=id: ${s}`);
                return [k, idOf(n, "subject")];
              }),
            );
            patch.subjects = { ...now, ...add };
          }
          out(await setProject(db, id, patch));
        }),
    );

  project
    .command("film <id> <video>")
    .description("the project's edit: a `wren video` id, once it is filmed")
    .action((v: string, e: string) =>
      withDb(async (db) => out(await linkEdit(db, idOf(v), idOf(e, "video")))),
    );
}
