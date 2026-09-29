/**
 * Public job boards (R8): which ATS a company's own careers page points at,
 * and that ATS's official postings API. Free, exact, no login, no cap. One
 * entry per ATS; adding one is adding an entry.
 */
import { z } from "zod";
import type { Fetcher } from "../fetch/fetcher.js";

export interface Job {
  title: string;
  location: string | null;
  url: string | null;
  /** YYYY-MM-DD, when the board says. */
  postedAt: string | null;
}

export interface Board {
  ats: string;
  token: string;
  /** The board as a person sees it: the source a brief cites. */
  page: string;
  api: string;
}

interface Ats {
  name: string;
  /** Where a page names a board; group 1 is the board's token. */
  finds: RegExp[];
  page(token: string): string;
  api(token: string): string;
  /** The postings, or null when the body isn't this board's shape. */
  jobs(body: unknown, token: string): { jobs: Job[]; total: number } | null;
}

/** The day the board says: a stamp's own date, not its UTC one; epoch millis read as UTC. */
const day = (v: string | number | null | undefined): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)
    ? v.slice(0, 10)
    : d.toISOString().slice(0, 10);
};
const place = (...parts: (string | null | undefined)[]): string | null =>
  parts.filter((p) => p?.trim()).join(", ") || null;
const str = z.string().nullish();

const parsed = <T extends z.ZodType>(schema: T, body: unknown): z.infer<T> | null => {
  const r = schema.safeParse(body);
  return r.success ? r.data : null;
};

/** Greenhouse's shape, US and EU alike. */
function greenhouseJobs(body: unknown): { jobs: Job[]; total: number } | null {
  const b = parsed(
    z.object({
      jobs: z.array(
        z.object({
          title: z.string(),
          absolute_url: str,
          location: z.object({ name: str }).nullish(),
          first_published: str,
          updated_at: str,
        }),
      ),
      meta: z.object({ total: z.number() }).nullish(),
    }),
    body,
  );
  if (!b) return null;
  return {
    total: b.meta?.total ?? b.jobs.length,
    jobs: b.jobs.map((j) => ({
      title: j.title,
      location: j.location?.name ?? null,
      url: j.absolute_url ?? null,
      postedAt: day(j.first_published ?? j.updated_at),
    })),
  };
}

/** Path words that are the ATS's own pages, never a company's board. */
const NOT_TOKENS = new Set([
  "embed",
  "api",
  "v0",
  "v1",
  "js",
  "j",
  "www",
  "app",
  "apply",
  "jobs",
  "careers",
  "help",
  "support",
  "resources",
  "blog",
  "marketplace",
  "partners",
  "static",
  "assets",
  "cdn",
  "login",
  "signup",
  "oneclick-ui",
]);

export const ATS: readonly Ats[] = [
  {
    name: "greenhouse",
    finds: [
      /(?<!\beu\.)greenhouse\.io\/embed\/job_\w+(?:\/js)?\?(?:[^"'\s<>]*?&(?:amp;)?)?for=([\w-]+)/gi,
      /\b(?:boards|job-boards)\.greenhouse\.io\/([\w-]+)/gi,
      /\bboards-api\.greenhouse\.io\/v1\/boards\/([\w-]+)/gi,
    ],
    page: (t) => `https://job-boards.greenhouse.io/${t}`,
    api: (t) => `https://boards-api.greenhouse.io/v1/boards/${t}/jobs`,
    jobs: (body) => greenhouseJobs(body),
  },
  {
    name: "greenhouse-eu",
    finds: [
      /\beu\.greenhouse\.io\/embed\/job_\w+(?:\/js)?\?(?:[^"'\s<>]*?&(?:amp;)?)?for=([\w-]+)/gi,
      /\b(?:boards|job-boards)\.eu\.greenhouse\.io\/([\w-]+)/gi,
      /\bboards-api\.eu\.greenhouse\.io\/v1\/boards\/([\w-]+)/gi,
    ],
    page: (t) => `https://job-boards.eu.greenhouse.io/${t}`,
    api: (t) => `https://boards-api.eu.greenhouse.io/v1/boards/${t}/jobs`,
    jobs: (body) => greenhouseJobs(body),
  },
  {
    name: "lever",
    finds: [/\bjobs\.lever\.co\/([\w.-]+)/gi],
    page: (t) => `https://jobs.lever.co/${t}`,
    api: (t) => `https://api.lever.co/v0/postings/${t}?mode=json`,
    jobs: (body) => {
      const b = parsed(
        z.array(
          z.object({
            text: z.string(),
            hostedUrl: str,
            categories: z.object({ location: str }).nullish(),
            createdAt: z.number().nullish(),
          }),
        ),
        body,
      );
      if (!b) return null;
      return {
        total: b.length,
        jobs: b.map((j) => ({
          title: j.text,
          location: j.categories?.location ?? null,
          url: j.hostedUrl ?? null,
          postedAt: day(j.createdAt),
        })),
      };
    },
  },
  {
    name: "ashby",
    finds: [/\bjobs\.ashbyhq\.com\/([\w.%-]+)/gi],
    page: (t) => `https://jobs.ashbyhq.com/${t}`,
    api: (t) => `https://api.ashbyhq.com/posting-api/job-board/${t}`,
    jobs: (body) => {
      const b = parsed(
        z.object({
          jobs: z.array(
            z.object({
              title: z.string(),
              location: str,
              jobUrl: str,
              publishedAt: str,
              isListed: z.boolean().nullish(),
            }),
          ),
        }),
        body,
      );
      if (!b) return null;
      const listed = b.jobs.filter((j) => j.isListed !== false);
      return {
        total: listed.length,
        jobs: listed.map((j) => ({
          title: j.title,
          location: j.location ?? null,
          url: j.jobUrl ?? null,
          postedAt: day(j.publishedAt),
        })),
      };
    },
  },
  {
    name: "workable",
    finds: [/\bapply\.workable\.com\/([\w-]+)/gi, /\b([\w-]+)\.workable\.com\b/gi],
    page: (t) => `https://apply.workable.com/${t}/`,
    api: (t) => `https://apply.workable.com/api/v1/widget/accounts/${t}`,
    jobs: (body) => {
      const b = parsed(
        z.object({
          jobs: z.array(
            z.object({
              title: z.string(),
              url: str,
              shortlink: str,
              city: str,
              state: str,
              country: str,
              published_on: str,
              created_at: str,
            }),
          ),
        }),
        body,
      );
      if (!b) return null;
      return {
        total: b.jobs.length,
        jobs: b.jobs.map((j) => ({
          title: j.title,
          location: place(j.city, j.state, j.country),
          url: j.url ?? j.shortlink ?? null,
          postedAt: day(j.published_on ?? j.created_at),
        })),
      };
    },
  },
  {
    name: "smartrecruiters",
    finds: [
      /\b(?:careers|jobs)\.smartrecruiters\.com\/([\w-]+)/gi,
      // One-click apply links carry the company one level down.
      /\bjobs\.smartrecruiters\.com\/oneclick-ui\/company\/([\w-]+)/gi,
    ],
    page: (t) => `https://careers.smartrecruiters.com/${t}`,
    api: (t) => `https://api.smartrecruiters.com/v1/companies/${t}/postings?limit=100`,
    jobs: (body, token) => {
      const b = parsed(
        z.object({
          totalFound: z.number().nullish(),
          content: z.array(
            z.object({
              id: z.union([z.string(), z.number()]),
              name: z.string(),
              releasedDate: str,
              location: z.object({ city: str, region: str, country: str }).nullish(),
            }),
          ),
        }),
        body,
      );
      if (!b) return null;
      return {
        total: b.totalFound ?? b.content.length,
        jobs: b.content.map((j) => ({
          title: j.name,
          location: place(j.location?.city, j.location?.region, j.location?.country),
          url: `https://jobs.smartrecruiters.com/${token}/${j.id}`,
          postedAt: day(j.releasedDate),
        })),
      };
    },
  },
  {
    name: "recruitee",
    finds: [/\b([\w-]+)\.recruitee\.com\b/gi],
    page: (t) => `https://${t}.recruitee.com/`,
    api: (t) => `https://${t}.recruitee.com/api/offers/`,
    jobs: (body) => {
      const b = parsed(
        z.object({
          offers: z.array(
            z.object({
              title: z.string(),
              careers_url: str,
              location: str,
              published_at: str,
            }),
          ),
        }),
        body,
      );
      if (!b) return null;
      return {
        total: b.offers.length,
        jobs: b.offers.map((j) => ({
          title: j.title,
          location: j.location ?? null,
          url: j.careers_url ?? null,
          postedAt: day(j.published_at),
        })),
      };
    },
  },
  {
    name: "bamboohr",
    finds: [/\b([\w-]+)\.bamboohr\.com\b/gi],
    page: (t) => `https://${t}.bamboohr.com/careers`,
    api: (t) => `https://${t}.bamboohr.com/careers/list`,
    jobs: (body, token) => {
      const b = parsed(
        z.object({
          result: z.array(
            z.object({
              id: z.union([z.string(), z.number()]),
              jobOpeningName: z.string(),
              location: z.object({ city: str, state: str }).nullish(),
            }),
          ),
        }),
        body,
      );
      if (!b) return null;
      return {
        total: b.result.length,
        jobs: b.result.map((j) => ({
          title: j.jobOpeningName,
          location: place(j.location?.city, j.location?.state),
          url: `https://${token}.bamboohr.com/careers/${j.id}`,
          postedAt: null,
        })),
      };
    },
  },
];

const byName = new Map(ATS.map((a) => [a.name, a]));

const boardOf = (a: Ats, token: string): Board => ({
  ats: a.name,
  token,
  page: a.page(token),
  api: a.api(token),
});

/** Every board a page names, once each, in the order the page names them. */
export function findBoards(page: string): Board[] {
  // Scripts ship urls JSON-escaped (https:\/\/jobs.lever.co\/acme).
  const text = page.replace(/\\\//g, "/");
  const found = new Map<string, { at: number; board: Board }>();
  for (const a of ATS)
    for (const re of a.finds)
      for (const m of text.matchAll(re)) {
        let token = m[1] ?? "";
        try {
          token = decodeURIComponent(token);
        } catch {
          continue;
        }
        token = token.replace(/\.+$/, "");
        if (!token || NOT_TOKENS.has(token.toLowerCase())) continue;
        const key = `${a.name}:${token.toLowerCase()}`;
        const at = m.index ?? 0;
        const had = found.get(key);
        if (!had || at < had.at)
          found.set(key, { at, board: boardOf(a, encodeURIComponent(token)) });
      }
  return [...found.values()].sort((x, y) => x.at - y.at).map((f) => f.board);
}

export type BoardRead = { ok: true; jobs: Job[]; total: number } | { ok: false; why: string };

/** One board's postings through its public API. Never throws for a bad board; a dead network does. */
export async function readBoard(fetcher: Fetcher, board: Board): Promise<BoardRead> {
  const ats = byName.get(board.ats);
  if (!ats) return { ok: false, why: `unknown ATS ${board.ats}` };
  const res = await fetcher.get(board.api);
  if (res.status !== 200) return { ok: false, why: `HTTP ${res.status}` };
  let body: unknown;
  try {
    body = JSON.parse(res.text);
  } catch {
    return { ok: false, why: "not JSON" };
  }
  const got = ats.jobs(body, board.token);
  return got ? { ok: true, ...got } : { ok: false, why: "not the board's shape" };
}
