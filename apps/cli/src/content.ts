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
  formatCosts,
  formatWhatWorked,
  getDraft,
  IDEA_STATUSES,
  type IdeaStatus,
  listDrafts,
  listIdeas,
  rejectDrafts,
  uploadMedia,
  whatWorked,
} from "@wren/content";
import type {
  ContentDesk,
  ContentMetrics,
  ContentScheduler,
  DraftReport,
} from "@wren/content/restate";
import { DESK_KEY, METRICS_KEY, SCHEDULER_KEY } from "@wren/content/restate";
import { isStoredMedia, isUrl, type Media, PLATFORMS, type Platform } from "@wren/core/content";
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

function printDraftRow(d: ContentDraft) {
  const extra =
    d.status === "published" ? (d.url ?? "") : d.status === "failed" ? (d.error ?? "") : "";
  console.log(
    `${d.id}  ${d.platform.padEnd(9)}  ${d.status.padEnd(10)}  ${when(d.scheduledFor).padEnd(16)}  ${line(d.title ? `${d.title} — ${d.text}` : d.text)}${extra ? `  ${line(extra, 60)}` : ""}`,
  );
}

function printReport(r: DraftReport) {
  for (const x of r.results) {
    if (x.ok) console.log(`${x.draft.id}  ${x.platform.padEnd(9)}  ${line(x.draft.text)}`);
    else console.log(`${"-".repeat(36)}  ${x.platform.padEnd(9)}  skipped: ${x.reason}`);
  }
}

async function readText(file: string | undefined): Promise<string> {
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
          `${r.id}  ${when(r.createdAt)}  ${r.media ? r.media.kind.padEnd(5) : "     "}  ${line(r.text)}`,
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
      const d = await withDb((db) => getDraft(db, id));
      console.log(
        `${d.platform} · ${d.status}${d.scheduledFor ? ` · due ${when(d.scheduledFor)}` : ""}${d.edited ? " · edited" : ""}`,
      );
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
      const rows = await withDb((db) =>
        approveDrafts(db, ids, {
          now: new Date(),
          at,
          zone: settings.sendTimezone,
          ...(o.now ? { asap: true } : {}),
        }),
      );
      for (const d of rows) printDraftRow(d);
    });

  content.command("reject <draftIds...>").action(async (ids: string[]) => {
    const rows = await withDb((db) => rejectDrafts(db, ids));
    for (const d of rows) printDraftRow(d);
  });

  content
    .command("edit <draftId> [file]")
    .description("Replace a draft's text from a file or stdin; it goes back to draft")
    .option("--title <text>", "replace the title too")
    .action(async (id: string, file: string | undefined, o: { title?: string }) => {
      const text = await readText(file);
      const row = await withDb((db) =>
        editDraft(db, id, { text, ...(o.title !== undefined ? { title: o.title } : {}) }),
      );
      printDraftRow(row);
    });

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
