/**
 * A study as markdown: each angle's claims with [n] marks and his calls, the
 * drafts that cite them, then every source once. Pure: studyView reads, this
 * writes.
 */
import type { StudyView } from "./run.js";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function studyReport(view: StudyView): string {
  const { study, angles, drafts, titles, manual, counts } = view;
  const claims = angles.flatMap((a) => a.claims);
  const dropped = claims.filter((c) => c.call === "drop").length;
  const open = counts.waiting + drafts.filter((d) => !d.done || d.stale).length;
  const out: string[] = [
    `# ${study.question}`,
    "",
    `Study \`${study.slug}\`${study.niche ? ` for ${study.niche}` : ""}. ${plural(counts.queries, "search", "searches")}, ${plural(counts.pages, "page")} read (${counts.unread} unreadable), ${plural(claims.length, "claim")} passed the quote check (${counts.gated} did not), ${dropped} dropped by you.${open ? ` ${plural(open, "part")} still to run: \`wren study run ${study.slug}\`.` : ""}`,
  ];

  for (const a of angles) {
    out.push("", `## ${a.angle}`, "");
    if (!a.claims.length)
      out.push(
        counts.waiting || !counts.pages
          ? "_Not run yet._"
          : "_Nothing on the pages read answered this._",
      );
    for (const c of a.claims) {
      const call = c.call ? ` (${c.call}${c.comment ? `: ${c.comment}` : ""})` : "";
      const line = `${c.claim} [${c.n}]${call}`;
      out.push(c.call === "drop" ? `- ~~${line}~~` : `- ${line}`);
    }
  }

  for (const d of drafts) {
    out.push("", `## Draft: ${d.spec.key}`, "");
    if (!d.done) out.push("_Not run yet._");
    else if (d.stale)
      out.push(
        `_Your calls or new claims changed its claims: \`wren study run ${study.slug}\`._`,
        "",
      );
    if (d.done && !d.kept.length) out.push("_Nothing survived the citation check._");
    for (const item of d.kept) {
      out.push(
        `### ${item.title || "(untitled)"}`,
        "",
        item.body,
        "",
        `Cites ${item.cites.map((n) => `[${n}]`).join(" ")}`,
        "",
      );
    }
    if (d.dropped.length) {
      out.push(
        `_Dropped: ${d.dropped.map((x) => `${x.title || "(untitled)"} (${x.why.replace(/_/g, " ")})`).join("; ")}._`,
      );
    }
  }

  if (claims.length) {
    out.push("", "## Sources", "");
    for (const c of claims) {
      const title = titles.get(c.source_url);
      const m = manual?.get(c.source_url);
      const held = m
        ? ` (added by hand by ${m.by} on ${m.at.slice(0, 10)}${m.published ? `, published ${m.published}` : ""})`
        : "";
      out.push(`${c.n}. ${title ? `${title}, ` : ""}<${c.source_url}>${held}: "${c.quote}"`);
    }
  }
  return `${out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()}\n`;
}
