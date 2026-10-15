/**
 * A list as cards (William, 10-15): the same rows laid out for scanning, a card each. A page
 * declares how its card looks beside its columns (`CardSpec`); left out, the card is read from the
 * columns, so every row list has one. `false` keeps a list as rows (logs, audits, runs, days).
 * Rows or cards is the address's `as`, so it rides the viewer's last view and a saved view.
 */
import type { FieldMeta, RecordMeta } from "@wren/core/records";

/** What a card shows; each part read from the columns when left out. */
export interface CardSpec {
  /** The title: a field, or fields tried in turn, the first a row fills. Left out, the record's. */
  title?: string | readonly string[];
  /** The state its badge shows: a status field. Null for none. */
  badge?: string | null;
  /** The facts under the title, in order. */
  facts?: readonly string[];
  /** Words under the title, cut at three lines: a text or prose field, or fields tried in turn. Null for none. */
  body?: string | readonly string[] | null;
  /** The picture across its top (the type's `thumbs`): its shape. Null for none. */
  media?: CardMedia | null;
  /** The mark by the badge: a platform or channel field. Null for none. */
  mark?: string | null;
  /** On a phone this page opens as cards, until the viewer picks rows (a queue he works through). */
  phone?: "cards";
}
export type CardMedia = "wide" | "square" | "tall";

/** A page's card: its spec, or `false` to stay rows. */
export type CardOption = CardSpec | false;

/** A list's two forms. */
export type ListForm = "rows" | "cards";

/** The form a list opens as when the address says none: cards on a phone for a page that asks. */
export const opensAs = (card: CardOption | undefined, narrow: boolean): ListForm =>
  card && card.phone === "cards" && narrow ? "cards" : "rows";

/**
 * The address's form (`as`): cards when it says so and the page has them. An address that says
 * `rows` is the viewer's own pick, so a page that opens as cards on a phone stays rows.
 */
export const listFormOf = (
  params: URLSearchParams,
  card: CardOption | undefined,
  narrow = false,
): ListForm => {
  if (card === false) return "rows";
  const as = params.get("as");
  return as === "cards" || as === "rows" ? as : opensAs(card, narrow);
};

/** The address change for a form: the form the page opens as leaves the address, the other stays. */
export const listFormParam = (form: ListForm, opens: ListForm = "rows") => ({
  as: form === opens ? null : form,
});

/** How many facts a card lists when the page doesn't say. */
export const CARD_FACTS = 4;

/** A card's parts as fields. */
export interface CardParts {
  title: FieldMeta | undefined;
  /** Every field the title may read, a row's first filled one winning; the record's title last. */
  titles: FieldMeta[];
  mark: FieldMeta | null;
  badge: FieldMeta | null;
  body: FieldMeta | null;
  /** Every field the body may read, the first a row fills winning. */
  bodies: FieldMeta[];
  facts: FieldMeta[];
  media: CardMedia | null;
}

const WORDS = new Set(["prose", "cited"]);

/**
 * A card from the page's spec, the rest from the columns on screen (`cols`, the viewer's picks):
 * the platform field (the type's channel) as its mark, the first state that tells the rows apart as its badge, the
 * list's long-text subtitle as its body, then the next columns as facts, `CARD_FACTS` at most. A
 * picture shows wide where the type has them. Keys the type lacks are dropped.
 */
export function cardOf(
  meta: RecordMeta,
  cols: readonly FieldMeta[],
  spec: CardSpec = {},
  rows: readonly Record<string, unknown>[] = [],
): CardParts {
  const byKey = new Map(meta.fields.map((f) => [f.key, f]));
  const field = (key: string | null | undefined) => (key ? (byKey.get(key) ?? null) : null);
  const own = byKey.get(meta.title);
  const titles = [...listOf(spec.title).flatMap((k) => field(k) ?? []), ...(own ? [own] : [])];
  const title = titles[0];
  const site = typeof meta.channel === "object" && meta.channel ? field(meta.channel.field) : null;
  const mark = spec.mark !== undefined ? field(spec.mark) : site?.states ? site : null;
  const tells = (f: FieldMeta) => new Set(rows.map((r) => String(r[f.key] ?? ""))).size > 1;
  const states = cols.filter((f) => f.kind === "status" && f !== own && f !== title && f !== mark);
  const badge =
    spec.badge !== undefined ? field(spec.badge) : (states.find(tells) ?? states[0] ?? null);
  const sub = field(meta.subtitle);
  const bodies =
    spec.body !== undefined
      ? listOf(spec.body).flatMap((k) => field(k) ?? [])
      : sub && sub.kind === "prose" && sub !== title
        ? [sub]
        : [];
  const body = bodies[0] ?? null;
  const used = new Set([title, mark, badge, body].filter(Boolean));
  const facts = spec.facts
    ? spec.facts.flatMap((k) => field(k) ?? []).filter((f) => !used.has(f))
    : cols.filter((f) => !used.has(f) && !WORDS.has(f.kind)).slice(0, CARD_FACTS);
  const media = spec.media !== undefined ? spec.media : meta.thumbs ? "wide" : null;
  return { title, titles, mark, badge, body, bodies, facts, media: meta.thumbs ? media : null };
}

const listOf = (v: string | readonly string[] | null | undefined): readonly string[] =>
  v == null ? [] : typeof v === "string" ? [v] : v;

/**
 * A row's card words: the first title and body field it fills, read with `read`. The fields it
 * took are `spent`, so the facts don't say them twice.
 */
export function cardWords(parts: CardParts, read: (key: string) => string) {
  const first = (fields: readonly FieldMeta[]) => fields.find((f) => read(f.key).trim());
  const t = first(parts.titles);
  const b = first(parts.bodies);
  return {
    title: t ? read(t.key) : "",
    body: b ? read(b.key) : "",
    spent: [t?.key, b?.key].filter((k): k is string => !!k),
  };
}

/** The CSS aspect ratio of a card's picture. */
export const MEDIA_RATIO: Record<CardMedia, string> = {
  wide: "16 / 9",
  square: "1 / 1",
  tall: "4 / 5",
};
