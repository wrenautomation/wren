/**
 * Why something failed, as people read it: "web GET /exa/companies: 502 Failed to reach
 * environment" becomes "Exa search failed (502)", "author is empty on 1 of 1 rows" becomes
 * "Came back without author (1 of 1)". The raw reason stays in a tooltip and the detail.
 */
import { codeLabel } from "./template-labels.js";

/** A site or path as the thing it is: `fb-public` reads, `exa` searches. */
const NAMES: Readonly<Record<string, string>> = {
  exa: "Exa search",
  "fb-public": "Facebook read",
  "ig-public": "Instagram read",
  reddit: "Reddit read",
  youtube: "YouTube read",
  linkedin: "LinkedIn read",
  x: "X read",
  tiktok: "TikTok read",
  meta: "Meta call",
  cohere: "Cohere call",
  gateway: "Model call",
};

/** "author is empty on 1 of 3 rows": a read that came back without one of its fields. */
const EMPTY = /([a-z][\w ]*?) is empty on (\d+) of (\d+) rows?/i;
/** "web GET /exa/companies: 502 …": a call to a site, its path and status. */
const CALL = /^([\w.-]+) (GET|POST|PUT|PATCH|DELETE) (\S+?):? (\d{3})\b/;

function nameOf(site: string, verb: string, path: string): string {
  const head = site === "web" ? (path.split("/").find(Boolean) ?? site) : site;
  return NAMES[head] ?? `${codeLabel(head)} ${verb === "GET" ? "read" : "call"}`;
}

function statusOf(status: number): string {
  if (status === 429) return "hit its rate limit";
  if (status === 401 || status === 403) return `was refused (${status})`;
  if (status === 404) return "found nothing (404)";
  return `failed (${status})`;
}

export function reasonLabel(reason: string): string {
  const raw = reason.trim();
  if (!raw) return reason;
  const empty = EMPTY.exec(raw);
  const without = empty ? `without ${empty[1]} (${empty[2]} of ${empty[3]})` : null;
  const call = CALL.exec(raw);
  if (call) {
    const name = nameOf(call[1] as string, call[2] as string, call[3] as string);
    return without ? `${name} came back ${without}` : `${name} ${statusOf(Number(call[4]))}`;
  }
  if (without) return `Came back ${without}`;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}
