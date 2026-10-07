/**
 * The Library's Snippets: saved replies and blocks, edited in place (the record's `edits`), with
 * a star that makes one a favorite: favorites come first in every Insert picker.
 */
import { type Action, FavoriteStar, type RecordExtras, useFavorites, useSnippets } from "@wren/ui";
import type { ListPage } from "../../module.js";

export const SNIPPET = "library.snippet";
const CHANNELS = ["any", "email", "sms", "dm", "comment"];

export const SNIPPET_ACTIONS: Action[] = [
  {
    id: "library.snippetAdd",
    label: "New snippet",
    handler: "console/snippetAdd",
    form: [
      { field: "title", label: "Title" },
      { field: "body", label: "Words", type: "long" },
      { field: "tags", label: "Tags", optional: true, hint: "Comma between each." },
      {
        field: "channel",
        label: "Fits",
        type: "select",
        options: CHANNELS,
        optional: true,
        hint: "Leave it empty to use it anywhere.",
      },
    ],
    done: (made) => `Saved ${(made as { title?: string }).title ?? "the snippet"}`,
  },
  {
    id: "library.snippetRemove",
    label: "Delete",
    handler: "console/snippetRemove",
    confirm: "Delete this snippet? Drafts that used it keep their words.",
    bulk: true,
    done: () => "Deleted",
  },
];

function Favorite({ id, title }: { id: number; title: string }) {
  const fav = useFavorites(useSnippets());
  return (
    <span className="inline-flex items-center gap-1">
      <FavoriteStar on={fav.ids.includes(id)} label={title} onToggle={() => fav.toggle(id)} />
      <span className="text-[13px] text-(--ui-ink-2)">
        {fav.ids.includes(id) ? "First in Insert" : "Not a favorite"}
      </span>
    </span>
  );
}

export const snippetExtras: NonNullable<ListPage["extras"]> = (_detail, { row }) =>
  ({
    facts: [["Favorite", <Favorite key="fav" id={Number(row.id)} title={String(row.title)} />]],
  }) satisfies RecordExtras;
