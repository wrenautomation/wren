/**
 * `flag_days` (`@wren/core/schema`): each site flag's variants per day of first exposure and
 * first-touch channel. A visitor counts once per flag, under the variant the edge first showed
 * them (`exp.seen`, only with the cookie yes, so always a visitor id), and is a form or a call
 * when they went on to one after that. Re-read whole each pass and upserted, as `site_days`.
 */
import type { SiteApplication, SiteEvent, SiteHit } from "@wren/channel-email";
import { touchChannel } from "@wren/core/clients";
import type { FlagDay } from "@wren/core/schema";
import type { BookedCall } from "./site-days.js";

export type FlagDayRow = Omit<FlagDay, "syncedAt">;

const KEY = /^[a-z][a-z0-9_.-]{0,59}$/;
const VARIANT = /^[a-z][a-z0-9_-]{0,39}$/;

const seenOf = (e: SiteEvent): { flag: string; variant: string } | null => {
  try {
    const p = JSON.parse(e.props) as { flag?: unknown; variant?: unknown };
    return typeof p.flag === "string" &&
      KEY.test(p.flag) &&
      typeof p.variant === "string" &&
      VARIANT.test(p.variant)
      ? { flag: p.flag, variant: p.variant }
      : null;
  } catch {
    return null;
  }
};

/** Each visitor's first-touch channel, from their hits in order (`site_days` counts the same way). */
function channels(hits: readonly SiteHit[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const h of [...hits].sort((a, b) => a.id - b.id)) {
    if (!h.visitor || out.has(h.visitor) || !(h.r || h.utm_source || h.ref)) continue;
    out.set(h.visitor, touchChannel(h as unknown as Record<string, unknown>)?.channel ?? "other");
  }
  return out;
}

/** Day rows from every exposure, and what those visitors did after it. */
export function rollupFlags(
  exposures: readonly SiteEvent[],
  hits: readonly SiteHit[],
  applications: readonly SiteApplication[],
  calls: readonly BookedCall[] = [],
): FlagDayRow[] {
  const first = new Map<string, { flag: string; variant: string; visitor: string; ts: string }>();
  for (const e of [...exposures].sort((a, b) => a.id - b.id)) {
    const s = e.visitor ? seenOf(e) : null;
    if (!s || !e.visitor || first.has(`${s.flag}|${e.visitor}`)) continue;
    first.set(`${s.flag}|${e.visitor}`, { ...s, visitor: e.visitor, ts: e.ts });
  }
  const forms = new Map<string, string[]>();
  const byEmail = new Map<string, string>();
  for (const a of applications) {
    if (!a.visitor) continue;
    forms.set(a.visitor, [...(forms.get(a.visitor) ?? []), a.ts]);
    const email = a.email?.trim().toLowerCase();
    if (email && !byEmail.has(email)) byEmail.set(email, a.visitor);
  }
  // A call's visitor: by its link's email code (every visitor who arrived on it), else its email.
  const byCode = new Map<string, Set<string>>();
  for (const h of hits)
    if (h.r && h.visitor) byCode.set(h.r, (byCode.get(h.r) ?? new Set()).add(h.visitor));
  const called = new Map<string, string[]>();
  for (const c of calls) {
    const who = c.code
      ? [...(byCode.get(c.code) ?? [])]
      : [byEmail.get(c.email?.trim().toLowerCase() ?? "")].filter((v): v is string => !!v);
    for (const v of who) called.set(v, [...(called.get(v) ?? []), c.day]);
  }
  const touch = channels(hits);
  const rows = new Map<string, FlagDayRow>();
  for (const s of first.values()) {
    const day = s.ts.slice(0, 10);
    const channel = touch.get(s.visitor) ?? "direct";
    const key = `${s.flag}|${day}|${s.variant}|${channel}`;
    let r = rows.get(key);
    if (!r) {
      r = {
        flag: s.flag,
        day,
        variant: s.variant,
        channel,
        visitors: 0,
        forms: 0,
        calls: 0,
        paid: 0,
      };
      rows.set(key, r);
    }
    r.visitors += 1;
    if (forms.get(s.visitor)?.some((ts) => ts >= s.ts)) r.forms += 1;
    if (called.get(s.visitor)?.some((d) => d >= day)) r.calls += 1;
    // ponytail: paid stays 0 until an engagement carries its visitor (it has a channel only).
  }
  return [...rows.values()].sort((a, b) =>
    a.flag === b.flag ? (a.day < b.day ? -1 : a.day > b.day ? 1 : 0) : a.flag < b.flag ? -1 : 1,
  );
}
