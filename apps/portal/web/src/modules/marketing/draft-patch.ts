/**
 * A post's fields and slides saves patch their page from the answer (ContentDesk `fields` and
 * `slides` answer `saved`, the parts of the shape they moved): no read of the draft again after a
 * save. A save that moved the draft's status (a re-ask, or slides on an approved draft) reads
 * again, so its lists and head actions follow.
 */
import { type ActPatch, answerIn } from "@wren/ui";

type Field = { key: string; value?: unknown };
type Share = { id: string; status: string };
type Carousel = Record<string, unknown> & { shares?: Share[] };
type Shape = Record<string, unknown> & {
  status?: string;
  fields?: Field[];
  links?: Record<string, string>;
  carousel?: Carousel | null;
};
type Saved = {
  title: string | null;
  status: string;
  editable: boolean;
  fields: Field[];
  missing: string[];
  carousel?: Record<string, unknown> & { fresh?: boolean };
  shares?: Share[];
};

const json = (v: unknown) => JSON.stringify(v ?? null);

/**
 * The file links that still show their field: a single file's when it is the same file, a list's
 * by file (a removed one shifts the rest to new places).
 */
export function keptLinks(
  links: Record<string, string>,
  before: readonly Field[],
  after: readonly Field[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const was = new Map(before.map((f) => [f.key, f.value]));
  for (const f of after) {
    const old = was.get(f.key);
    if (Array.isArray(f.value) && Array.isArray(old))
      f.value.forEach((v, i) => {
        const j = old.findIndex((o) => json(o) === json(v));
        const url = j < 0 ? undefined : links[`${f.key}.${j}`];
        if (url) out[`${f.key}.${i}`] = url;
      });
    else if (links[f.key] && json(old) === json(f.value)) out[f.key] = links[f.key] as string;
  }
  if (links.media) out.media = links.media;
  return out;
}

/** The detail's `shape` with a save's `saved` over it; null reads the draft again. */
export const shapePatch: ActPatch = (detail, answer) => {
  const saved = (answerIn(answer) as { saved?: Saved } | null)?.saved;
  const d = detail as ({ shape?: Shape | null } & Record<string, unknown>) | null;
  const shape = d?.shape;
  if (!saved || !Array.isArray(saved.fields) || !shape || saved.status !== shape.status)
    return null;
  const { carousel, shares, ...rest } = saved;
  const was = shape.carousel;
  const nextCarousel =
    carousel && was
      ? {
          ...was,
          ...carousel,
          // A changed set drops the drawn files: draw again to post.
          ...(carousel.fresh ? {} : { images: [], pdf: null }),
          shares: (was.shares ?? []).map((s) => ({
            ...s,
            status: shares?.find((x) => x.id === s.id)?.status ?? s.status,
          })),
        }
      : was;
  return {
    detail: {
      ...d,
      shape: {
        ...shape,
        ...rest,
        links: keptLinks(shape.links ?? {}, shape.fields ?? [], saved.fields),
        carousel: nextCarousel,
      },
    },
  };
};

/** `act`'s options for a fields or slides save. */
export const SHAPED = { patch: shapePatch };
