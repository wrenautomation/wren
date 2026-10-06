/**
 * A build log idea: the last day's commit subjects in Wren's public repos, for an honest
 * build post (10-05: "posts give value with a small ask, plus honest build posts"). Read through
 * GitHub's public commits API, unauthenticated (60 calls an hour; this makes 3 a day). No secret.
 */
import type { Queryable } from "@wren/db";
import { addIdeaOnce, hasIdeaRef } from "../ideas.js";
import type { ContentIdea } from "../schema.js";

export const PUBLIC_REPOS = [
  "wrenautomation/wren",
  "wrenautomation/autobrowse",
  "wrenautomation/lander",
] as const;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LINES = 40;

export interface Commit {
  repo: string;
  subject: string;
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Commit subjects since `since`, newest first per repo; merges dropped. A repo that fails is named in `errors`. */
export async function commitsSince(
  since: Date,
  o: { repos?: readonly string[]; fetch?: Fetch } = {},
): Promise<{ commits: Commit[]; errors: string[] }> {
  const get = o.fetch ?? fetch;
  const commits: Commit[] = [];
  const errors: string[] = [];
  for (const repo of o.repos ?? PUBLIC_REPOS) {
    const url = `https://api.github.com/repos/${repo}/commits?since=${since.toISOString()}&per_page=100`;
    try {
      const res = await get(url, {
        headers: { accept: "application/vnd.github+json", "user-agent": "wren-content-planner" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = (await res.json()) as { commit?: { message?: string } }[];
      for (const r of rows) {
        const subject = (r.commit?.message ?? "").split("\n")[0]?.trim() ?? "";
        if (subject && !subject.startsWith("Merge ")) commits.push({ repo, subject });
      }
    } catch (err) {
      errors.push(`${repo}: ${(err as Error).message}`);
    }
  }
  return { commits, errors };
}

export function buildLogText(commits: readonly Commit[]): string {
  const lines = commits
    .slice(0, MAX_LINES)
    .map((c) => `- ${c.repo.split("/")[1]}: ${c.subject.slice(0, 200)}`);
  return `Build log: what shipped in Wren's public repos in the last day. Write an honest build post about the one or two changes a business owner would care about most, and why. Skip the rest; name no commit hashes.
${lines.join("\n")}`;
}

/** Today's build log idea, once per day; null when it exists already or nothing shipped. */
export async function buildLogIdea(
  db: Queryable,
  now: Date,
  day: string,
  o: { repos?: readonly string[]; fetch?: Fetch } = {},
): Promise<{ idea: ContentIdea | null; errors: string[] }> {
  const ref = `build_log:${day}`;
  if (await hasIdeaRef(db, ref)) return { idea: null, errors: [] };
  const { commits, errors } = await commitsSince(new Date(now.getTime() - DAY_MS), o);
  if (commits.length === 0) return { idea: null, errors };
  return { idea: await addIdeaOnce(db, buildLogText(commits), "build_log", ref), errors };
}
