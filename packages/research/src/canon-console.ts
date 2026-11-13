/**
 * CanonConsole: the portal's Canon: References here, the rest in `canon-library.ts`
 * (designs/2026-11-12-canon-references.md). Reads
 * schema `canon` (the index `CanonIndexSync` keeps), never the repo. Reels play from the media
 * bucket (`cache/instagram/<code>.mp4`); the page falls back to the embed when a file is missing.
 */
import {
  answer,
  isDemo,
  PortalRefusal,
  type PortalRequest,
  portalService,
} from "@wren/core/portal";
import { PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import type { Db } from "@wren/db";
import type * as restate from "@wren/runtime";
import { type Frontmatter, linesOf, RULE_LINE } from "@wrenautomation/knowledge";
import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import {
  type CanonAddRequest,
  enqueueAdd,
  listAdds,
  retryAdd,
  STORED_FILE,
  whatOf,
} from "./canon-adds.js";
import { CANON_CONSOLE_APPS, CANON_CONSOLE_ROUTES } from "./canon-console-routes.js";
import { canonLibraryApi, lineText, type RecordFilters } from "./canon-library.js";
import {
  FEED_PRESETS,
  type FeedFacets,
  type FeedFilter,
  type FeedPreset,
  type FeedRow,
  feedFacets,
  feedPosts,
} from "./creators.js";

const REPO = "canon";
/** the kinds the References page holds */
export const VIDEO_KINDS = ["reel", "video"];
const PAGE = 60;

/** s3://bucket/key → a signed URL. */
export type Sign = (uri: string) => Promise<string>;
/** A browser PUT signed for this hash: S3 refuses other bytes. */
export type SignPut = (f: {
  sha256: string;
  ext: string;
  type: string;
  size: number;
}) => Promise<{ url: string; headers: Record<string, string>; source: string }>;
export interface Media {
  bucket: string;
  sign: Sign;
  signPut?: SignPut;
}

/** what the Add box takes as a file: Canon keeps pictures and PDFs (canon-files) */
const ADD_FILE_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};
const ADD_MAX_BYTES = 50 * 1024 * 1024;

/** An Add box row as the page shows it. */
export interface AddRow {
  id: number;
  what: string;
  fileName: string | null;
  note: string | null;
  person: string;
  state: CanonAddRequest["state"];
  error: string | null;
  records: string[];
  at: string;
}
const addRow = (r: CanonAddRequest): AddRow => ({
  id: r.id,
  what: r.what,
  fileName: r.fileName,
  note: r.note,
  person: r.person,
  state: r.state,
  error: r.error,
  records: r.records ?? [],
  at: r.at.toISOString(),
});
const emailOf = (req: PortalRequest) => {
  if (isDemo(req.viewer)) throw new PortalRefusal("sign in to add to Canon", 403);
  return req.viewer.email;
};

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
  /** what it is good for: `useFor` in the record */
  useFor: { area: string; text: string | null } | null;
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
  facets: { platform: Facet[]; tag: Facet[]; provider: Facet[]; area: Facet[] };
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

/** A source row as the page shows it: poster and player from the media bucket or the platform. */
export async function referenceOf(
  r: { id: string; title: string; created: string; data: Data },
  media: Media | null,
): Promise<Reference> {
  const d = r.data;
  const platform = platformOf(r.id, d);
  const url = str(d.url) ?? "";
  const note = obj(d.note);
  const provider = obj(d.provider);
  const stats = obj(d.stats);
  const useFor = obj(d.useFor);
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
    useFor:
      useFor && str(useFor.area) ? { area: String(useFor.area), text: str(useFor.text) } : null,
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

export interface Filters {
  platform?: string | null;
  kind?: string | null;
  provider?: string | null;
  tag?: string | null;
  /** `useFor.area` */
  area?: string | null;
  q?: string | null;
  noted?: boolean | null;
}
type Facetted = "platform" | "tag" | "provider" | "area";

const SAVED_SQL = sql`coalesce(case when jsonb_typeof(r.data->'saved') = 'object' then r.data->'saved'->>'at' else r.data->>'saved' end, r.created)`;
const PLATFORM_SQL = sql`coalesce(r.data->>'platform', split_part(r.id, '-', 1))`;

function where(f: Filters, skip?: Facetted): SQL {
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
  if (f.area && skip !== "area") w.push(sql`r.data->'useFor'->>'area' = ${f.area}`);
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
  const facet = async (expr: SQL, f: Filters, skip: Facetted) =>
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
        facets: { platform: [], tag: [], provider: [], area: [] },
      };
      if (!(await indexed())) return empty;
      const after = f.after ?? 0;
      const limit = Math.min(f.limit ?? PAGE, PAGE);
      const [rows, [count], head, platform, tag, provider, area] = await Promise.all([
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
        facet(sql`lateral (select r.data->'useFor'->>'area' as v) x`, f, "area"),
      ]);
      const total = count?.n ?? 0;
      return {
        indexed: true,
        head,
        total,
        rows: await Promise.all(rows.map((r) => referenceOf(r, media))),
        next: after + rows.length < total ? after + rows.length : null,
        facets: { platform, tag, provider, area },
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
        ...(await referenceOf(r, media)),
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
    area: z.string().max(80).nullish().describe("what it is good for: useFor.area"),
    q: z.string().max(200).nullish(),
    noted: z.boolean().nullish().describe("only references with his note"),
    after: z.number().int().min(0).nullish(),
    limit: z.number().int().min(1).max(PAGE).nullish(),
  },
  reference: { id: ID },
  home: {},
  topic: { name: z.string().min(1).max(80) },
  records: {
    type: z.string().max(40).nullish(),
    status: z.string().max(40).nullish(),
    topic: z.string().max(80).nullish(),
    tag: z.string().max(80).nullish(),
    q: z.string().max(200).nullish(),
    after: z.number().int().min(0).nullish(),
  },
  record: { id: ID },
  file: { path: z.string().min(1).max(500) },
  adds: {},
  add: {
    what: z.string().min(1).max(2000).describe("a link, or the `source` an upload answered"),
    fileName: z.string().max(300).nullish(),
    note: z.string().max(20_000).nullish().describe("the person's words, whole"),
  },
  retry: { id: z.number().int().positive() },
  feed: {
    preset: z.enum(Object.keys(FEED_PRESETS) as [FeedPreset, ...FeedPreset[]]).nullish(),
    niche: z.string().max(80).nullish(),
    platform: z.string().max(40).nullish(),
    kind: z.string().max(16).nullish(),
    limit: z.number().int().min(1).max(200).nullish(),
  },
  upload: {
    name: z.string().min(1).max(300),
    size: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  },
} as const;

type Req = PortalRequest & Record<string, unknown>;

interface FeedAsk {
  preset?: FeedPreset | null;
  niche?: string | null;
  platform?: string | null;
  kind?: string | null;
  limit?: number | null;
}
export interface FeedPage extends FeedFacets {
  rows: FeedRow[];
}

/** Canon › Outliers: the CLI's `wren feed`, a preset plus the picks. */
async function feedPage(db: Db, a: FeedAsk): Promise<FeedPage> {
  const f: FeedFilter = {
    ...(a.preset ? FEED_PRESETS[a.preset] : {}),
    ...(a.niche ? { niche: a.niche } : {}),
    ...(a.platform ? { platforms: [a.platform] } : {}),
    ...(a.kind ? { kinds: [a.kind] } : {}),
    limit: a.limit ?? 100,
  };
  const [facets, rows] = await Promise.all([feedFacets(db), feedPosts(db, f)]);
  return { ...facets, rows };
}

export function makeCanonConsole(db: Db, media: Media | null, remote: string) {
  const api = canonConsoleApi(db, media);
  const library = canonLibraryApi(db, remote, (rows) =>
    Promise.all(rows.map((r) => referenceOf(r, media))),
  );
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
      home: h("home", () => library.home()),
      topic: h("topic", (req) => library.topic(String(req.name))),
      records: h("records", (req) => library.records(req as RecordFilters)),
      record: h("record", (req) => library.record(String(req.id))),
      file: h("file", (req) => library.file(String(req.path))),
      adds: h("adds", async () => ({ rows: (await listAdds(db)).map(addRow) })),
      feed: h("feed", (req) => feedPage(db, req as FeedAsk)),
      add: h("add", async (req) => {
        const what = String(req.what).trim();
        if (!whatOf(what)) throw new PortalRefusal("give a link that starts with https://", 400);
        // a file must be one this store took: never a key from elsewhere
        if (STORED_FILE.test(what) && !what.startsWith(`s3://${media?.bucket}/`))
          throw new PortalRefusal("that file isn't one uploaded here", 400);
        return addRow(
          await enqueueAdd(db, {
            what,
            fileName: (req.fileName as string | null) ?? null,
            note: (req.note as string | null) ?? null,
            askedBy: emailOf(req),
          }),
        );
      }),
      retry: h("retry", async (req) => {
        const row = await retryAdd(db, Number(req.id));
        if (!row) throw new PortalRefusal("only a failed add can be tried again", 409);
        return addRow(row);
      }),
      upload: h("upload", async (req) => {
        emailOf(req);
        if (!media?.signPut) throw new PortalRefusal("no file store here", 503);
        const name = String(req.name);
        const ext = (/\.[a-z0-9]+$/i.exec(name)?.[0] ?? "").toLowerCase();
        const type = ADD_FILE_TYPES[ext];
        if (!type) throw new PortalRefusal("Canon takes a picture or a PDF", 400);
        const size = Number(req.size);
        if (size > ADD_MAX_BYTES)
          throw new PortalRefusal(`files go up to ${ADD_MAX_BYTES / 1024 / 1024} MB`, 400);
        return media.signPut({ sha256: String(req.sha256), ext, type, size });
      }),
    },
  });
}
