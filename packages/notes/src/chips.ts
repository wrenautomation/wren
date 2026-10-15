/**
 * The "Card: <column>" chip a line carries after Make card (designs/2026-10-14-boards.md, Finish
 * pass). The label saved in the note is where the card started; the page reads where it is now,
 * for every card of the note in one batched call, and shows that. No DOM here: the editor wires it.
 */

/** A line that already has a card carries a link whose label starts with this. */
export const CARD_LABEL = "Card: ";

/** Where a card stands now, as the `cardChips` route answers. */
export interface CardChip {
  id: string;
  column: string;
  closed: boolean;
}

/** The card a mention points at, if the mention is a card chip: its note id. */
export function chipCardId(m: { id?: unknown; label?: unknown }): string | null {
  const id = typeof m.id === "string" ? m.id : "";
  if (!id.startsWith("note:") || !String(m.label ?? "").startsWith(CARD_LABEL)) return null;
  return id.slice("note:".length) || null;
}

/** The chip's words: the card's current column, or what was saved when it can't be read. */
export function chipWords(saved: string, now: CardChip | undefined): string {
  return now ? `${CARD_LABEL}${now.column}` : saved;
}

/** At most this many cards in one read (the route's cap). */
export const CHIPS_PER_READ = 100;

export interface Chips {
  /** What is known about a card, once read. */
  get(id: string): CardChip | undefined;
  /** Read these cards (those not read yet), together, soon. */
  ask(ids: Iterable<string>): void;
  /** Read every known card again, e.g. when the page comes back to the front. */
  refresh(): void;
  /** Called after each read; returns the way to stop. */
  watch(fn: () => void): () => void;
}

/**
 * Cards asked for within `wait` ms go out as one read (more than `CHIPS_PER_READ` in as few reads
 * as it takes). A card the read doesn't return, or a read that fails, leaves the saved words.
 */
export function makeChips(
  read: (ids: string[]) => Promise<CardChip[]>,
  o: {
    wait?: number;
    after?: (fn: () => void, ms: number) => unknown;
  } = {},
): Chips {
  const wait = o.wait ?? 40;
  const after = o.after ?? ((fn, ms) => setTimeout(fn, ms));
  const known = new Map<string, CardChip>();
  const seen = new Set<string>();
  const queue = new Set<string>();
  const watchers = new Set<() => void>();
  let scheduled = false;

  const flush = async () => {
    scheduled = false;
    const ids = [...queue];
    queue.clear();
    let changed = false;
    for (let i = 0; i < ids.length; i += CHIPS_PER_READ) {
      try {
        for (const c of await read(ids.slice(i, i + CHIPS_PER_READ))) {
          const old = known.get(c.id);
          if (!old || old.column !== c.column || old.closed !== c.closed) changed = true;
          known.set(c.id, c);
        }
      } catch {
        // The chip keeps the words saved in the note.
      }
    }
    if (changed) for (const fn of [...watchers]) fn();
  };
  const ask = (ids: Iterable<string>) => {
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      queue.add(id);
    }
    if (queue.size && !scheduled) {
      scheduled = true;
      after(() => void flush(), wait);
    }
  };
  return {
    get: (id) => known.get(id),
    ask,
    refresh: () => {
      const all = [...seen];
      seen.clear();
      ask(all);
    },
    watch: (fn) => {
      watchers.add(fn);
      return () => void watchers.delete(fn);
    },
  };
}
