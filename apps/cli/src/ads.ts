/**
 * `wren ads …`: Meta ads from the keyboard, through the `Ads` Restate
 * service (every Graph call journaled, the box's spend gate in front of
 * anything ACTIVE). A launch is PAUSED; `start` is the one command that
 * spends, and it must say the daily budget.
 */
import { readFile, writeFile } from "node:fs/promises";
import * as clients from "@restatedev/restate-sdk-clients";
import type { LaunchSpec, MetaObjective } from "@wren/channel-meta";
import { formatLaunches, listLaunches, META_OBJECTIVES, specFromPost } from "@wren/channel-meta";
import { type AdsService, type AdsWatch, WATCH_KEY } from "@wren/channel-meta/restate";
import { ingressOf, type Settings } from "@wren/config";
import { getDraft, uploadMedia } from "@wren/content";
import { isStoredMedia, isUrl } from "@wren/core/content";
import type { Db } from "@wren/db";
import type { Command } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

/** The launch file: `creative.media.source` may be a local path when WREN_MEDIA_BUCKET is set (uploaded first). */
function parseSpec(raw: string): LaunchSpec {
  const j = JSON.parse(raw) as Partial<LaunchSpec>;
  const need = <K extends keyof LaunchSpec>(k: K): LaunchSpec[K] => {
    const v = j[k];
    if (v === undefined || v === null) throw new Error(`spec needs "${k}"`);
    return v as LaunchSpec[K];
  };
  const objective = need("objective");
  if (!(META_OBJECTIVES as readonly string[]).includes(objective))
    throw new Error(`objective must be one of ${META_OBJECTIVES.join(", ")}`);
  const targeting = need("targeting");
  if (!Array.isArray(targeting.countries) || targeting.countries.length === 0)
    throw new Error("spec needs targeting.countries");
  const creative = need("creative");
  if (!creative.message || !creative.link) throw new Error("spec needs creative.message and .link");
  const budget = need("dailyBudgetUsd");
  if (!(budget > 0)) throw new Error("dailyBudgetUsd must be > 0");
  return {
    name: need("name"),
    objective: objective as MetaObjective,
    dailyBudgetUsd: budget,
    targeting,
    creative,
    ...(j.optimizationGoal ? { optimizationGoal: j.optimizationGoal } : {}),
    status: "PAUSED",
  };
}

const size = (n: number | undefined) =>
  n === undefined
    ? "?"
    : n >= 1e6
      ? `${(n / 1e6).toFixed(1)}M`
      : n >= 1e3
        ? `${Math.round(n / 1e3)}k`
        : String(n);

const usd = (minor: string | number | undefined) =>
  minor === undefined ? "-" : `$${(Number(minor) / 100).toFixed(2)}`;

export function registerAds(program: Command, withDb: WithDb, settings: Settings): Command {
  const ingress = () => clients.connect(ingressOf(settings));
  const ads = () => ingress().serviceClient<AdsService>({ name: "Ads" });
  const watch = () => ingress().objectClient<AdsWatch>({ name: "AdsWatch" }, WATCH_KEY);

  const cmd = program
    .command("ads")
    .description("Meta ads: launch PAUSED, start with a budget, stop, read results");

  cmd
    .command("accounts")
    .description("Ad accounts the Meta token admins")
    .action(async () => {
      for (const a of await ads().accounts())
        console.log(
          `${a.id}\t${a.name ?? ""}\t${a.currency ?? ""}\tstatus ${a.account_status ?? "?"}`,
        );
    });

  cmd
    .command("campaigns")
    .description("Campaigns in the ad account")
    .action(async () => {
      const rows = await ads().campaigns();
      if (rows.length === 0) console.log("no campaigns");
      for (const c of rows)
        console.log(
          `${c.id}\t${c.status}\t${c.objective ?? ""}\t${usd(c.daily_budget)}/day\t${c.name}`,
        );
    });

  cmd
    .command("launch <spec.json>")
    .description(
      "Campaign → ad set → creative → ad from a JSON spec, all PAUSED (see designs/2026-09-22-meta-ads.md)",
    )
    .action(async (file: string) => {
      const spec = parseSpec(await readFile(file, "utf8"));
      const media = spec.creative.media;
      if (media && !isUrl(media.source) && !isStoredMedia(media.source)) {
        if (!settings.mediaBucket)
          throw new Error("a local media file needs WREN_MEDIA_BUCKET (or give a URL)");
        media.source = await uploadMedia(media.source, { bucket: settings.mediaBucket });
        console.error(`stored media as ${media.source}`);
      }
      const made = await ads().launch(spec);
      console.log(`campaign ${made.campaignId}`);
      console.log(`adset    ${made.adsetId}`);
      console.log(`creative ${made.creativeId}`);
      console.log(`ad       ${made.adId}`);
      console.log(`PAUSED · $${made.dailyBudgetUsd}/day once started:`);
      console.log(
        `  wren ads start ${made.campaignId} ${made.adsetId} ${made.adId} --daily ${made.dailyBudgetUsd}`,
      );
    });

  cmd
    .command("start <campaignId> <adsetId> <adId>")
    .description("Deliver: ACTIVE on all three (spends; the box asks before each ACTIVE write)")
    .requiredOption("--daily <usd>", "the ad set's daily budget in USD")
    .action(async (campaignId: string, adsetId: string, adId: string, o: { daily: string }) => {
      const dailyBudgetUsd = Number(o.daily);
      if (!(dailyBudgetUsd > 0)) throw new Error("--daily must be > 0");
      await ads().start({ campaignId, adsetId, adId, dailyBudgetUsd });
      console.log(`started ${campaignId} at $${dailyBudgetUsd}/day`);
    });

  cmd
    .command("stop <campaignId>")
    .description("PAUSED at the campaign: nothing under it delivers")
    .action(async (campaignId: string) => {
      await ads().stop({ campaignId });
      console.log(`stopped ${campaignId}`);
    });

  cmd
    .command("interests <query>")
    .description("Interest ids for a spec's targeting.interests")
    .action(async (q: string) => {
      const rows = await ads().interests({ q });
      if (rows.length === 0) console.log(`no interest matches "${q}"`);
      for (const r of rows)
        console.log(
          `${r.id}\t${r.name}\t${size(r.audience_size_lower_bound)}–${size(r.audience_size_upper_bound)}\t${r.path?.join(" › ") ?? ""}`,
        );
    });

  cmd
    .command("insights")
    .description("Spend and results per campaign")
    .option("--preset <p>", "today | yesterday | last_7d | last_30d | maximum", "last_7d")
    .option("--level <l>", "account | campaign | adset | ad", "campaign")
    .action(async (o: { preset: string; level: "account" | "campaign" | "adset" | "ad" }) => {
      const rows = await ads().insights({ preset: o.preset, level: o.level });
      if (rows.length === 0) console.log(`nothing for ${o.preset}`);
      for (const r of rows)
        console.log(
          `${r.campaign_name ?? r.date_start ?? ""}\tspend $${r.spend ?? "0"}\timpr ${r.impressions ?? 0}\treach ${r.reach ?? 0}\tclicks ${r.clicks ?? 0}\tctr ${r.ctr ?? "-"}\tcpc ${r.cpc ?? "-"}`,
        );
    });

  cmd
    .command("lead-form <name> <privacyUrl>")
    .description("An instant form on the Page (email + full name); put its id in creative.leadForm")
    .option("--thanks <url>", "where the thank-you button goes")
    .action(async (name: string, privacyUrl: string, o: { thanks?: string }) => {
      const id = await ads().leadForm({
        name,
        privacyUrl,
        ...(o.thanks ? { followUpUrl: o.thanks } : {}),
      });
      console.log(id);
    });

  cmd
    .command("lead-forms")
    .description("The Page's instant forms with lead counts")
    .action(async () => {
      const rows = await ads().leadForms();
      if (rows.length === 0) console.log("no forms");
      for (const f of rows)
        console.log(`${f.id}\t${f.status ?? ""}\t${f.leads_count ?? 0} leads\t${f.name}`);
    });

  cmd
    .command("leads <formId>")
    .description("What a form collected: one line per lead, answers tab-separated")
    .option("--limit <n>", "how many", "100")
    .action(async (formId: string, o: { limit: string }) => {
      const rows = await ads().leads({ formId, limit: Number(o.limit) });
      if (rows.length === 0) console.log("no leads yet");
      for (const l of rows)
        console.log(
          [
            l.created_time?.slice(0, 16) ?? "",
            ...(l.field_data ?? []).map((f) => `${f.name}=${f.values.join("|")}`),
          ].join("\t"),
        );
    });

  cmd
    .command("spec-from <draftId>")
    .description(
      "A launch spec from a published post: same words and media, PAUSED; prints JSON (or --out)",
    )
    .option("--link <url>", "where the ad sends people (default: the post's URL)")
    .option("--daily <usd>", "daily budget once started", "10")
    .option("--countries <list>", "comma-separated", "US")
    .option("--out <file>", "write the spec here instead of stdout")
    .action(
      async (
        draftId: string,
        o: { link?: string; daily: string; countries: string; out?: string },
      ) => {
        const d = await withDb((db) => getDraft(db, draftId));
        const spec = specFromPost(
          { text: d.text, title: d.title, url: d.url, media: d.media },
          {
            ...(o.link ? { link: o.link } : {}),
            dailyBudgetUsd: Number(o.daily),
            countries: o.countries
              .split(",")
              .map((c) => c.trim().toUpperCase())
              .filter(Boolean),
          },
        );
        const json = JSON.stringify(spec, null, 2);
        if (o.out) {
          await writeFile(o.out, `${json}\n`);
          console.log(`wrote ${o.out}; then: wren ads launch ${o.out}`);
        } else console.log(json);
      },
    );

  cmd
    .command("launches")
    .description("What `wren ads` launched, started and stopped (the ad_launches ledger)")
    .option("--limit <n>", "rows", "50")
    .action(async (o: { limit: string }) => {
      const rows = await withDb((db) => listLaunches(db, Number(o.limit)));
      for (const line of formatLaunches(rows)) console.log(line);
    });

  const w = cmd
    .command("watch")
    .description(
      `the daily guard (AdsWatch): pauses a launch that spent WREN_ADS_PAUSE_AFTER_USD ($${settings.adsPauseAfterUsd}) in 7 days with no clicks or results`,
    );
  w.command("status").action(async () =>
    console.log(JSON.stringify(await watch().status(), null, 2)),
  );
  w.command("start")
    .description("Loop: adset insights once a day, one message per pass")
    .action(async () => console.log(JSON.stringify(await watch().start(), null, 2)));
  w.command("stop").action(async () => console.log(JSON.stringify(await watch().stop(), null, 2)));
  w.command("sync")
    .description("One pass now")
    .action(async () => console.log(JSON.stringify(await watch().sync(), null, 2)));

  return cmd;
}
