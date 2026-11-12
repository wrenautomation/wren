/**
 * A points list (`topic extract`'s answer) ⇄ findings. Each `- ` line is one point; the lines between
 * points (a worked example, a fenced email) are one passage; headings are the section each sits in.
 * `pointsText(pointsOf(md))` gives the same text back, blank lines aside.
 */

export interface Point {
  form: "point" | "passage";
  /** The heading line(s) it sits under; stacked headings with nothing between join into one. */
  section: string | null;
  text: string;
  /** A `- !` line: William's must-appear mark. */
  must: boolean;
}

export function pointsOf(md: string): Point[] {
  const out: Point[] = [];
  let section: string | null = null;
  let passage: string[] | null = null;
  let fence = false;
  let bare = false;
  const flush = () => {
    if (passage?.some((l) => l.trim())) {
      while (!passage.at(-1)?.trim()) passage.pop();
      while (!passage[0]?.trim()) passage.shift();
      out.push({ form: "passage", section, text: passage.join("\n"), must: false });
      bare = false;
    }
    passage = null;
  };
  for (const line of md.split("\n")) {
    const tick = line.startsWith("```");
    if (tick) fence = !fence;
    if (!fence && !tick) {
      if (/^#{1,6} /.test(line)) {
        flush();
        section = bare && section ? `${section}\n\n${line}` : line;
        bare = true;
        continue;
      }
      if (line.startsWith("- ")) {
        flush();
        const must = line.startsWith("- !");
        out.push({ form: "point", section, text: line.slice(must ? 3 : 2), must });
        bare = false;
        continue;
      }
      if (!line.trim() && !passage) continue;
    }
    passage ??= [];
    passage.push(line);
  }
  flush();
  return out;
}

export function pointsText(points: Point[]): string {
  const lines: string[] = [];
  let section: string | null | undefined;
  for (const p of points) {
    if (p.section !== section) {
      if (p.section) lines.push("", p.section, "");
      section = p.section;
    }
    if (p.form === "passage") lines.push("", p.text, "");
    else lines.push(`- ${p.must ? "!" : ""}${p.text}`);
  }
  return `${lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()}\n`;
}

/** The first time cited in a point: `[youtube-abc 1:02]` → `1:02`. */
export const atOf = (text: string) =>
  text.match(/\[[a-z]+-[A-Za-z0-9_-]+ ((?:\d{1,2}:\d{2}(?::\d{2})?)(?:, [\d:]+)*|caption)\]/)?.[1];

/** A point's title: its words without cites or marks, at most 120 characters. */
export const pointTitle = (p: Point, fallback: string) =>
  (
    p.text
      .replace(/\s*\[[a-z]+-[A-Za-z0-9_-]+[^\]]*\]/g, "")
      .replace(/[*`]/g, "")
      .replace(/\s+/g, " ")
      .trim() ||
    p.section?.split("\n").at(-1)?.replace(/^#+ /, "") ||
    fallback
  ).slice(0, 120);
