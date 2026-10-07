/**
 * Names as people read them: a folder, name part or niche ("sec_ria", "book-first") becomes a
 * label ("SEC RIA", "Book first"). The Library, the CLI and record rows share it. The ref itself
 * (`email:recruiting/book-first/opener`) stays what Claude Code and the CLI take.
 *
 * A part with its own label (each niche's, from `@wren/niches`) reads as that label. Core sits
 * below the niches, so they hand their labels in when loaded (`nameParts`), and the Library gets
 * them with its list.
 */

/** Whole parts with their own label: "sec_ria" to "SEC RIA". */
const NAMED = new Map<string, string>();

/** Gives these parts their own labels: a niche's name to its label. */
export function nameParts(labels: Readonly<Record<string, string>>): void {
  for (const [part, label] of Object.entries(labels)) NAMED.set(part, label);
}

/** Every part with its own label, to hand to a page that labels without the niches. */
export const namedParts = (): Record<string, string> => Object.fromEntries(NAMED);

/** Parts said letter by letter. */
const UPPER: ReadonlySet<string> = new Set([
  "ai",
  "cli",
  "cpa",
  "crm",
  "cta",
  "dm",
  "dns",
  "faq",
  "fb",
  "ps",
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
  const named = NAMED.get(part);
  if (named) return named;
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

/**
 * A name from code as words: a service ("AdsWatch" to "Ads watch"), a stage
 * ("research.exa-search" to "Research: Exa search") or a key ("sec_ria" to "SEC RIA").
 * Its parts read as `labelOf` reads them.
 */
export function codeLabel(name: string): string {
  const [head = "", ...rest] = name
    .split(/[./]/)
    .map((p) => p.replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim())
    .filter(Boolean);
  const first = labelOf(head);
  return rest.length ? `${first}: ${rest.map(labelOf).join(" ")}` : first;
}

/** A sequence's name as words: "build-days-0-3-7" to "Build, days 0, 3, 7". */
export const sequenceLabel = (name: string): string =>
  labelOf(name).replace(/ days ((?:\d+ )*\d+)$/, (_, d: string) => `, days ${d.split(" ").join(", ")}`);

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
