/** The Map's boxes from the catalog's rows: pure, so it tests without a browser. */
import type { Row } from "@wren/core/records/serve";
import type { MapBox } from "@wren/ui";

const ACCOUNTS: Record<string, string> = {
  gmail: "Gmail",
  linkedin: "LinkedIn",
  calcom: "cal.com",
  telnyx: "Telnyx",
  meta: "Meta",
};

/**
 * The connected parts and their accounts as boxes, in groups that share no line, biggest
 * first, and the parts nothing touches.
 */
export function mapOf(rows: readonly Row[], at: (id: string) => string) {
  const ids = new Set(rows.map((r) => String(r.id)));
  const after = new Map(
    rows.map((r) => [
      String(r.id),
      String(r.needs ?? "")
        .split(", ")
        .filter(Boolean)
        .map((n) => (ids.has(n) ? n : `@${n}`)),
    ]),
  );
  const used = new Set([...after.values()].flat());
  const linked = (id: string) => used.has(id) || !!after.get(id)?.length;
  const accounts = [...used]
    .filter((n) => n.startsWith("@"))
    .map((n): MapBox => {
      const site = n.slice(1);
      return { id: n, label: `${ACCOUNTS[site] ?? site} account`, after: [], input: true };
    });
  const parts = rows.map((r): MapBox => {
    const id = String(r.id);
    return {
      id,
      label: String(r.name),
      note:
        r.installed === "yes"
          ? "Installed"
          : r.ready === "coming"
            ? "Coming"
            : r.for === "wren"
              ? "Wren's own"
              : undefined,
      after: after.get(id) ?? [],
      href: at(id),
      dim: r.installed === "no",
    };
  });
  // Accounts last: a column lists its parts first, so fewer lines cross.
  const boxes = [...parts.filter((b) => linked(b.id)), ...accounts];
  const near = new Map(boxes.map((b) => [b.id, new Set(b.after)]));
  for (const b of boxes) for (const a of b.after) near.get(a)?.add(b.id);
  const seen = new Set<string>();
  const groups: MapBox[][] = [];
  for (const b of boxes) {
    if (seen.has(b.id)) continue;
    const group = new Set([b.id]);
    for (const id of group) for (const n of near.get(id) ?? []) group.add(n);
    for (const id of group) seen.add(id);
    groups.push(boxes.filter((x) => group.has(x.id)));
  }
  return {
    groups: groups.sort((a, b) => b.length - a.length),
    alone: parts.filter((b) => !linked(b.id)),
  };
}
