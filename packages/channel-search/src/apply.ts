/**
 * Proposals onto the site's source files, for a pull request a person reads.
 * A proposal applies only when its quoted text appears exactly once across
 * the files: zero means the words live elsewhere (a template, a composed
 * title), two means a guess. Those, and new FAQs and pages, go to the
 * request's body to do by hand.
 */
import type { SearchProposal } from "./schema.js";

export interface SourceFile {
  path: string;
  text: string;
}

export interface Applied {
  /** The files that changed, with their new text. */
  files: SourceFile[];
  applied: SearchProposal[];
  byHand: Array<{ proposal: SearchProposal; reason: string }>;
}

const count = (text: string, part: string) => text.split(part).length - 1;

export function applyProposals(
  sources: readonly SourceFile[],
  proposals: readonly SearchProposal[],
): Applied {
  const files = new Map(sources.map((f) => [f.path, f.text]));
  const changed = new Set<string>();
  const out: Applied = { files: [], applied: [], byHand: [] };
  for (const p of proposals) {
    if (!p.current) {
      out.byHand.push({
        proposal: p,
        reason: p.kind === "page" ? "a new page" : "new text to place",
      });
      continue;
    }
    const hits = [...files].filter(([, text]) => text.includes(p.current));
    const total = hits.reduce((n, [, text]) => n + count(text, p.current), 0);
    const only = hits[0];
    if (total !== 1 || !only) {
      out.byHand.push({
        proposal: p,
        reason: total ? `quoted text found ${total} times` : "quoted text not in the source",
      });
      continue;
    }
    files.set(
      only[0],
      only[1].replace(p.current, () => p.proposed),
    );
    changed.add(only[0]);
    out.applied.push(p);
  }
  out.files = [...changed].map((path) => ({ path, text: files.get(path) ?? "" }));
  return out;
}

/** The pull request's body: what changed and why, then what is left by hand. */
export function pullRequestBody(a: Applied): string {
  const item = (p: SearchProposal) =>
    [
      `**#${p.id} ${p.kind} on ${p.page}** (${p.keywords.map((k) => `"${k}"`).join(", ") || "no keyword"})`,
      p.why,
      ...(p.current ? [`- was: ${p.current}`] : []),
      `- now: ${p.proposed.replace(/\n/g, "\n  ")}`,
    ].join("\n");
  return [
    "Search proposals from `wren search`: the weekly read of Search Console and the answer engines.",
    "",
    `## Applied (${a.applied.length})`,
    ...a.applied.map(item),
    ...(a.byHand.length
      ? [
          "",
          `## By hand (${a.byHand.length})`,
          ...a.byHand.map((b) => `${item(b.proposal)}\n- left: ${b.reason}`),
        ]
      : []),
  ].join("\n\n");
}
