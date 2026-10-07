/**
 * Template paths as people read them: a folder or name part ("sec_ria", "book-first") becomes a
 * label ("SEC RIA", "Book first"). Pure, so the Library and the CLI share it. The ref itself
 * (`email:recruiting/book-first/opener`) stays what Claude Code and the CLI take.
 */

/** Parts said letter by letter. */
const UPPER: ReadonlySet<string> = new Set([
  "ai",
  "cpa",
  "crm",
  "cta",
  "dm",
  "faq",
  "ps",
  "ria",
  "sec",
  "seo",
  "sms",
  "url",
]);

/** Parts spelled another way in prose. */
const SPELLED: Readonly<Record<string, string>> = {
  followup: "follow-up",
  linkedin: "LinkedIn",
  youtube: "YouTube",
};

/** One path part as a label: "sec_ria" to "SEC RIA", "final_followup" to "Final follow-up". */
export function labelOf(part: string): string {
  const words = part
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => {
      const low = w.toLowerCase();
      return UPPER.has(low) ? low.toUpperCase() : (SPELLED[low] ?? low);
    });
  const [first, ...rest] = words;
  if (first === undefined) return part;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
}

/** A template's own label: the last part of its name ("book-first/opener" to "Opener"). */
export const nameLabel = (name: string): string => labelOf(name.slice(name.lastIndexOf("/") + 1));

/**
 * A folder as a trail of labels, leaving out the part already shown (`from`, the open folder):
 * "recruiting/book-first" under "recruiting" is "Book first"; under all it is
 * "Recruiting / Book first"; the open folder itself is "".
 */
export function folderLabel(path: string, from = ""): string {
  const rest =
    !from || !path
      ? path
      : path === from
        ? ""
        : path.startsWith(`${from}/`)
          ? path.slice(from.length + 1)
          : path;
  return rest ? rest.split("/").map(labelOf).join(" / ") : "";
}
