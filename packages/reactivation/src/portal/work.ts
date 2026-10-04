/**
 * The work behind one line of a run (P5): what was searched, which pages were
 * read and what each said, the fact it settled on and how sure it is. Built
 * from the trail each lookup and check keeps (`tried`) and the finding it
 * stored, in a client's words. The raw trail can name our accounts and vendors,
 * so a client never gets it; operators get it as `detail`, emails cut.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { fullName } from "../feed.js";
import type { MoverOutcome } from "../schema.js";
import type { Reason } from "../score.js";
import { iso, SUBJECTS } from "./views.js";

export type WorkIcon = "mail" | "search" | "page" | "board" | "wait" | "rank" | "write";

export interface WorkLink {
  label: string;
  href: string | null;
}

/** A result it weighed and kept or set aside: a profile the search turned up. */
export interface WorkOption {
  page: WorkLink;
  verdict: string;
  kept: boolean;
}

export interface WorkStep {
  icon: WorkIcon;
  /** What it did ("Searched the web"). */
  did: string;
  /** What it searched for. */
  query: string | null;
  /** The same search, for anyone to run again. */
  queryHref: string | null;
  /** The page it read. */
  page: WorkLink | null;
  /** What came of it. */
  result: string | null;
  options: WorkOption[];
  /** Kept: this is where the answer came from. Dropped: a dead end. */
  tone: "kept" | "dropped" | "plain";
  /** The raw trail entry, for operators. */
  detail: string | null;
}

/** The fact a step settled on, as stored. */
export interface WorkFact {
  kind: string;
  /** The page's own title. */
  title: string | null;
  fields: [label: string, value: string][];
  /** 0 to 1. */
  sure: number | null;
  page: WorkLink | null;
  seen: string | null;
}

export interface WorkView {
  step: string;
  subject: string;
  /** Opens their page; null for a company. */
  personId: number | null;
  steps: WorkStep[];
  facts: WorkFact[];
  /** Why they rank where they do, biggest first. */
  reasons: { reason: string; points: number }[];
  at: string | null;
}

interface Tried {
  step: string;
  what: string;
  outcome: string;
}

const STEPS_WITH_WORK = ["lookup", "signals", "movers", "score", "brief", "compose"] as const;
export type WorkStepId = (typeof STEPS_WITH_WORK)[number];
export const hasWork = (step: string): step is WorkStepId =>
  (STEPS_WITH_WORK as readonly string[]).includes(step);

const EMAIL = /[^\s@:;,()]+@[^\s@:;,()]+/g;
const redact = (s: string) => s.replace(EMAIL, "…");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A page by its full address, so anyone can check it. */
export const pageOf = (url: string | null | undefined): WorkLink | null => {
  if (!url || url === "-") return null;
  try {
    const href = new URL(url).toString();
    return { label: href, href };
  } catch {
    return null;
  }
};

const profileOf = (vanity: string): WorkLink => {
  const href = `https://www.linkedin.com/in/${encodeURIComponent(vanity)}`;
  return { label: href, href };
};

/** Where to run a search again: the web's on Google, LinkedIn's on LinkedIn. */
const SEARCHES = {
  web: "https://www.google.com/search?q=",
  people: "https://www.linkedin.com/search/results/people/?keywords=",
  companies: "https://www.linkedin.com/search/results/companies/?keywords=",
};
const searchAt = (where: keyof typeof SEARCHES, q: string) =>
  `${SEARCHES[where]}${encodeURIComponent(q)}`;

const day = (isoText: string) => {
  const d = new Date(isoText);
  return Number.isNaN(d.getTime())
    ? "later"
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};

const step = (s: Partial<WorkStep> & Pick<WorkStep, "icon" | "did">): WorkStep => ({
  query: null,
  queryHref: null,
  page: null,
  result: null,
  options: [],
  tone: "plain",
  detail: null,
  ...s,
});

const refused = (outcome: string) => outcome.startsWith("refused");

/** A profile's verdict in the trail ("matched", "name differs (X)"), in a client's words. */
function verdictOf(v: string): { verdict: string; kept: boolean } {
  if (v === "matched") return { verdict: "Same person", kept: true };
  if (v.startsWith("name differs")) return { verdict: "A different name", kept: false };
  if (v.includes("no role at the firm"))
    return { verdict: "Same name, no sign of the firm", kept: false };
  if (refused(v)) return { verdict: "LinkedIn didn't answer", kept: false };
  return { verdict: "Set aside", kept: false };
}

/** A daily cap parked it: when it tries again, never whose cap or which account. */
const paused = (t: Tried): WorkStep =>
  step({
    icon: "wait",
    did: "Paused for the day",
    result: `Today's checks ran out. We try again ${day(t.outcome.replace(/^retry at /, ""))}.`,
  });

/** One person lookup's trail. */
export function lookupSteps(tried: readonly Tried[]): WorkStep[] {
  return tried.map((t): WorkStep => {
    switch (t.step) {
      case "email": {
        const [kind, ...why] = t.outcome.split(": ");
        const address = t.what.includes("@") ? t.what : null;
        const said = why.length ? why.join(": ") : null;
        return step({
          icon: "mail",
          did: "Checked the email address on your list",
          result: address && said ? `${address}: ${said}` : said && cap(said),
          tone: kind === "left" ? "kept" : "plain",
        });
      }
      case "search": {
        if (t.what === "-")
          return step({ icon: "search", did: "Couldn't search", result: cap(t.outcome) });
        const [head = "", ...rest] = t.outcome.split("; ");
        const n = Number(head.match(/^(\d+) people/)?.[1] ?? Number.NaN);
        const options = rest.flatMap((r) => {
          const at = r.indexOf(": ");
          if (at < 0) return [];
          return [{ page: profileOf(r.slice(0, at)), ...verdictOf(r.slice(at + 2)) }];
        });
        return step({
          icon: "search",
          did: "Searched the web",
          query: t.what,
          queryHref: searchAt("web", t.what),
          result: Number.isFinite(n) ? `${n} ${n === 1 ? "person" : "people"} found` : null,
          options,
          tone: options.some((o) => o.kept) ? "kept" : "plain",
        });
      }
      case "profile": {
        const v = verdictOf(t.outcome);
        return step({
          icon: "page",
          did: "Read the LinkedIn profile",
          page: profileOf(t.what),
          result: v.verdict,
          tone: v.kept ? "kept" : "dropped",
        });
      }
      case "linkedin search":
        return step({
          icon: "search",
          did: "Searched LinkedIn",
          query: t.what,
          queryHref: searchAt("people", t.what),
          result: refused(t.outcome) ? "LinkedIn didn't answer" : cap(t.outcome),
          tone: refused(t.outcome) ? "dropped" : "plain",
        });
      case "capped":
        return paused(t);
      default:
        return step({ icon: "search", did: cap(t.step) });
    }
  });
}

/** What a careers page read said, in a client's words. */
function careersResult(outcome: string): { result: string; tone: WorkStep["tone"] } {
  if (/^HTTP 404/.test(outcome)) return { result: "No page there", tone: "dropped" };
  if (/^HTTP /.test(outcome)) return { result: "The page didn't load", tone: "dropped" };
  if (outcome.startsWith("unreachable")) return { result: "Couldn't reach it", tone: "dropped" };
  if (outcome.startsWith("leaves the site"))
    return { result: "Goes to another site", tone: "dropped" };
  if (outcome === "no board named") return { result: "No job board on it", tone: "dropped" };
  const board = outcome.match(/^(\w+) board /);
  if (board?.[1]) return { result: `Links to their ${cap(board[1])} job board`, tone: "kept" };
  if (/boards, none/.test(outcome))
    return { result: "Links to job boards, none clearly theirs", tone: "dropped" };
  return { result: cap(outcome), tone: "plain" };
}

/** One company hiring check's trail. */
export function checkSteps(tried: readonly Tried[]): WorkStep[] {
  return tried.map((t): WorkStep => {
    switch (t.step) {
      case "careers":
        return step({
          icon: "page",
          did: "Read their site",
          page: pageOf(t.what),
          ...careersResult(t.outcome),
        });
      case "board": {
        const ok = /^\d+ open roles?$/.test(t.outcome);
        return step({
          icon: "board",
          did: "Read their job board",
          page: pageOf(t.what),
          result: ok ? cap(t.outcome) : "Couldn't read it",
          tone: ok ? "kept" : "dropped",
        });
      }
      case "linkedin page": {
        if (t.what === "-")
          return step({
            icon: "page",
            did: "Skipped LinkedIn",
            result: t.outcome.startsWith("no LinkedIn account")
              ? "No LinkedIn check on this list"
              : "Not enough to tie a page to the firm",
          });
        if (/^\d+ pages by name$/.test(t.outcome))
          return step({
            icon: "search",
            did: "Searched LinkedIn for their page",
            query: t.what,
            queryHref: searchAt("companies", t.what),
            result: cap(t.outcome),
          });
        const ours = t.outcome.endsWith(": the firm's");
        return step({
          icon: "page",
          did: "Read a LinkedIn company page",
          page: pageOf(t.what),
          result: refused(t.outcome)
            ? "LinkedIn didn't answer"
            : ours
              ? "The website on it is theirs"
              : "Another firm's page",
          tone: ours ? "kept" : "dropped",
        });
      }
      case "linkedin jobs":
        return step({
          icon: "board",
          did: "Read their LinkedIn jobs",
          page: pageOf(t.what),
          result: refused(t.outcome) ? "LinkedIn didn't answer" : cap(t.outcome),
          tone: refused(t.outcome) ? "dropped" : "kept",
        });
      case "capped":
        return paused(t);
      default:
        return step({ icon: "page", did: cap(t.step) });
    }
  });
}

const FACT_KINDS: Record<string, string> = {
  job_change: "Moved",
  left: "Left",
  still_there: "Still there",
  hiring: "Hiring",
};

const FIELDS: [key: string, label: string][] = [
  ["to", "Now at"],
  ["company", "At"],
  ["from", "Was at"],
  ["title", "Role"],
  ["dates", "Dates"],
  ["count", "Open roles"],
];

const roleTitle = (r: unknown): string | null =>
  typeof r === "string"
    ? r
    : r && typeof r === "object" && typeof (r as { title?: unknown }).title === "string"
      ? (r as { title: string }).title
      : null;

/** A stored finding as the fact a step settled on. */
export function factOf(r: {
  kind: string;
  value: unknown;
  confidence: number | null;
  source_url: string | null;
  title: string | null;
  seen: unknown;
}): WorkFact {
  const v = (r.value && typeof r.value === "object" ? r.value : {}) as Record<string, unknown>;
  const fields: [string, string][] = [];
  for (const [k, label] of FIELDS) {
    const x = v[k];
    if (typeof x === "string" && x.trim()) fields.push([label, x.trim()]);
    else if (typeof x === "number") fields.push([label, String(x)]);
  }
  const roles = Array.isArray(v.roles)
    ? v.roles.map(roleTitle).filter((t): t is string => !!t)
    : [];
  if (roles.length) fields.push(["Roles", roles.slice(0, 3).join(", ")]);
  return {
    kind: FACT_KINDS[r.kind] ?? cap(r.kind.replace(/_/g, " ")),
    title: r.title,
    fields,
    sure: r.confidence === null ? null : Number(r.confidence),
    page: pageOf(r.source_url),
    seen: iso(r.seen),
  };
}

const detailOf = (tried: readonly Tried[], i: number) => {
  const t = tried[i];
  return t ? redact(`${t.step}: ${t.what} → ${t.outcome}`) : null;
};

const triedOf = (v: unknown): Tried[] =>
  Array.isArray(v)
    ? v.flatMap((t) =>
        t && typeof t === "object" && typeof t.step === "string"
          ? [{ step: t.step, what: String(t.what ?? ""), outcome: String(t.outcome ?? "") }]
          : [],
      )
    : [];

const withDetail = (steps: WorkStep[], tried: Tried[], operator: boolean) =>
  operator ? steps.map((s, i) => ({ ...s, detail: detailOf(tried, i) })) : steps;

/** Who a line names. Two on a list rarely share a name; the newest wins. */
async function personOf(db: Queryable, subject: string, shown: (name: string) => string) {
  const want = subject.trim().toLowerCase();
  const first = want.split(/\s+/)[0] ?? "";
  const rows = await db.execute<{
    person_id: number;
    first_name: string | null;
    last_name: string | null;
    where_id: number | null;
  }>(sql`
    with ${SUBJECTS}
    select s.person_id, p.first_name, p.last_name, s.where_id
    from subjects s join people p on p.id = s.person_id
    where split_part(lower(trim(concat_ws(' ', p.first_name, p.last_name))), ' ', 1) = ${first}
    order by s.person_id desc limit 200`);
  return (
    rows.find((r) => shown(fullName(r.first_name, r.last_name)).trim().toLowerCase() === want) ??
    null
  );
}

const MOVER_RESULT: Record<MoverOutcome, string> = {
  found: "Found an address their mail server accepts",
  no_domain: "Couldn't find the new firm's website",
  catch_all: "Their mail server accepts any address, so none could be proven",
  not_found: "No address there could be proven",
};

/** A mover's address hunt at their new firm, from its kept outcome. */
export const moverStep = (outcome: MoverOutcome, domain: string | null): WorkStep =>
  step({
    icon: "mail",
    did: domain ? `Looked for their email at ${domain}` : "Looked for the new firm's website",
    result: MOVER_RESULT[outcome],
    tone: outcome === "found" ? "kept" : "plain",
  });

async function factsOf(db: Queryable, ids: (number | null)[]): Promise<WorkFact[]> {
  const want = ids.filter((x): x is number => typeof x === "number");
  if (!want.length) return [];
  const rows = await db.execute<{
    kind: string;
    value: unknown;
    confidence: number | null;
    source_url: string | null;
    title: string | null;
    seen: unknown;
  }>(sql`
    select f.kind, f.value, f.confidence, f.source_url, d.title, f.observed_at seen
    from findings f left join documents d on d.id = f.document_id
    where f.id in ${sql.raw(`(${want.join(",")})`)}`);
  return rows.map(factOf);
}

/** A link the mask would change (a profile's name cut out) goes nowhere: keep the label, drop the link. */
export function unlinkMasked(view: WorkView, shown: (s: string) => string): WorkView {
  const fix = (p: WorkLink | null): WorkLink | null =>
    p?.href && shown(p.href) !== p.href ? { ...p, href: null } : p;
  return {
    ...view,
    steps: view.steps.map((s) => ({
      ...s,
      queryHref: s.queryHref && shown(s.queryHref) !== s.queryHref ? null : s.queryHref,
      page: fix(s.page),
      options: s.options.map((o) => ({ ...o, page: fix(o.page) ?? o.page })),
    })),
    facts: view.facts.map((f) => ({ ...f, page: fix(f.page) })),
  };
}

/** The work behind a line, or null when there's nothing kept for it. */
export async function portalWork(
  db: Queryable,
  q: {
    step: string;
    subject: string;
    operator: boolean;
    /** How the viewer sees a name: the demo masks surnames. */
    shown?: (name: string) => string;
  },
): Promise<WorkView | null> {
  if (!hasWork(q.step)) return null;
  const base = { step: q.step, subject: q.subject, reasons: [], facts: [], steps: [] };

  if (q.step === "signals") {
    const [r] = await db.execute<{
      tried: unknown;
      finding_id: number | null;
      at: unknown;
    }>(sql`
      with ${SUBJECTS}, firms as (select distinct company_id from subjects)
      select k.tried, k.finding_id, k.checked_at at
      from firms f
      join companies co on co.id = f.company_id
      join company_checks k on k.company_id = f.company_id
      where lower(coalesce(co.name, co.domain, 'A company')) = lower(${q.subject.trim()})
      order by k.checked_at desc limit 1`);
    if (!r) return null;
    const tried = triedOf(r.tried);
    return {
      ...base,
      personId: null,
      steps: withDetail(checkSteps(tried), tried, q.operator),
      facts: await factsOf(db, [r.finding_id]),
      at: iso(r.at),
    };
  }

  const p = await personOf(db, q.subject, q.shown ?? ((n) => n));
  if (!p) return null;
  const person = { ...base, personId: p.person_id };

  if (q.step === "lookup") {
    const [r] = await db.execute<{ tried: unknown; at: unknown }>(sql`
      select tried, looked_up_at at from person_lookups where person_id = ${p.person_id}`);
    const tried = triedOf(r?.tried);
    return {
      ...person,
      steps: withDetail(lookupSteps(tried), tried, q.operator),
      facts: await factsOf(db, [p.where_id]),
      at: iso(r?.at),
    };
  }

  if (q.step === "movers") {
    const [r] = await db.execute<{
      outcome: MoverOutcome;
      domain: string | null;
      finding_id: number;
      at: unknown;
    }>(sql`
      select outcome, domain, finding_id, tried_at at from mover_addresses
      where person_id = ${p.person_id} order by tried_at desc limit 1`);
    if (!r) return null;
    return {
      ...person,
      steps: [moverStep(r.outcome, r.domain)],
      facts: await factsOf(db, [r.finding_id]),
      at: iso(r.at),
    };
  }

  if (q.step === "score") {
    const [r] = await db.execute<{ reasons: unknown; at: unknown }>(sql`
      select reasons, computed_at at from contact_scores where person_id = ${p.person_id}`);
    const reasons = (Array.isArray(r?.reasons) ? (r.reasons as Reason[]) : [])
      .filter((x) => typeof x?.reason === "string" && typeof x.points === "number")
      .map((x) => ({ reason: x.reason, points: x.points }));
    return { ...person, reasons, at: iso(r?.at) };
  }

  if (q.step === "brief") {
    const [r] = await db.execute<{ n: number; at: unknown }>(sql`
      select count(*)::int n, max(observed_at) at from findings where person_id = ${p.person_id}`);
    return {
      ...person,
      steps: [
        step({
          icon: "write",
          did: "Wrote the brief from what we found",
          result: r?.n ? `${r.n} sourced ${r.n === 1 ? "fact" : "facts"} to draw on` : null,
        }),
      ],
      at: iso(r?.at),
    };
  }

  // compose
  return {
    ...person,
    steps: [
      step({ icon: "write", did: "Drafted the email from the brief", result: "Waits for your OK" }),
    ],
    at: null,
  };
}
