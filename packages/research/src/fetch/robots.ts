/**
 * robots.txt reading, shared by every page-fetching consumer.
 *
 * The policy that binds a fetch is the one on the HOST actually being fetched, over
 * the SCHEME actually in use: apex and www can serve different files, so policies
 * are cached per scheme+host and fetched over the URL's own scheme.
 *
 * Absence semantics follow RFC 9309: a missing robots.txt (404, or a dead host)
 * means everything is allowed, but a server that ANSWERED 5xx is saying
 * "unavailable", which means full disallow.
 *
 * Matching mirrors Python's urllib.robotparser (what the legacy crawler honored):
 * the first group whose agent token is a substring of our product token applies,
 * else the `*` group; within a group the first rule whose path prefix matches wins.
 */
import { FetchError, type Fetcher } from "./fetcher.js";

interface Rule {
  path: string;
  allow: boolean;
}
interface Group {
  agents: string[];
  rules: Rule[];
}

export class RobotsPolicy {
  private constructor(
    private readonly groups: readonly Group[],
    private readonly disallowAll: boolean,
  ) {}

  static allowAll(): RobotsPolicy {
    return new RobotsPolicy([], false);
  }
  static disallowAll(): RobotsPolicy {
    return new RobotsPolicy([], true);
  }

  static parse(text: string): RobotsPolicy {
    const groups: Group[] = [];
    let current: Group | null = null;
    let sawRule = false;
    for (const rawLine of text.split(/\r?\n/)) {
      const hash = rawLine.indexOf("#");
      const line = (hash >= 0 ? rawLine.slice(0, hash) : rawLine).trim();
      if (!line) {
        if (current && sawRule) {
          groups.push(current);
          current = null;
          sawRule = false;
        }
        continue;
      }
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const key = line.slice(0, colon).trim().toLowerCase();
      const value = line.slice(colon + 1).trim();
      if (key === "user-agent") {
        if (current && sawRule) {
          groups.push(current);
          current = null;
          sawRule = false;
        }
        current = current ?? { agents: [], rules: [] };
        current.agents.push(value.toLowerCase());
      } else if (key === "allow" || key === "disallow") {
        if (!current) continue;
        sawRule = true;
        const allow = key === "allow" || value === "";
        current.rules.push({ path: normalizePath(value), allow });
      }
    }
    if (current) groups.push(current);
    return new RobotsPolicy(groups, false);
  }

  canFetch(userAgent: string, url: string): boolean {
    if (this.disallowAll) return false;
    const token = (userAgent.split("/")[0] ?? "").toLowerCase();
    const group =
      this.groups.find((g) => g.agents.some((a) => a !== "*" && token.includes(a))) ??
      this.groups.find((g) => g.agents.includes("*"));
    if (!group) return true;
    const target = targetPath(url);
    for (const rule of group.rules) {
      if (rule.path === "*" || target.startsWith(rule.path)) return rule.allow;
    }
    return true;
  }
}

function normalizePath(value: string): string {
  if (value === "*") return "*";
  try {
    return encodeURI(decodeURI(value));
  } catch {
    return value;
  }
}

function targetPath(url: string): string {
  try {
    const u = new URL(url);
    const path = `${u.pathname}${u.search}`;
    return encodeURI(decodeURI(path)) || "/";
  } catch {
    return "/";
  }
}

export type RobotsCache = Map<string, RobotsPolicy>;

/** The robots policy for this url's scheme+host, fetched once each. */
export async function robotsFor(
  fetcher: Fetcher,
  url: string,
  cache: RobotsCache,
): Promise<RobotsPolicy> {
  let key: string;
  try {
    const u = new URL(url);
    key = `${u.protocol}//${u.host}`;
  } catch {
    key = `https://${url}`;
  }
  const hit = cache.get(key);
  if (hit) return hit;
  let policy: RobotsPolicy;
  try {
    const resp = await fetcher.get(`${key}/robots.txt`);
    policy = resp.status === 200 ? RobotsPolicy.parse(resp.text) : RobotsPolicy.allowAll();
  } catch (err) {
    if (err instanceof FetchError && err.status !== null && err.status >= 500) {
      policy = RobotsPolicy.disallowAll(); // "unavailable" is not "absent"
    } else if (err instanceof FetchError) {
      policy = RobotsPolicy.allowAll(); // unreachable host: the web's allow default
    } else {
      throw err;
    }
  }
  cache.set(key, policy);
  return policy;
}

export async function canFetch(
  fetcher: Fetcher,
  url: string,
  cache: RobotsCache,
): Promise<boolean> {
  return (await robotsFor(fetcher, url, cache)).canFetch(fetcher.userAgent, url);
}
