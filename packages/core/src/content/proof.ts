/**
 * Comment proof (designs/2026-10-14-comment-proof.md): is a comment we sent there for a
 * stranger? `CommentProof.check` answers with a `Proof`: live, hidden (only its author sees it),
 * missing (gone) or pending (no reader yet, or none answered). Two readers: the public,
 * signed-out one decides live; the account's own decides hidden versus missing. Every read goes
 * through the sites facade on the desk, in the platform's API shape (Reddit `GET /api/info`,
 * `GET /comments/{article}`; LinkedIn `GET /rest/socialActions/{urn}/comments`). The shot is
 * autobrowse's `web GET /proof/shot`, signed out, kept by `keep`.
 */
import type { SiteClient } from "./autobrowse.js";

export const PROOF_STATES = ["live", "hidden", "missing", "pending"] as const;
export type ProofState = (typeof PROOF_STATES)[number];

export interface Proof {
  state: ProofState;
  /** ISO time of the check. */
  checkedAt: string;
  /** The comment's permalink; the post's page when the comment has none. */
  url: string | null;
  /** The stored screenshot (`s3://…`): the comment with its post's title. */
  shot: string | null;
  /** Why, in a few words: "only visible signed in", "[removed] for strangers". */
  note: string | null;
}

export interface ProofTarget {
  platform: string;
  /** The comment's id: Reddit `t1_…`, a LinkedIn comment URN; null when the send kept none. */
  ref: string | null;
  /** What it answers: the post (Reddit `t3_…`, a LinkedIn activity URN) or a comment. */
  parent: string | null;
  /** The post's page, or the comment's own permalink. */
  url: string | null;
  /** What we wrote: found by its words where no id finds it. */
  text?: string | null;
  /** The login that sent it (`reddit@alt`): the read that sees what only its author does. */
  account?: string | null;
  /** The thread the comment is in, when `parent` is a comment (Reddit `t3_…`). */
  post?: string | null;
}

export interface CommentProof {
  check(target: ProofTarget): Promise<Proof>;
}

/** Keep a shot's JPEG; answers where it went (`s3://…`). */
export type KeepShot = (jpeg: Uint8Array) => Promise<string>;

export interface ProofDeps {
  sites: SiteClient;
  /** Unset, no shot is taken. */
  keep?: KeepShot;
  now?: () => Date;
  /** LinkedIn's signed-in reader when the target names none. */
  linkedinAccount?: string;
}

/** The first words of a comment, folded: what a page's text is searched for. */
export const wordsOf = (text: string, n = 60): string =>
  text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, n)
    .trim();

/** Whether `page` holds the comment `text`, by its first words. */
export const holds = (page: string, text: string): boolean => {
  const w = wordsOf(text);
  return w.length >= 12 && wordsOf(page, Number.POSITIVE_INFINITY).includes(w);
};

interface RedditThing {
  name?: string;
  id?: string;
  body?: string;
  author?: string;
  permalink?: string;
  link_id?: string;
  parent_id?: string;
  distinguished?: string | null;
  replies?: RedditListing | "";
  children?: string[];
}
interface RedditListing {
  data?: { children?: { kind?: string; data?: RedditThing }[] };
}

const GONE_BODY = new Set(["[removed]", "[deleted]", ""]);
/** Whether a stranger reads the comment's words, not a tombstone. */
export const readable = (t: RedditThing | null | undefined): boolean =>
  Boolean(t && !GONE_BODY.has((t.body ?? "").trim()) && t.author && t.author !== "[deleted]");

/** Every comment id in a thread's tree, and whether the tree leaves some out ("more"). */
export function idsIn(tree: RedditListing | undefined): { ids: Set<string>; partial: boolean } {
  const ids = new Set<string>();
  let partial = false;
  const walk = (l: RedditListing | "" | undefined) => {
    for (const c of (l ? l.data?.children : undefined) ?? []) {
      if (c.kind === "more") {
        partial = true;
        continue;
      }
      const d = c.data;
      if (!d) continue;
      if (d.name) ids.add(d.name);
      else if (d.id) ids.add(`t1_${d.id}`);
      walk(d.replies);
    }
  };
  walk(tree);
  return { ids, partial };
}

const MOD_NOTE_CHARS = 300;

/**
 * What a moderator or AutoModerator wrote under our comment: the reason it was removed, which
 * often states the floor ("account must be 10+ days old with 50+ karma"). Null when none did.
 */
export function modNoteIn(tree: RedditListing | undefined, ref: string): string | null {
  const id = ref.replace(/^t1_/, "");
  let found: string | null = null;
  const mod = (d: RedditThing) => d.author === "AutoModerator" || d.distinguished === "moderator";
  const walk = (l: RedditListing | "" | undefined, under: boolean) => {
    for (const c of (l ? l.data?.children : undefined) ?? []) {
      const d = c.data;
      if (!d || found) continue;
      if (under && mod(d) && (d.body ?? "").trim())
        found = `${d.author === "AutoModerator" ? "AutoModerator" : `mod ${d.author ?? ""}`.trim()}: "${(d.body ?? "").replace(/\s+/g, " ").trim().slice(0, MOD_NOTE_CHARS)}"`;
      else walk(d.replies, d.name === `t1_${id}` || d.id === id);
    }
  };
  walk(tree, false);
  return found;
}

export interface RedditReads {
  /** `/api/info` signed out. */
  open: RedditThing | null;
  /** In the signed-out thread: true, false, or null (not read, or the tree is cut). */
  inThread: boolean | null;
  /** `/api/info` as the account; undefined when not read. */
  own?: RedditThing | null;
}

/** The verdict from Reddit's reads. */
export function redditVerdict(r: RedditReads): { state: ProofState; note: string | null } {
  if (readable(r.open) && r.inThread !== false) return { state: "live", note: null };
  const why = readable(r.open)
    ? "found by id, not in the thread"
    : r.open
      ? `${(r.open.body ?? "").trim() || "empty"} for strangers`
      : "not found signed out";
  if (r.own === undefined) return { state: "pending", note: `${why}; no account read` };
  if (readable(r.own)) return { state: "hidden", note: `only visible signed in: ${why}` };
  return { state: "missing", note: r.own ? `${(r.own.body ?? "").trim()} to its author` : why };
}

const article = (id: string | null | undefined): string | null =>
  id ? (/^t3_([a-z0-9]+)$/i.exec(id)?.[1] ?? null) : null;

/** The comment's www permalink from its thing, else from the thread and its id. */
export function redditPermalink(t: ProofTarget, thing?: RedditThing | null): string | null {
  if (thing?.permalink) return `https://www.reddit.com${thing.permalink}`;
  const a = article(t.post ?? t.parent) ?? article(thing?.link_id);
  const c = t.ref?.replace(/^t1_/, "");
  return a && c ? `https://www.reddit.com/comments/${a}/comment/${c}/` : t.url;
}

/** LinkedIn's verdict once the public page did not show it: `loaded` it, `own` the author's read. */
export function linkedinVerdict(
  loaded: boolean,
  own: boolean | null,
): { state: ProofState; note: string } {
  const why = loaded ? "not on the public page" : "the public page did not load";
  if (own === null) return { state: "pending", note: `${why}; the account read failed` };
  if (!own) return { state: "missing", note: `${why}, nor to its author` };
  return loaded
    ? { state: "hidden", note: `only visible signed in: ${why}` }
    : { state: "pending", note: `${why}; its author sees it` };
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 160);

interface Shot {
  found?: boolean;
  jpeg?: string;
}

export function siteProof(deps: ProofDeps): CommentProof {
  const { sites } = deps;
  const now = () => (deps.now ?? (() => new Date()))().toISOString();

  /** The signed-out screenshot, kept; a failure is a note, never a failed check. */
  async function shoot(
    url: string | null,
    find: { ref?: string; text?: string },
  ): Promise<{ shot: string | null; seen: boolean | null; why: string | null }> {
    if (!deps.keep || !url) return { shot: null, seen: null, why: null };
    try {
      const r = await sites.call<Shot>("web", "GET", "/proof/shot", { url, ...find });
      if (!r.jpeg) return { shot: null, seen: r.found ?? null, why: "no shot" };
      return {
        shot: await deps.keep(Uint8Array.from(Buffer.from(r.jpeg, "base64"))),
        seen: r.found ?? null,
        why: null,
      };
    } catch (e) {
      return { shot: null, seen: null, why: `no shot: ${message(e)}` };
    }
  }

  async function reddit(t: ProofTarget): Promise<Proof> {
    if (!t.ref) return pending(t, "the send kept no comment id");
    const info = (site: string, account?: string) =>
      sites
        .call<RedditListing>(site, "GET", "/api/info", { id: t.ref, raw_json: 1 }, account)
        .then((l) => l.data?.children?.[0]?.data ?? null);
    let open: RedditThing | null;
    try {
      open = await info("reddit-public");
    } catch (e) {
      return pending(t, `the public read failed: ${message(e)}`);
    }
    const a = article(t.post ?? t.parent) ?? article(open?.link_id);
    let inThread: boolean | null = null;
    if (readable(open) && a)
      inThread = await sites
        .call<[RedditListing, RedditListing]>("reddit-public", "GET", `/comments/${a}`, {
          limit: 500,
          raw_json: 1,
        })
        .then(([, tree]) => {
          const { ids, partial } = idsIn(tree);
          return ids.has(t.ref as string) ? true : partial ? null : false;
        })
        .catch(() => null);
    const own =
      readable(open) && inThread !== false
        ? undefined
        : t.account
          ? await info("reddit", t.account).catch(() => undefined)
          : undefined;
    const v = redditVerdict({ open, inThread, ...(own !== undefined ? { own } : {}) });
    // A removal's reason is the moderator's reply under our comment; the send gate reads it.
    const why =
      (v.state === "hidden" || v.state === "missing") && a
        ? await sites
            .call<[RedditListing, RedditListing]>("reddit-public", "GET", `/comments/${a}`, {
              limit: 500,
              raw_json: 1,
            })
            .then(([, tree]) => modNoteIn(tree, t.ref as string))
            .catch(() => null)
        : null;
    if (why) v.note = join(v.note, why);
    const url = redditPermalink(t, open ?? own);
    // www, not old.reddit: old.reddit sends a signed-out reader to its login wall.
    const s = await shoot(url, { ref: t.ref });
    return { state: v.state, checkedAt: now(), url, shot: s.shot, note: join(v.note, s.why) };
  }

  async function linkedin(t: ProofTarget): Promise<Proof> {
    if (!t.text || !t.url) return pending(t, "no words or post page to find it by");
    const text = t.text;
    const page = await sites
      .call<{ text?: string }>("web", "GET", "/read", { url: t.url })
      .then((r) => r.text ?? "")
      .catch(() => null);
    // The desk's own signed-out page backs the reader: a page Jina could not fetch may still show it.
    const s = await shoot(t.url, { text });
    if ((page !== null && holds(page, text)) || s.seen === true)
      return { state: "live", checkedAt: now(), url: t.url, shot: s.shot, note: s.why };
    const urn = t.post ?? t.parent;
    const own = urn
      ? await sites
          .call<{ elements?: { commentUrn?: string; message?: { text?: string } }[] }>(
            "linkedin",
            "GET",
            `/rest/socialActions/${encodeURIComponent(urn)}/comments`,
            { count: 100, start: 0 },
            t.account ?? deps.linkedinAccount,
          )
          .then((r) =>
            (r.elements ?? []).some(
              (e) => (t.ref && e.commentUrn === t.ref) || holds(e.message?.text ?? "", text),
            ),
          )
          .catch(() => null)
      : null;
    const v = linkedinVerdict(page !== null, own);
    return {
      state: v.state,
      checkedAt: now(),
      url: t.url,
      shot: s.shot,
      note: join(v.note, s.why),
    };
  }

  const pending = (t: ProofTarget, note: string): Proof => ({
    state: "pending",
    checkedAt: now(),
    url: t.url,
    shot: null,
    note,
  });

  return {
    async check(t) {
      if (t.platform === "reddit") return reddit(t);
      if (t.platform === "linkedin") return linkedin(t);
      return pending(t, `no reader for ${t.platform} yet`);
    },
  };
}

const join = (a: string | null, b: string | null): string | null =>
  [a, b].filter(Boolean).join("; ") || null;
