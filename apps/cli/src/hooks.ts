/**
 * `wren [--client <id>] hooks …`: the door's webhooks (designs/2026-10-05-workflows.md). A hook
 * enters a workflow at one of its inputs, Wren's or the client's; its URL is shown once. The rows
 * live on main, since the door finds the client from the token.
 */
import { getClient } from "@wren/core/clients";
import { fieldMapOf, HOOK_PRESETS, LEAD_FIELDS } from "@wren/core/door";
import { hooks } from "@wren/core/schema";
import { addHook } from "@wren/core/spine";
import type { Db } from "@wren/db";
import type { Command } from "commander";
import { desc } from "drizzle-orm";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;
const DOOR = "https://phone.wrenautomation.com/hooks/";

export function registerHooks(program: Command, withMainDb: WithDb) {
  const client = () => program.opts<{ client?: string }>().client ?? null;
  const cmd = program.command("hooks").description("webhooks into a workflow's input (the door)");

  const make = async (h: Omit<Parameters<typeof addHook>[1], "client">) => {
    const token = await withMainDb(async (db) => {
      const id = client();
      if (id) await getClient(db, id);
      return addHook(db, { ...h, client: id });
    });
    console.log(`${DOOR}${token}`);
    return token;
  };

  cmd
    .command("add <workflow> <input>")
    .description("Make a hook into the workflow's input; prints its URL once")
    .requiredOption("--subject <field>", "the payload field that says who it is about (data.email)")
    .option("--name <words>", "what sends it")
    .option(
      "--field <fact=path>",
      `where a lead fact sits (${LEAD_FIELDS.join(", ")}), like phone=contact.tel; repeat it`,
      (v: string, all: string[]) => [...all, v],
      [] as string[],
    )
    .action(
      async (
        workflow: string,
        input: string,
        o: { subject: string; name?: string; field: string[] },
      ) => {
        await make({
          name: o.name ?? `${workflow} ${input}`,
          workflow,
          input,
          subject: o.subject,
          fields: fieldMapOf(o.field),
        });
        console.log(
          "Shown once. POST JSON or a form to it; an unknown workflow or input answers 410.",
        );
      },
    );

  cmd
    .command("preset <name>")
    .description(
      `Make a known sender's hook (${Object.keys(HOOK_PRESETS).join(", ")}); prints its URL once and where it goes`,
    )
    .action(async (name: string) => {
      const p = HOOK_PRESETS[name];
      if (!p) throw new Error(`no preset ${name} (${Object.keys(HOOK_PRESETS).join(", ")})`);
      await make({
        name,
        workflow: p.workflow,
        input: p.input,
        subject: p.subject,
        fields: p.fields,
      });
      console.log(`Shown once. It goes in ${p.goes}.`);
    });

  cmd
    .command("list")
    .description("Every hook: what it enters, how often it was called")
    .action(async () => {
      const rows = await withMainDb((db) => db.select().from(hooks).orderBy(desc(hooks.createdAt)));
      for (const h of rows)
        console.log(
          `${h.name}: ${h.client ?? "wren"} ${h.workflow} in.${h.input}, about ${h.subject}; ` +
            (Object.keys(h.fields).length ? `fields ${JSON.stringify(h.fields)}; ` : "") +
            `${h.calls} calls, last ${h.lastAt?.toISOString() ?? "never"}`,
        );
      if (!rows.length) console.log("no hooks");
    });
}
