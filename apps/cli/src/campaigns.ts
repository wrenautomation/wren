/**
 * `wren [--client <id>] campaigns …` (designs/2026-11-02-campaigns.md): the campaigns of the
 * newest shape, or of `--version <n>`. A campaign is a group with campaign fields; its edits go
 * through `wren shape` (export, edit the YAML, import) or a draft op. `numbers` reads the journeys.
 * `--json` everywhere.
 */
import type { Db } from "@wren/db";
import { type CampaignNumber, campaignNumbersOf } from "@wren/pipeline/campaign-numbers";
import { isMetro } from "@wren/pipeline/metro";
import { type Campaign, campaignsOf } from "@wren/pipeline/metro-campaigns";
import type { NumberWindow } from "@wren/pipeline/numbers";
import { newestShape, shapeVersionsOf } from "@wren/pipeline/store";
import type { Command } from "commander";
import { numberArg, windowArg } from "./pipeline.js";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

/** One line a campaign: id, status, station count, label, then what it sits in and sells. */
export function campaignLine(c: Campaign): string {
  return [
    c.id,
    c.status,
    `${c.stations.length} station${c.stations.length === 1 ? "" : "s"}`,
    c.label,
    c.parent && `in ${c.parent}`,
    c.offer && `offer ${c.offer}`,
    (c.from || c.until) && `${c.from ?? "…"} to ${c.until ?? "…"}`,
  ]
    .filter(Boolean)
    .join("  ");
}

/** Every field of one campaign; one set on a campaign above it says where from. */
export function campaignLines(c: Campaign): string[] {
  const from = (k: keyof Campaign["own"]) =>
    c.own[k] === undefined && c.parent ? `  (from ${c.parent})` : "";
  const map = (m: Record<string, string | number>) =>
    Object.entries(m)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ");
  const a = c.audience;
  return [
    `${c.id}  ${c.label}`,
    `status    ${c.status}${c.own.status && c.own.status !== c.status ? `  (held by ${c.parent})` : from("status")}`,
    c.parent ? `in        ${c.parent}` : "",
    c.offer ? `offer     ${c.offer}${from("offer")}` : "",
    a
      ? `audience  ${[a.segment && `segment ${a.segment}`, a.lines?.length && `lines ${a.lines.join(", ")}`].filter(Boolean).join("; ")}${from("audience")}`
      : "",
    ...c.ctas.map((x, i) => `cta ${i + 1}     ${x.label} -> ${x.station}${from("ctas")}`),
    Object.keys(c.accounts).length ? `accounts  ${map(c.accounts)}` : "",
    Object.keys(c.caps).length ? `caps      ${map(c.caps)} a day` : "",
    c.from || c.until ? `dates     ${c.from ?? "…"} to ${c.until ?? "…"}` : "",
    `stations  ${c.stations.join(", ") || "none"}`,
  ].filter(Boolean);
}

/** One campaign's numbers on a line. */
export function campaignNumberLine(n: CampaignNumber): string {
  return [
    n.campaign,
    n.gone ? "gone" : n.status,
    `${n.people} in`,
    `${n.converted} converted`,
    `${n.now} now`,
    `${n.deals} deal${n.deals === 1 ? "" : "s"}`,
  ].join("  ");
}

/** `id` when it is a campaign of the newest shape; else why not. The default is no tag. */
export async function campaignArg(db: Db, id: string): Promise<string> {
  const body = (await newestShape(db))?.body;
  const ids = isMetro(body) ? campaignsOf(body).map((c) => c.id) : [];
  if (id === "default" || !ids.includes(id))
    throw new Error(
      `no campaign "${id}" on the newest shape${ids.length > 1 ? `; campaigns: ${ids.slice(1).join(", ")}` : ""}`,
    );
  return id;
}

export function registerCampaigns(program: Command, withDb: WithDb): void {
  const cmd = program
    .command("campaigns")
    .description("campaigns: groups on the shape with an offer, audience, CTAs, accounts and caps");

  /** The campaigns of one version, or why there are none. */
  const read = (version?: number) =>
    withDb(async (db) => {
      const all = await shapeVersionsOf(db);
      const v = version ? all.find((x) => x.number === version) : all[all.length - 1];
      if (!v) return version ? `no version ${version}` : "no shape yet";
      if (!isMetro(v.body)) return `version ${v.number} is a graph; campaigns need the metro model`;
      return campaignsOf(v.body);
    });

  cmd
    .command("list")
    .description("Every campaign, the default first")
    .option("--version <n>", "a version number; the newest when left out", numberArg)
    .option("--json", "rows as JSON")
    .action(async (o: { version?: number; json?: boolean }) => {
      const r = await read(o.version);
      if (typeof r === "string") return console.log(o.json ? "[]" : r);
      if (o.json) return console.log(JSON.stringify(r, null, 2));
      for (const c of r) console.log(campaignLine(c));
    });

  cmd
    .command("show <id>")
    .description("One campaign's fields, inherited ones marked, and its stations")
    .option("--version <n>", "a version number; the newest when left out", numberArg)
    .option("--json", "the campaign as JSON")
    .action(async (id: string, o: { version?: number; json?: boolean }) => {
      const r = await read(o.version);
      if (typeof r === "string") throw new Error(r);
      const c = r.find((x) => x.id === id);
      if (!c) throw new Error(`no campaign ${id}; wren campaigns list`);
      if (o.json) return console.log(JSON.stringify(c, null, 2));
      for (const line of campaignLines(c)) console.log(line);
    });

  cmd
    .command("numbers")
    .description(
      "Per campaign: people in, converted (reached a CTA), open now, deals. From the journeys",
    )
    .option("--window <days>", "the last 7, 30 or 90 days, or all", windowArg)
    .option("--json", "rows as JSON")
    .action(async (o: { window?: NumberWindow; json?: boolean }) => {
      const rows = await withDb((db) =>
        campaignNumbersOf(db, o.window ? { window: o.window } : {}),
      );
      if (o.json) return console.log(JSON.stringify(rows, null, 2));
      for (const n of rows) console.log(campaignNumberLine(n));
    });
}
