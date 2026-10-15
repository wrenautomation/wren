/**
 * Turn into cards (designs/2026-10-14-boards.md, Finish pass): Claude reads a note and proposes
 * cards; the person ticks which to add. Nothing here writes. The model's answer is checked: at
 * most `PROPOSE_MAX` cards, titles clipped, an owner only if the note @-mentions them, a due only
 * as a real day, a source line only if the note has it.
 */

export const PROPOSE_MAX = 30;
export const PROPOSE_TITLE_MAX = 120;
/** The most of a note the model reads. */
const TEXT_MAX = 20_000;

export interface ProposedCard {
  title: string;
  /** An email or `agent:<name>` the note mentions. */
  owner: string | null;
  /** YYYY-MM-DD. */
  due: string | null;
  /** The note's line it came from, as written there. */
  line: string | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A day that exists: 2026-02-31 doesn't, though Date.parse takes it. */
const realDay = (s: string) => {
  if (!DAY.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/** Someone the note mentions: who they are, and how the note shows them (`@<label>`). */
export interface Mentioned {
  id: string;
  label: string;
}

export function proposePrompt(o: {
  title: string;
  text: string;
  owners: Mentioned[];
  today: string;
}) {
  const owners = o.owners.map((m) => `${m.id} (shown as @${m.label})`);
  return [
    "Turn this note into task cards for a kanban board.",
    "One card per distinct piece of work someone has to do. Skip context, notes and done items ([x]).",
    `At most ${PROPOSE_MAX} cards. Titles start with a verb, under ${PROPOSE_TITLE_MAX} characters, no trailing period.`,
    `owner: only one of these, when the note gives that work to them, else null: ${owners.length ? owners.join(", ") : "(none)"}.`,
    `due: YYYY-MM-DD only when the note states a date for that work, else null. Today is ${o.today}.`,
    "line: the note's line the card comes from, copied exactly, else null.",
    'Answer with JSON only: {"cards":[{"title":"","owner":null,"due":null,"line":null}]}',
    "",
    `Title: ${o.title || "(none)"}`,
    "Note:",
    o.text.slice(0, TEXT_MAX),
  ].join("\n");
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** The model's answer as cards that pass the checks; anything else is dropped. */
export function readProposal(raw: string, o: { text: string; owners: string[] }): ProposedCard[] {
  const at = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (at < 0 || end < at) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(at, end + 1));
  } catch {
    return [];
  }
  const list = (parsed as { cards?: unknown })?.cards;
  if (!Array.isArray(list)) return [];
  const owners = new Set(o.owners.map((x) => x.toLowerCase()));
  const lines = new Map(
    o.text
      .split("\n")
      .map((l) => clean(l.replace(/^\s*(?:[-*]\s*)?(?:\[[ xX]\]\s*)?/, "")))
      .filter(Boolean)
      .map((l) => [l.toLowerCase(), l] as const),
  );
  const out: ProposedCard[] = [];
  const seen = new Set<string>();
  for (const c of list) {
    if (out.length >= PROPOSE_MAX) break;
    if (!c || typeof c !== "object") continue;
    const r = c as Record<string, unknown>;
    let title = typeof r.title === "string" ? clean(r.title).replace(/\.$/, "") : "";
    if (!title) continue;
    if (title.length > PROPOSE_TITLE_MAX)
      title = `${title.slice(0, PROPOSE_TITLE_MAX - 1).trimEnd()}…`;
    if (seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    const owner = typeof r.owner === "string" ? r.owner.trim().toLowerCase() : "";
    const due = typeof r.due === "string" ? r.due.trim() : "";
    const line =
      typeof r.line === "string"
        ? lines.get(clean(r.line.replace(/^\s*(?:[-*]\s*)?(?:\[[ xX]\]\s*)?/, "")).toLowerCase())
        : undefined;
    out.push({
      title,
      owner: owners.has(owner) ? owner : null,
      due: realDay(due) ? due : null,
      line: line ?? null,
    });
  }
  return out;
}
