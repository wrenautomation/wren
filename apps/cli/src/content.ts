/**
 * `wren content …`: the content loop from the keyboard. Ideas and drafts go
 * through `ContentDesk` (the paid step is journaled); approve/reject/edit are
 * rows a person writes straight to Postgres; the queue is `ContentScheduler`.
 */
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import * as clients from "@restatedev/restate-sdk-clients";
import { ingressOf, type Settings } from "@wren/config";
import {
  approveDrafts,
  type ContentDraft,
  DRAFT_STATUSES,
  type DraftStatus,
  draftCosts,
  draftsOfIdea,
  editDraft,
  FUNNEL_STAGES,
  FUNNEL_TARGETS,
  formatCosts,
  formatPlan,
  formatWhatWorked,
  funnelLine,
  getDraft,
  IDEA_STATUSES,
  type IdeaStatus,
  listDrafts,
  listIdeas,
  PROMO_PIECES,
  PROMO_PLATFORMS,
  planFor,
  readFunnel,
  rejectDrafts,
  type Slot,
  setFields,
  setFunnel,
  slotsOf,
  tomorrowOf,
  uploadMedia,
  whatWorked,
} from "@wren/content";
import type {
  ContentDesk,
  ContentMetrics,
  ContentPlanner,
  ContentScheduler,
  DraftReport,
  PlannerSettings,
} from "@wren/content/restate";
import {
  DEFAULT_PLAN_PLATFORMS,
  DESK_KEY,
  METRICS_KEY,
  PLANNER_KEY,
  SCHEDULER_KEY,
} from "@wren/content/restate";
import { isStoredMedia, isUrl, type Media, PLATFORMS, type Platform } from "@wren/core/content";
import { coerceField, fieldViews } from "@wren/core/content/shapes";
import { REJECT_NOTE_MAX, REJECT_REASONS, rejectWhy } from "@wren/core/draft-record";
import type { Db } from "@wren/db";
import type { Command } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const PREVIEW = 70;
const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".webm"]);

function oneOf<T extends string>(what: string, value: string, allowed: readonly T[]): T {
  if (!(allowed as readonly string[]).includes(value))
    throw new Error(`${what} must be one of ${allowed.join(", ")}`);
  return value as T;
}

const platformsOf = (s: string | undefined): Platform[] | undefined =>
  s
    ?.split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => oneOf("platform", p, PLATFORMS));

/**
 * A file's media row: video by extension, image otherwise; `--kind`
 * overrides. A laptop file goes into the media store first (the worker and
 * the box cannot read this disk); a URL or an `s3://` object is kept as is.
 */
async function mediaOf(
  o: { media?: string; kind?: string; title?: string },
  bucket: string | undefined,
): Promise<Media | null> {
  if (!o.media) return null;
  const kind = o.kind
    ? oneOf("kind", o.kind, ["video", "image"] as const)
    : VIDEO_EXT.has(extname(o.media).toLowerCase())
      ? "video"
      : "image";
  let source = o.media;
  if (!isUrl(source) && !isStoredMedia(source)) {
    if (!bucket)
      throw new Error(
        "a local file needs WREN_MEDIA_BUCKET to be stored where the worker can read it (or pass a URL)",
      );
    source = await uploadMedia(source, { bucket });
    console.error(`stored ${o.media} as ${source}`);
  }
  return { kind, source, ...(o.title ? { title: o.title } : {}) };
}

const when = (d: Date | string | null) =>
  d ? new Date(d).toISOString().slice(0, 16).replace("T", " ") : "";
const line = (s: string, n = PREVIEW) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

/** "reach→video": where a post sits in the funnel and where it points. */
const funnelOf = (d: Pick<ContentDraft, "stage" | "pointsTo">) => `${d.stage}→${d.pointsTo}`;

function printDraftRow(d: ContentDraft) {
  const extra =
    d.status === "published" ? (d.url ?? "") : d.status === "failed" ? (d.error ?? "") : "";
  console.log(
    `${d.id}  ${d.platform.padEnd(9)}  ${d.status.padEnd(10)}  ${funnelOf(d).padEnd(15)}  ${when(d.scheduledFor).padEnd(16)}  ${line(d.title ? `${d.title} — ${d.text}` : d.text)}${extra ? `  ${line(extra, 60)}` : ""}`,
  );
}

function printReport(r: DraftReport) {
  for (const x of r.results) {
    if (x.ok) console.log(`${x.draft.id}  ${x.platform.padEnd(9)}  ${line(x.draft.text)}`);
    else console.log(`${"-".repeat(36)}  ${x.platform.padEnd(9)}  skipped: ${x.reason}`);
  }
}

export async function readText(file: string | undefined): Promise<string> {
  if (file && file !== "-") return readFile(file, "utf8");
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export function registerContent(program: Command, withDb: WithDb, settings: Settings): Command {
  const ingress = () => clients.connect(ingressOf(settings));
  const desk = () => ingress().objectClient<ContentDesk>({ name: "ContentDesk" }, DESK_KEY);
  const queue = () =>
    ingress().objectClient<ContentScheduler>({ name: "ContentScheduler" }, SCHEDULER_KEY);
  const planner = () =>
    ingress().objectClient<ContentPlanner>({ name: "ContentPlanner" }, PLANNER_KEY);
  /** The planner's stored settings; none (or Restate down) = the defaults. */
  const plannerSettings = async (): Promise<PlannerSettings> => {
    try {
      return ((await planner().status()).settings as PlannerSettings | null) ?? {};
    } catch {
      return {};
    }
  };
  const metrics = () =>
    ingress().objectClient<ContentMetrics>({ name: "ContentMetrics" }, METRICS_KEY);

  const content = program
    .command("content")
    .description("the content loop: ideas → drafts per platform → review → scheduled posts");

  content
    .command("add [file]")
    .description("Add an idea (a file, or stdin) and draft it for every configured platform")
    .option("--media <path>", "a file or URL the post carries (a short, a screenshot)")
    .option("--kind <kind>", "video | image (default: by extension)")
    .option("--title <text>", "the media's title (YouTube's default)")
    .option("--platforms <list>", "comma-separated subset")
    .option("--no-draft", "store the idea only")
    .action(
      async (
        file: string | undefined,
        o: { media?: string; kind?: string; title?: string; platforms?: string; draft: boolean },
      ) => {
        const text = await readText(file);
        if (text.trim() === "") throw new Error("empty idea");
        const platforms = platformsOf(o.platforms);
        const out = await desk().add({
          text,
          media: await mediaOf(o, settings.mediaBucket),
          draft: o.draft,
          ...(platforms ? { platforms } : {}),
        });
        console.log(`idea ${out.idea.id}`);
        if (out.drafts) printReport(out.drafts);
      },
    );

  content
    .command("ideas")
    .description("List ideas")
    .option("--status <status>", IDEA_STATUSES.join(" | "), "open")
    .action(async (o: { status: string }) => {
      const status = oneOf("status", o.status, IDEA_STATUSES) as IdeaStatus;
      const rows = await withDb((db) => listIdeas(db, status));
      for (const r of rows)
        console.log(
          `${r.id}  ${when(r.createdAt)}  ${r.source.padEnd(3)}  ${r.media ? r.media.kind.padEnd(5) : "     "}  ${line(r.text)}`,
        );
    });

  content
    .command("draft <ideaId>")
    .description("Draft an idea for the configured platforms (skips ones already drafted)")
    .option("--platforms <list>", "comma-separated subset")
    .option("--again", "draft again where a live draft exists")
    .action(async (ideaId: string, o: { platforms?: string; again?: boolean }) => {
      const platforms = platformsOf(o.platforms);
      const report = await desk().draft({
        ideaId,
        ...(platforms ? { platforms } : {}),
        ...(o.again ? { again: true } : {}),
      });
      printReport(report);
    });

  content
    .command("redraft <draftId> <note>")
    .description(
      'Rewrite one draft from your note ("shorter, keep the discord line"); the old one is rejected',
    )
    .action(async (draftId: string, note: string) => {
      printReport(await desk().redraft({ draftId, note }));
    });

  content
    .command("drafts")
    .description("List drafts")
    .option("--status <status>", DRAFT_STATUSES.join(" | "), "draft")
    .option("--platform <platform>", PLATFORMS.join(" | "))
    .option("--idea <ideaId>", "every draft of one idea")
    .option("--all", "every status")
    .action(async (o: { status: string; platform?: string; idea?: string; all?: boolean }) => {
      const rows = await withDb((db) =>
        o.idea
          ? draftsOfIdea(db, o.idea)
          : listDrafts(db, {
              ...(o.all
                ? {}
                : { status: oneOf("status", o.status, DRAFT_STATUSES) as DraftStatus }),
              ...(o.platform ? { platform: oneOf("platform", o.platform, PLATFORMS) } : {}),
            }),
      );
      for (const d of rows) printDraftRow(d);
    });

  content
    .command("show <draftId>")
    .description("Print one draft in full")
    .action(async (id: string) => {
      const [d, f] = await withDb(async (db) => {
        const row = await getDraft(db, id);
        return [row, await readFunnel(db, row)] as const;
      });
      console.log(
        `${d.platform} · ${d.status}${d.scheduledFor ? ` · due ${when(d.scheduledFor)}` : ""}${d.edited ? " · edited" : ""}`,
      );
      console.log(`funnel: ${funnelLine(f)}`);
      if (f.video) console.log(`video: ${f.video.id} ${f.video.title ?? ""}`.trimEnd());
      if (d.media) console.log(`media: ${d.media.kind} ${d.media.source}`);
      if (d.title) console.log(`title: ${d.title}`);
      if (d.url) console.log(`url: ${d.url}`);
      if (d.error) console.log(`error: ${d.error}`);
      console.log("");
      console.log(d.text);
    });

  content
    .command("approve <draftIds...>")
    .description(
      "Approve drafts: each posts at its platform's next slot (WREN_SEND_TIMEZONE), or at --at, or --now",
    )
    .option("--at <iso>", "publish at or after this time")
    .option("--now", "publish on the queue's next pass")
    .action(async (ids: string[], o: { at?: string; now?: boolean }) => {
      const at = o.at ? new Date(o.at) : null;
      if (at && Number.isNaN(at.getTime())) throw new Error(`not a time: ${o.at}`);
      const slots = slotsOf((await plannerSettings()).slots);
      const rows = await withDb((db) =>
        approveDrafts(db, ids, {
          now: new Date(),
          at,
          slots,
          zone: settings.sendTimezone,
          by: "cli",
          ...(o.now ? { asap: true } : {}),
        }),
      );
      for (const d of rows) printDraftRow(d);
    });

  content
    .command("reject <draftIds...>")
    .description("Reject drafts; why goes in the draft record")
    .option("--reason <pick>", `quick pick: ${REJECT_REASONS.join(", ")}`)
    .option("--note <text>", `why, in a few words (${REJECT_NOTE_MAX} characters)`)
    .action(async (ids: string[], o: { reason?: string; note?: string }) => {
      const why = rejectWhy(o);
      const rows = await withDb((db) => rejectDrafts(db, ids, { by: "cli", ...why }));
      for (const d of rows) printDraftRow(d);
    });

  content
    .command("edit <draftId> [file]")
    .description("Replace a draft's text from a file or stdin; it goes back to draft")
    .option("--title <text>", "replace the title too")
    .action(async (id: string, file: string | undefined, o: { title?: string }) => {
      const text = await readText(file);
      const row = await withDb((db) =>
        editDraft(
          db,
          id,
          { text, ...(o.title !== undefined ? { title: o.title } : {}) },
          { by: "cli" },
        ),
      );
      printDraftRow(row);
    });

  content
    .command("fields <draftId> [pairs...]")
    .description(
      "A draft's fields, its platform's shape (subreddit=startups tags=a,b madeForKids=off); key= unsets one. No pairs: list them",
    )
    .action(async (id: string, pairs: string[]) => {
      const draft = await withDb((db) => getDraft(db, id));
      if (pairs.length === 0) {
        for (const f of fieldViews(draft.platform, draft.extra, draft.title))
          console.log(
            `${f.key.padEnd(22)} ${JSON.stringify(f.value ?? f.default ?? null).padEnd(24)} ${f.label}${f.required ? " *" : ""}${f.status === "sent" ? "" : f.status === "dev" ? " (in development)" : " (not in the API)"}`,
          );
        return;
      }
      const patch: Record<string, unknown> = {};
      for (const pair of pairs) {
        const eq = pair.indexOf("=");
        if (eq <= 0) throw new Error(`expected key=value, got ${pair}`);
        const key = pair.slice(0, eq).trim();
        patch[key] = coerceField(draft.platform, key, pair.slice(eq + 1));
      }
      printDraftRow(await withDb((db) => setFields(db, id, patch, { by: "cli" })));
    });

  content
    .command("promote <video>")
    .description(
      "Draft promos pointing at a YouTube video (a video number from `wren video list`, or its YouTube draft id): a post per platform, an X thread, a carousel; each waits in To approve",
    )
    .option("--platforms <list>", `comma-separated subset of ${PROMO_PLATFORMS.join(",")}`)
    .option("--pieces <list>", `comma-separated: ${PROMO_PIECES.join(",")} (default posts)`)
    .option("--again", "draft again where a promo draft exists")
    .action(async (video: string, o: { platforms?: string; pieces?: string; again?: boolean }) => {
      const platforms = o.platforms
        ?.split(",")
        .map((p) => oneOf("platform", p.trim(), PROMO_PLATFORMS));
      const pieces = o.pieces?.split(",").map((p) => oneOf("piece", p.trim(), PROMO_PIECES));
      const report = await desk().promote({
        ...(/^\d+$/.test(video) ? { video: Number(video) } : { draftId: video }),
        ...(platforms?.length ? { platforms } : {}),
        ...(pieces?.length ? { pieces } : {}),
        ...(o.again ? { again: true } : {}),
      });
      printReport(report);
    });

  content
    .command("slides <draftId> [file]")
    .description(
      "A carousel's slides (LinkedIn PDF, Instagram images): print them, set them from a JSON file or stdin ([{title, lines}]), or --draw them",
    )
    .option("--draw", "draw the set to square images and a PDF")
    .action(async (id: string, file: string | undefined, o: { draw?: boolean }) => {
      if (!file && !o.draw) {
        const d = await withDb((db) => getDraft(db, id));
        console.log(JSON.stringify(d.extra?.slides ?? [], null, 2));
        return;
      }
      const slides = file ? JSON.parse(await readText(file)) : undefined;
      const out = await desk().slides({
        draftId: id,
        ...(slides ? { slides } : {}),
        ...(o.draw ? { draw: true } : {}),
      });
      console.log(JSON.stringify(out, null, 2));
    });

  content
    .command("funnel <draftId>")
    .description(
      "Where a post sits in the funnel and where it points; its link follows (wrenautomation.com/go/… or the video's URL)",
    )
    .option("--stage <stage>", FUNNEL_STAGES.join(" | "))
    .option("--to <target>", FUNNEL_TARGETS.join(" | "))
    .option("--video <draftId>", "the YouTube draft it points at; '' clears it")
    .option("--link <on|off|auto>", "carry the link; auto follows the platform's rule")
    .action(
      async (id: string, o: { stage?: string; to?: string; video?: string; link?: string }) => {
        const linked =
          o.link === undefined
            ? undefined
            : oneOf("link", o.link, ["on", "off", "auto"] as const) === "auto"
              ? null
              : o.link === "on";
        const f = await withDb(async (db) => {
          const row = await setFunnel(
            db,
            id,
            {
              ...(o.stage ? { stage: oneOf("stage", o.stage, FUNNEL_STAGES) } : {}),
              ...(o.to ? { to: oneOf("to", o.to, FUNNEL_TARGETS) } : {}),
              ...(o.video !== undefined ? { video: o.video || null } : {}),
              ...(linked !== undefined ? { linked } : {}),
            },
            { by: "cli" },
          );
          return readFunnel(db, row);
        });
        console.log(funnelLine(f));
      },
    );

  const q = content.command("queue").description("the publish loop (ContentScheduler)");
  q.command("status").action(async () =>
    console.log(JSON.stringify(await queue().status(), null, 2)),
  );
  q.command("start")
    .description("Loop: post approved drafts as they come due")
    .action(async () => console.log(JSON.stringify(await queue().start(), null, 2)));
  q.command("stop").action(async () => console.log(JSON.stringify(await queue().stop(), null, 2)));
  q.command("sync")
    .description("One pass now")
    .action(async () => console.log(JSON.stringify(await queue().sync(), null, 2)));

  content
    .command("plan")
    .description("Tomorrow's slots per platform: how many are filled, what waits for review")
    .option("--platforms <list>", "comma-separated (default linkedin,reddit)")
    .action(async (o: { platforms?: string }) => {
      const platforms = platformsOf(o.platforms) ?? DEFAULT_PLAN_PLATFORMS;
      const zone = settings.sendTimezone;
      const slots = slotsOf((await plannerSettings()).slots);
      const plan = await withDb((db) =>
        planFor(db, platforms, tomorrowOf(new Date(), zone), zone, slots),
      );
      console.log(plan.day);
      for (const l of formatPlan(plan)) console.log(`  ${l}`);
    });

  const pl = content
    .command("planner")
    .description(
      "the daily plan on Discord at 17:00, and with --draft tomorrow's drafts (ContentPlanner); off until started",
    );
  pl.command("status").action(async () =>
    console.log(JSON.stringify(await planner().status(), null, 2)),
  );
  pl.command("start")
    .description("Settings replace the stored ones when any flag is given")
    .option("--platforms <list>", "comma-separated (default linkedin,reddit)")
    .option("--draft", "fill tomorrow's open slots with drafts (Cohere); approving stays yours")
    .option("--slots <json>", 'per-platform slots, e.g. {"linkedin":[{"hour":8,"minute":30}]}')
    .action(async (o: { platforms?: string; draft?: boolean; slots?: string }) => {
      const platforms = platformsOf(o.platforms);
      const body = {
        ...(platforms ? { platforms } : {}),
        ...(o.draft ? { draft: true } : {}),
        ...(o.slots ? { slots: JSON.parse(o.slots) as Record<string, unknown> } : {}),
      };
      console.log(
        JSON.stringify(
          await planner().start(Object.keys(body).length > 0 ? body : undefined),
          null,
          2,
        ),
      );
    });
  pl.command("slots <platform> [times...]")
    .description(
      "Set one platform's post times (HH:MM, the fleet's clock), keeping the other settings; starts the planner",
    )
    .option("--days <spec>", "ISO weekdays, 1 = Monday: 1-5, 2, 1,3,5 (default every day)")
    .option("--clear", "back to the platform's default slots")
    .addHelpText(
      "after",
      "\nOne LinkedIn post each weekday: wren content planner slots linkedin 08:30 --days 1-5\nOne Reddit post a week, Tuesday: wren content planner slots reddit 09:30 --days 2",
    )
    .action(async (platform: string, times: string[], o: { days?: string; clear?: boolean }) => {
      if (!PLATFORMS.includes(platform as Platform)) throw new Error(`not a platform: ${platform}`);
      if (!o.clear && times.length === 0) throw new Error("give at least one HH:MM, or --clear");
      const days = o.days ? daysOf(o.days) : undefined;
      const list: Slot[] = times.map((t) => {
        const m = /^(\d{1,2}):(\d{2})$/.exec(t);
        const hour = Number(m?.[1]);
        const minute = Number(m?.[2]);
        if (!m || hour > 23 || minute > 59) throw new Error(`not a time: ${t} (HH:MM)`);
        return { hour, minute, ...(days ? { days } : {}) };
      });
      const current = await planner().status();
      const stored = (current.settings as PlannerSettings | null) ?? {};
      const slots = { ...stored.slots };
      if (o.clear) delete slots[platform as Platform];
      else slots[platform as Platform] = list;
      const out = await planner().start({ ...stored, slots });
      console.log(JSON.stringify(out.settings ?? out, null, 2));
    });
  pl.command("stop").action(async () =>
    console.log(JSON.stringify(await planner().stop(), null, 2)),
  );
  pl.command("sync")
    .description("Plan (and draft, if on) now")
    .action(async () => console.log(JSON.stringify(await planner().sync(), null, 2)));

  content
    .command("results")
    .description("What worked: published posts of the last days, best engagement first")
    .option("--days <n>", "window", "7")
    .option("--platform <p>", "one platform")
    .action(async (o: { days: string; platform?: string }) => {
      const days = Number(o.days);
      if (!(days > 0)) throw new Error("--days must be > 0");
      const platform = o.platform ? oneOf("platform", o.platform, PLATFORMS) : undefined;
      const rows = await withDb((db) =>
        whatWorked(db, new Date(), { days, ...(platform ? { platform } : {}) }),
      );
      for (const line of formatWhatWorked(rows)) console.log(line);
    });

  content
    .command("costs")
    .description("Drafting spend: calls and tokens by platform and model")
    .option("--days <n>", "window", "30")
    .action(async (o: { days: string }) => {
      const days = Number(o.days);
      if (!(days > 0)) throw new Error("--days must be > 0");
      const rows = await withDb((db) => draftCosts(db, new Date(), days));
      for (const line of formatCosts(rows)) console.log(line);
    });

  const m = content
    .command("metrics")
    .description("the daily metrics look (ContentMetrics); Monday = what-worked to the channel");
  m.command("status").action(async () =>
    console.log(JSON.stringify(await metrics().status(), null, 2)),
  );
  m.command("start")
    .description("Loop: snapshot every young published post once a day")
    .action(async () => console.log(JSON.stringify(await metrics().start(), null, 2)));
  m.command("stop").action(async () =>
    console.log(JSON.stringify(await metrics().stop(), null, 2)),
  );
  m.command("sync")
    .description("One pass now")
    .action(async () => console.log(JSON.stringify(await metrics().sync(), null, 2)));

  return content;
}

/** "1-5", "2", "1,3,5" → ISO weekdays (1 = Monday). */
export function daysOf(spec: string): number[] {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const m = /^\s*(\d)\s*(?:-\s*(\d)\s*)?$/.exec(part);
    const a = Number(m?.[1]);
    const b = Number(m?.[2] ?? m?.[1]);
    if (!m || a < 1 || b > 7 || a > b)
      throw new Error(`not weekdays: ${spec} (1 = Monday, 1-5, 2, 1,3)`);
    for (let d = a; d <= b; d++) out.add(d);
  }
  return [...out].sort((x, y) => x - y);
}
