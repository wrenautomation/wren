/**
 * `wren [--client <id>] templates …`: every channel's copy and every prompt in one store
 * (designs/2026-10-06-edits-claude-templates.md, 3). `import` moves the copy that lived
 * elsewhere (the `.email` files, `sms_templates`, `reach_templates`) in as versions, live
 * where nothing is; it never sends and never overrides a publish.
 */
import { readFileSync } from "node:fs";
import { importLegacyTexts } from "@wren/channel-sms";
import { templates, templateVersions } from "@wren/core/schema";
import { TEMPLATE_KINDS, type TemplateKind } from "@wren/core/slots";
import { publish, saveDraft } from "@wren/core/templates";
import type { Db } from "@wren/db";
import { importEmailFiles, NICHES } from "@wren/niches";
import { importLegacyDms } from "@wren/outreach";
import type { Command } from "commander";
import { and, asc, eq, sql } from "drizzle-orm";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

export function registerTemplates(program: Command, withDb: WithDb) {
  const cmd = program
    .command("templates")
    .description("every channel's copy and every prompt: versions, live and draft");

  cmd
    .command("import")
    .description("Move the .email files and the old text and DM tables in; again changes nothing")
    .action(async () => {
      const out = await withDb(async (db) => ({
        email: await importEmailFiles(db, NICHES),
        sms: await importLegacyTexts(db),
        dm: await importLegacyDms(db),
      }));
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
