/**
 * `wren --client <id> workflows …`: templates onto a client (designs/2026-10-07-template-install.md).
 * Plan first, then install: parts, copy, a draft and a shut door, nothing started. Publish asks in
 * To approve; the CLI never approves. Uninstall stops the loops and keeps the data.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import { ingressOf, type Settings } from "@wren/config";
import { type Client, getClient } from "@wren/core/clients";
import {
  askTemplate,
  copyLabel,
  INSTALL_STATE_LABELS,
  installsOf,
  installTemplate,
  type Plan,
  readPlan,
  templateNamed,
  templatesOf,
  uninstallTemplate,
} from "@wren/core/templates/install";
import type { Db } from "@wren/db";
import { COMPONENTS } from "@wren/worker/components";
import { SETUPS } from "@wren/worker/setups";
import { WORKFLOWS } from "@wren/worker/workflows";
import type { Command } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;
type WithClientDb = <T>(fn: (db: Db, client: Client) => Promise<T>) => Promise<T>;
const DOOR = "https://phone.wrenautomation.com/hooks/";
const BY = "cli";

const PART: Record<string, string> = {
  add: "adds",
  back: "puts back",
  have: "had it already, untouched",
  same: "as the template has it",
  update: "updates its settings",
  kept: "your settings, kept",
  development: "In development, skipped",
};
const COPY: Record<string, string> = {
  add: "Wren's words go in",
  have: "follows Wren's words",
  own: "your words, kept",
  none: "no words yet",
};
const DRAFT: Record<string, string> = {
  add: "saved as a draft",
  have: "draft there already",
  edited: "your draft, kept",
  live: "live already",
};

/** The plan as lines a person reads. */
export function planLines(p: Plan): string[] {
  const head =
    p.kind === "same"
      ? "Installed. Installing again changes nothing."
      : p.kind === "update"
        ? "The template moved. Install with --update to apply:"
        : p.kind === "back"
          ? "Uninstalled before. Installing puts it back:"
          : "Installing does this:";
  return [
    `${p.name} on ${p.client}${p.state ? ` (${INSTALL_STATE_LABELS[p.state].label})` : ""}`,
    head,
    ...p.parts.map(
      (x) =>
        `  part ${x.name}: ${PART[x.status]}` +
        (x.accounts.length
          ? `. Needs: ${x.accounts.map((a) => `${a.label} (${a.how})`).join("; ")}`
          : ""),
    ),
    ...p.copy.map((c) => `  copy ${copyLabel(c.ref)}: ${COPY[c.status]}`),
    `  workflow: ${DRAFT[p.draft]}`,
    ...(p.door
      ? [
          `  door on ${p.door.input}, by ${p.door.subject}: ${p.door.status === "add" ? "made shut" : "there"}`,
        ]
      : []),
    ...(p.confirm ? [`It ${p.effects.join(" and ")}: pass --confirm ${p.template}.`] : []),
    "Nothing starts until a person approves it in To approve.",
  ];
}

export function registerWorkflows(
  program: Command,
  withMainDb: WithDb,
  withClientDb: WithClientDb,
  settings: Settings,
) {
  const sold = templatesOf(WORKFLOWS, COMPONENTS);
  const clientId = () => {
    const id = program.opts<{ client?: string }>().client;
    if (!id) throw new Error("this command needs --client <id> (see `wren clients list`)");
    return id;
  };
  const cmd = program.command("workflows").description("templates: whole workflows onto a client");

  cmd
    .command("templates")
    .description("Every template, and where each stands on --client when given")
    .action(async () => {
      const id = program.opts<{ client?: string }>().client;
      const rows = id ? await withMainDb((db) => installsOf(db, id)) : [];
      for (const t of sold) {
        const r = rows.find((x) => x.template === t.id);
        console.log(
          `${t.id}: ${t.name}. ${t.parts.map((p) => p.part.name).join(", ")}` +
            (r ? `. ${INSTALL_STATE_LABELS[r.state].label}` : id ? ". Not installed" : ""),
        );
      }
    });

  cmd
    .command("plan <template>")
    .description("What installing it on --client would do; writes nothing")
    .option("--json", "as JSON")
    .action(async (template: string, o: { json?: boolean }) => {
      const t = templateNamed(sold, template);
      const id = clientId();
      const plan = await withClientDb((cdb) =>
        withMainDb((db) => readPlan(db, cdb, t, id, undefined, SETUPS)),
      );
      console.log(o.json ? JSON.stringify(plan, null, 2) : planLines(plan).join("\n"));
    });

  cmd
    .command("install <template>")
    .description("Install it on --client: parts, copy, a draft and a shut door. Starts nothing")
    .option("--confirm <id>", "the template's id or name, when it sends or spends")
    .option("--update", "apply the plan's changes after the template moved")
    .action(async (template: string, o: { confirm?: string; update?: boolean }) => {
      const t = templateNamed(sold, template);
      const id = clientId();
      const out = await withClientDb((cdb) =>
        withMainDb((db) =>
          installTemplate(db, cdb, t, {
            client: id,
            by: BY,
            confirm: o.confirm,
            update: o.update === true,
            setups: SETUPS,
          }),
        ),
      );
      console.log(out.changed ? "Installed." : "Already installed. Nothing changed.");
      console.log(planLines(out.plan).join("\n"));
      if (out.token) {
        console.log(`Door: ${DOOR}${out.token}`);
        console.log("Shown once. It answers 409 until the workflow is approved.");
      }
    });

  cmd
    .command("publish <template>")
    .description("Ask to make --client's workflow live: it waits in To approve")
    .action(async (template: string) => {
      const t = templateNamed(sold, template);
      const out = await withMainDb((db) => askTemplate(db, t, { client: clientId(), by: BY }));
      console.log(`Waiting in To approve as ${out.id}. A person approves it there.`);
    });

  cmd
    .command("uninstall <template>")
    .description("Take it off --client: loops stop, the door shuts, data and copy stay")
    .action(async (template: string) => {
      const t = templateNamed(sold, template);
      const id = clientId();
      await withMainDb((db) => getClient(db, id));
      const out = await withMainDb((db) =>
        uninstallTemplate(
          db,
          t,
          { client: id, by: BY },
          { workflows: WORKFLOWS, components: COMPONENTS },
        ),
      );
      const ingress = clients.connect(ingressOf(settings));
      for (const l of out.stop)
        await ingress
          .objectSendClient<{ stop: () => Promise<unknown> }>({ name: l.service }, l.key)
          .stop();
      console.log(
        `Uninstalled. Took off: ${out.removed.join(", ") || "nothing"}.` +
          (out.kept.length ? ` Kept, still used: ${out.kept.join(", ")}.` : "") +
          " Data, copy and saves stay.",
      );
    });
}
