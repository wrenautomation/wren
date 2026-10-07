/**
 * `wren [--client <id>] templates …`: every channel's copy and every prompt in one store
 * (designs/2026-10-07-templates-live-copy.md). Wren's built-in copy is the defaults tree
 * (`packages/templates/defaults`): `sync` writes each changed file into every database, `install`
 * gives a client the templates its parts need.
 */
import { readFileSync } from "node:fs";
import { getClient } from "@wren/core/clients";
import { templates, templateVersions } from "@wren/core/schema";
import { TEMPLATE_KINDS, type TemplateKind } from "@wren/core/slots";
import { publish, saveDraft } from "@wren/core/templates";
import { installDefaults, loadDefaults, syncDefaults } from "@wren/core/templates/defaults";
import { clientDatabases, type Db } from "@wren/db";
import { COMPONENTS } from "@wren/worker/components";
import type { Command } from "commander";
import { and, asc, eq, sql } from "drizzle-orm";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

export interface TemplateDbs {
  /** The command's database: `--client`'s, else main. */
  withDb: WithDb;
  withMainDb: WithDb;
  /** A client database by name, as main's login (sync runs on deploy). */
  onDatabase: <T>(database: string, fn: (db: Db) => Promise<T>) => Promise<T>;
  /** `--client`, when given. */
  client: () => string | undefined;
}

export function registerTemplates(program: Command, dbs: TemplateDbs) {
  const { withDb, withMainDb, onDatabase } = dbs;
  const cmd = program
    .command("templates")
    .description("every channel's copy and every prompt: versions, live and draft");

  cmd
    .command("sync")
    .description(
      "Each changed default file as a default version: main takes every file, each client the templates it has. Runs on deploy; again changes nothing",
    )
    .action(async () => {
      const files = loadDefaults();
      const out: Record<string, unknown> = {
        main: await withMainDb((db) => syncDefaults(db, { only: "all", files })),
      };
      for (const database of await withMainDb(clientDatabases))
        out[database] = await onDatabase(database, (db) =>
          syncDefaults(db, { only: "present", files }),
        );
      console.log(JSON.stringify(out, null, 2));
    });

  cmd
    .command("install")
    .description("Give --client the templates its parts need, following the defaults")
    .action(async () => {
      const id = dbs.client();
      if (!id) throw new Error("install needs --client <id>");
      const client = await withMainDb((db) => getClient(db, id));
      const patterns = COMPONENTS.filter((c) => c.id in client.products).flatMap(
        (c) => c.provides.templates,
      );
      const out = await withDb((db) => installDefaults(db, patterns, { by: "cli" }));
      console.log(JSON.stringify(out, null, 2));
    });

  cmd
    .command("list")
    .description("Each template: kind, whose, name, its live and draft versions")
    .option("--kind <kind>", `only one kind (${TEMPLATE_KINDS.join(", ")})`)
    .action(async (o: { kind?: string }) => {
      if (o.kind && !(TEMPLATE_KINDS as readonly string[]).includes(o.kind))
        throw new Error(`no template kind ${o.kind}`);
      const rows = await withDb((db) =>
        db
          .select({
            kind: templates.kind,
            system: templates.system,
            name: templates.name,
            live: sql<
              string | null
            >`(select version from template_versions where id = ${templates.liveVersionId})`,
            draft: sql<
              string | null
            >`(select version from template_versions where id = ${templates.draftVersionId})`,
            versions: sql<number>`(select count(*)::int from template_versions v where v.template_id = ${templates.id})`,
          })
          .from(templates)
          .where(o.kind ? eq(templates.kind, o.kind as TemplateKind) : undefined)
          .orderBy(asc(templates.kind), asc(templates.system), asc(templates.name)),
      );
      for (const r of rows)
        console.log(
          `${r.kind} ${r.system}/${r.name}: live ${r.live ?? "none"}` +
            `${r.draft ? `, draft ${r.draft}` : ""}, ${r.versions} versions`,
        );
      if (!rows.length) console.log("no templates");
    });

  // Texts and DMs save through their desks, which hold each slot's rules (STOP, length).
  const EDITABLE = ["email", "prompt"];
  const refOf = (kind: string, system: string, name: string) => {
    if (!EDITABLE.includes(kind))
      throw new Error(
        `templates save takes ${EDITABLE.join(" or ")}; texts and DMs: wren sms|reach`,
      );
    return { kind: kind as TemplateKind, system, name };
  };

  cmd
    .command("save <kind> <system> <name> <file>")
    .description("Keep a file's words as the draft (email or prompt); nothing sends until publish")
    .action(async (kind: string, system: string, name: string, file: string) => {
      const ref = refOf(kind, system, name);
      const words = readFileSync(file === "-" ? 0 : file, "utf8");
      const state = await withDb((db) => saveDraft(db, ref, words, { by: "cli" }));
      console.log(JSON.stringify(state, null, 2));
    });

  cmd
    .command("publish <kind> <system> <name>")
    .description("Make the draft live; the next compose or ask reads it, publishing sends nothing")
    .action(async (kind: string, system: string, name: string) => {
      const ref = refOf(kind, system, name);
      const state = await withDb((db) => publish(db, ref, { by: "cli" }));
      console.log(JSON.stringify(state, null, 2));
    });

  cmd
    .command("show <kind> <system> <name>")
    .description("One template's versions, newest first, and the words of each")
    .action(async (kind: string, system: string, name: string) => {
      const rows = await withDb((db) =>
        db
          .select({
            version: templateVersions.version,
            source: templateVersions.source,
            by: templateVersions.createdBy,
            at: templateVersions.createdAt,
            published: templateVersions.publishedAt,
            live: sql<boolean>`${templates.liveVersionId} = ${templateVersions.id}`,
          })
          .from(templateVersions)
          .innerJoin(templates, eq(templates.id, templateVersions.templateId))
          .where(
            and(
              eq(templates.kind, kind as TemplateKind),
              eq(templates.system, system),
              eq(templates.name, name),
            ),
          )
          .orderBy(sql`${templateVersions.id} desc`),
      );
      if (!rows.length) throw new Error(`no template ${kind} ${system}/${name}`);
      for (const r of rows)
        console.log(
          `--- ${r.version}${r.live ? " (live)" : ""} by ${r.by ?? "?"} at ${r.at.toISOString()}\n${r.source}\n`,
        );
    });
}
