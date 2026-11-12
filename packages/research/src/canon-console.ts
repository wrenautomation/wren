/**
 * CanonConsole: the portal's Canon › References (designs/2026-11-12-canon-references.md). Reads
 * schema `canon` (the index `CanonIndexSync` keeps), never the repo. Reels play from the media
 * bucket (`cache/instagram/<code>.mp4`); the page falls back to the embed when a file is missing.
 */
import { answer, PortalRefusal, type PortalRequest, portalService } from "@wren/core/portal";
import { PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import type { Db } from "@wren/db";
import type * as restate from "@wren/runtime";
import { type Frontmatter, linesOf, RULE_LINE } from "@wrenautomation/knowledge";
import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { CANON_CONSOLE_APPS, CANON_CONSOLE_ROUTES } from "./canon-console-routes.js";

const REPO = "canon";
const VIDEO_KINDS = ["reel", "video"];
const PAGE = 60;

/** s3://bucket/key → a signed URL. */
export type Sign = (uri: string) => Promise<string>;
export interface Media {
  bucket: string;
  sign: Sign;
}

interface Note {
  text: string;
  by: string;
  at: string;
}
export interface Reference {
  id: string;
  title: string;
  url: string;
  platform: string;
  kind: string;
  handle: string | null;
  /** seconds */
  length: number | null;
  provider: { kind: string; who: string } | null;
  note: Note | null;
  tags: string[];
  /** when it came into Canon */
  saved: string;
  /** when the creator posted it */
  posted: string | null;
  stats: { views?: number; likes?: number; comments?: number } | null;
  poster: string | null;
  /** a stored file; null → `embed` */
  video: string | null;
  embed: string | null;
}
export interface Backs {
  set: string;
  setTitle: string;
  topic: string | null;
  line: string;
  text: string;
}
export interface ReferenceWhole extends Reference {
  hook: string | null;
  hookStyle: string | null;
  cta: string | null;
  topic: string | null;
  beats: { t: number; beat: string }[];
  caption: string | null;
  transcript: string | null;
  backs: Backs[];
}
export interface Facet {
  value: string;
  n: number;
}
export interface ReferencesPage {
  /** false: prod has no index yet */
  indexed: boolean;
  /** the Canon commit the index is at */
  head: string | null;
  total: number;
  rows: Reference[];
  next: number | null;
  facets: { platform: Facet[]; tag: Facet[]; provider: Facet[] };
}

type Data = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Data | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Data) : null;

const platformOf = (id: string, d: Data) => str(d.platform) ?? id.split("-")[0] ?? "web";

/** YouTube's video id from the record's url. */
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("youtu.be")) return u.pathname.slice(1) || null;
    const v = u.searchParams.get("v");
    if (v) return v;
    const m = /^\/(?:shorts|embed|live)\/([\w-]+)/.exec(u.pathname);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

/** the saved date: `saved.at`, a bare `saved`, else when the record was made */
const savedOf = (d: Data, created: string) =>
  str(obj(d.saved)?.at) ?? str(d.saved) ?? str(d.created) ?? created;

async function shape(
  r: { id: string; title: string; created: string; data: Data },
  media: Media | null,
): Promise<Reference> {
  const d = r.data;
  const platform = platformOf(r.id, d);
  const url = str(d.url) ?? "";
  const note = obj(d.note);
  const provider = obj(d.provider);
  const stats = obj(d.stats);
  let poster: string | null = null;
  let video: string | null = null;
  let embed: string | null = null;
  if (platform === "instagram") {
    const code = r.id.slice("instagram-".length);
    embed = `https://www.instagram.com/reel/${code}/embed`;
    if (media) {
      const at = `s3://${media.bucket}/cache/instagram/${code}`;
      [poster, video] = await Promise.all([
        media.sign(`${at}.jpg`).catch(() => null),
        media.sign(`${at}.mp4`).catch(() => null),
      ]);
    }
  } else if (platform === "youtube") {
    const v = youtubeId(url);
    if (v) {
      poster = `https://i.ytimg.com/vi/${v}/hqdefault.jpg`;
      embed = `https://www.youtube-nocookie.com/embed/${v}`;
    }
  }
  return {
    id: r.id,
    title: r.title,
    url,
    platform,
    kind: str(d.kind) ?? "video",
    handle: str(d.handle),
    length: num(d.length) ?? num(d.duration),
    provider:
      provider && str(provider.kind)
        ? { kind: String(provider.kind), who: str(provider.who) ?? "" }
        : null,
    note:
      note && str(note.text)
        ? { text: String(note.text), by: str(note.by) ?? "", at: str(note.at) ?? "" }
        : null,
    tags: Array.isArray(d.tags) ? d.tags.filter((t): t is string => typeof t === "string") : [],
    saved: savedOf(d, r.created),
    posted: str(d.date) ?? str(d.uploaded),
    stats: stats
      ? {
          ...(num(stats.views) != null ? { views: num(stats.views) as number } : {}),
          ...(num(stats.likes) != null ? { likes: num(stats.likes) as number } : {}),
          ...(num(stats.comments) != null ? { comments: num(stats.comments) as number } : {}),
        }
      : null,
    poster,
    video,
    embed,
  };
}

/** The text under `## <name>` in a record's body, up to the next `## `. */
export function sectionOf(body: string, name: string): string | null {
  const lines = body.split("\n");
  const at = lines.findIndex((l) => l.trim() === `## ${name}`);
  if (at < 0) return null;
  const end = lines.findIndex((l, i) => i > at && l.startsWith("## "));
  const text = lines
    .slice(at + 1, end < 0 ? undefined : end)
    .join("\n")
    .trim();
  return text || null;
}

/** A rule line's words: no `- **XX-n**` head, no `[n]` refs. */
const lineText = (line: string) =>
  line
    .replace(RULE_LINE, "")
    .replace(/\[(\d+)(?: [^\]]*)?\]|\[notes\]/g, "")
    .replace(/\s+/g, " ")
    .trim();

export interface Filters {
  platform?: string | null;
  kind?: string | null;
  provider?: string | null;
  tag?: string | null;
  q?: string | null;
  noted?: boolean | null;
}

const SAVED_SQL = sql`coalesce(case when jsonb_typeof(r.data->'saved') = 'object' then r.data->'saved'->>'at' else r.data->>'saved' end, r.created)`;
const PLATFORM_SQL = sql`coalesce(r.data->>'platform', split_part(r.id, '-', 1))`;

function where(f: Filters, skip?: "platform" | "tag" | "provider"): SQL {
  const w: SQL[] = [
    sql`r.repo = ${REPO}`,
    sql`r.type = 'source'`,
    sql`r.status = 'live'`,
    sql`r.data->>'kind' in (${sql.join(
      VIDEO_KINDS.map((k) => sql`${k}`),
      sql`, `,
    )})`,
  ];
  if (f.platform && skip !== "platform") w.push(sql`${PLATFORM_SQL} = ${f.platform}`);
  if (f.kind) w.push(sql`r.data->>'kind' = ${f.kind}`);
  if (f.provider && skip !== "provider") w.push(sql`r.data->'provider'->>'kind' = ${f.provider}`);
  if (f.tag && skip !== "tag") w.push(sql`r.data->'tags' ? ${f.tag}`);
  if (f.noted) w.push(sql`coalesce(r.data->'note'->>'text', '') <> ''`);
  if (f.q?.trim()) {
    const like = `%${f.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    w.push(
      sql`(r.title ilike ${like} or r.data->'note'->>'text' ilike ${like} or r.data->>'handle' ilike ${like})`,
    );
  }
  return sql.join(w, sql` and `);
}

type Row = { id: string; title: string; created: string; data: Data };

export function canonConsoleApi(db: Db, media: Media | null = null) {
  const indexed = async () => {
    const [r] = await db.execute<{ t: string | null }>(
      sql`select to_regclass('canon.knowledge_records')::text as t`,
    );
    return !!r?.t;
  };
  const headOf = async () => {
    const [r] = await db.execute<{ value: string }>(
      sql`select value from canon.knowledge_meta where repo = ${REPO} and key = 'head'`,
    );
    return r?.value ?? null;
  };
  const facet = async (expr: SQL, f: Filters, skip: "platform" | "tag" | "provider") =>
    (
      await db.execute<{ value: string; n: number }>(
        sql`select v as value, count(*)::int as n from canon.knowledge_records r, ${expr} where ${where(f, skip)} and v is not null group by v order by n desc, v limit 40`,
      )
    ).map((x) => ({ value: x.value, n: x.n }));

  return {
    /** A page of video references, newest saved first, with counts per filter value. */
    references: async (f: Filters & { after?: number | null; limit?: number | null }) => {
      const empty: ReferencesPage = {
        indexed: false,
        head: null,
        total: 0,
        rows: [],
        next: null,
        facets: { platform: [], tag: [], provider: [] },
      };
      if (!(await indexed())) return empty;
      const after = f.after ?? 0;
      const limit = Math.min(f.limit ?? PAGE, PAGE);
      const [rows, [count], head, platform, tag, provider] = await Promise.all([
        db.execute<Row>(
          sql`select r.id, r.title, r.created, r.data from canon.knowledge_records r where ${where(f)} order by ${SAVED_SQL} desc, r.id limit ${limit} offset ${after}`,
        ),
        db.execute<{ n: number }>(
          sql`select count(*)::int as n from canon.knowledge_records r where ${where(f)}`,
        ),
        headOf(),
        facet(sql`lateral (select ${PLATFORM_SQL} as v) x`, f, "platform"),
        facet(sql`jsonb_array_elements_text(coalesce(r.data->'tags', '[]'::jsonb)) x(v)`, f, "tag"),
        facet(sql`lateral (select r.data->'provider'->>'kind' as v) x`, f, "provider"),
      ]);
      const total = count?.n ?? 0;
      return {
        indexed: true,
        head,
        total,
        rows: await Promise.all(rows.map((r) => shape(r, media))),
        next: after + rows.length < total ? after + rows.length : null,
        facets: { platform, tag, provider },
      } satisfies ReferencesPage;
    },

    /** One reference whole: the breakdown, the transcript and each rule line it backs. */
    reference: async (id: string): Promise<ReferenceWhole> => {
      if (!(await indexed())) throw new PortalRefusal("Canon has no index here yet", 404);
      const [r] = await db.execute<Row & { body: string }>(
        sql`select r.id, r.title, r.created, r.data, r.body from canon.knowledge_records r where r.repo = ${REPO} and r.id = ${id} and r.type = 'source'`,
      );
      if (!r) throw new PortalRefusal("no such reference", 404);
      // every record that cites this source, at any depth: the rule sets among them, and the
      // findings and patterns between, so linesOf can walk down to it
      const up = await db.execute<{
        id: string;
        type: string;
        title: string;
        body: string;
        data: Data;
      }>(
        sql`with recursive up(id) as (
              select ${id}::text
              union
              select c."from" from canon.knowledge_cites c join up on c."to" = up.id where c.repo = ${REPO}
            )
            select k.id, k.type, k.title, k.body, k.data from canon.knowledge_records k join up using (id)
            where k.repo = ${REPO} and k.status = 'live'`,
      );
      const byId = new Map(up.map((x) => [x.id, x.data as unknown as Frontmatter]));
      const backs: Backs[] = [];
      for (const rule of up.filter((x) => x.type === "rule")) {
        const fm = rule.data as unknown as Frontmatter;
        const texts = new Map<string, string>();
        for (const l of rule.body.split("\n")) {
          const m = RULE_LINE.exec(l);
          if (m) texts.set(`${m[1]}-${m[2]}`, lineText(l));
        }
        for (const b of linesOf({ fm, body: rule.body }, byId)) {
          if (!b.sources.includes(id)) continue;
          backs.push({
            set: rule.id,
            setTitle: rule.title,
            topic: b.topic ?? null,
            line: b.line,
            text: texts.get(b.line) ?? "",
          });
        }
      }
      const d = r.data;
      const bd = obj(d.breakdown) ?? {};
      const beats = Array.isArray(bd.beats)
        ? bd.beats.flatMap((b) => {
            const o = obj(b);
            const t = num(o?.t);
            const beat = str(o?.beat);
            return t != null && beat ? [{ t, beat }] : [];
          })
        : [];
      return {
        ...(await shape(r, media)),
        hook: str(bd.hook),
        hookStyle: str(bd.hookStyle),
        cta: str(bd.cta),
        topic: str(bd.topic),
        beats,
        caption: sectionOf(r.body, "Caption"),
        transcript: sectionOf(r.body, "Transcript"),
        backs,
      };
    },
  };
}

const ID = z.string().min(1).max(200);
const INPUTS = {
  references: {
    platform: z.string().max(40).nullish(),
    kind: z.string().max(40).nullish(),
    provider: z.string().max(40).nullish().describe("human or agent"),
    tag: z.string().max(80).nullish(),
    q: z.string().max(200).nullish(),
    noted: z.boolean().nullish().describe("only references with his note"),
    after: z.number().int().min(0).nullish(),
    limit: z.number().int().min(1).max(PAGE).nullish(),
  },
  reference: { id: ID },
} as const;

type Req = PortalRequest & Record<string, unknown>;

export function makeCanonConsole(db: Db, media: Media | null) {
  const api = canonConsoleApi(db, media);
  const h = <K extends keyof typeof INPUTS>(k: K, fn: (req: Req) => Promise<unknown>) =>
    serviceHandler(
      { input: z.looseObject({ ...PORTAL_FIELDS, ...INPUTS[k] }) },
      (_: restate.Context, req: Req): Promise<unknown> => answer(() => fn(req)),
    );
  return portalService({
    name: "CanonConsole",
    main: db,
    routes: CANON_CONSOLE_ROUTES,
    apps: CANON_CONSOLE_APPS,
    unnamed: "wren",
    handlers: {
      references: h("references", (req) => api.references(req as Filters)),
      reference: h("reference", (req) => api.reference(String(req.id))),
    },
  });
}
