/**
 * The facts list as plain data: its caps, the default, and the checks and counts its editor and
 * its record share. No imports, so the portal's bundle takes it as is (`./facts.ts` holds the
 * schema, the store and the prompt).
 */

/** A fact is one plain line in his words. */
export const FACT_MAX = 300;
/** Facts in a list, at most. */
export const FACTS_CAP = 40;
/** Where the list is edited in the portal (Marketing → Facts). */
export const FACTS_PAGE = "/marketing/facts";
/** How the guard's reason for a dropped draft starts (`droppedWhy`): the page links it here. */
export const FACTS_DROP = "made things up: ";

export const DEFAULT_FACTS: readonly string[] = [
  "I'm William, the founder of Wren Automation, a one-person automation agency.",
  "I built Wren's cold email system: it finds leads, checks each address, writes each email, sends from a fleet of inboxes and reads the replies.",
  "I built autobrowse, a browser automation tool on npm that signs in to sites and runs tasks on them.",
  "I built a lead reactivation product: it researches a business's old CRM contacts and drafts messages to win them back.",
  "I built a content loop: it drafts posts from my notes and my commits, I approve each one, then it posts.",
  "I built a client portal where clients see their drafts and approve them before anything sends.",
  "Wren's code is public on GitHub.",
];

/** The list as its record keeps it: one fact a line. */
export const factsText = (facts: readonly string[]): string => facts.join("\n");

/** A record's text back to the list: each line trimmed, blank lines dropped. */
export const factsOf = (text: string): string[] =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/** What stops a list from saving, in words; null when it saves. Blank rows are dropped first. */
export function factsProblem(facts: readonly string[]): string | null {
  const kept = facts.map((f) => f.trim()).filter(Boolean);
  if (kept.length > FACTS_CAP) return `${FACTS_CAP} facts at most; this has ${kept.length}`;
  const long = facts.findIndex((f) => f.trim().length > FACT_MAX);
  if (long >= 0) return `Fact ${long + 1} is over ${FACT_MAX} characters`;
  const seen = new Set<string>();
  for (const [i, f] of facts.entries()) {
    const k = f.trim().toLowerCase();
    if (!k) continue;
    if (seen.has(k)) return `Fact ${i + 1} says the same as one above it`;
    seen.add(k);
  }
  return null;
}

/** What a change did, counted: facts added, removed, and whether the rest moved. */
export interface FactsChange {
  added: string[];
  removed: string[];
  reordered: boolean;
}

export function factsChange(before: readonly string[], after: readonly string[]): FactsChange {
  const left = new Set(before);
  const right = new Set(after);
  const added = after.filter((f) => !left.has(f));
  const removed = before.filter((f) => !right.has(f));
  const kept = (list: readonly string[], other: Set<string>) => list.filter((f) => other.has(f));
  const a = kept(before, right);
  const b = kept(after, left);
  return { added, removed, reordered: a.some((f, i) => f !== b[i]) };
}

/**
 * A change in a few words: "Edited 1, added 2", "Reordered", "No change". A fact gone and one
 * new in a change read as one edited.
 */
export function factsChangeText(c: FactsChange): string {
  const edited = Math.min(c.added.length, c.removed.length);
  const parts = [
    edited ? `edited ${edited}` : "",
    c.added.length > edited ? `added ${c.added.length - edited}` : "",
    c.removed.length > edited ? `removed ${c.removed.length - edited}` : "",
    c.reordered ? "reordered" : "",
  ].filter(Boolean);
  const line = parts.join(", ");
  return line ? line.charAt(0).toUpperCase() + line.slice(1) : "No change";
}
