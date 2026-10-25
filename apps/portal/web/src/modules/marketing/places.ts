/**
 * Reads on his click (audience, discovery), comment keywords, and the places discovery found.
 */
import { type Action, said } from "@wren/ui";

/** One read on his click; the loops behind these pages stay as they are. */
const readNow = (id: string, handler: string, done: (answer: unknown) => string): Action => ({
  id,
  label: "Read now",
  handler,
  form: [],
  done,
});
export const AUDIENCE_ACTIONS: Action[] = [
  readNow(
    "marketing.audienceRead",
    "marketing/audienceRead",
    (a) => `LinkedIn: ${(a as { followers?: number } | null)?.followers ?? "no"} followers`,
  ),
];
/** Comment keywords: a new one, and delete; state, DM and public reply edit in place. */
export const KEYWORD_ACTIONS: Action[] = [
  {
    id: "marketing.keywordAdd",
    label: "New keyword",
    handler: "marketing/keywordAdd",
    form: [
      { field: "keyword", label: "Keyword", hint: "The word people comment: LINK, GUIDE." },
      { field: "dm", label: "DM", type: "long", hint: "What they get, link and all." },
      {
        field: "reply",
        label: "Public reply",
        optional: true,
        hint: 'Under their comment too: "Sent, check your DMs."',
      },
      {
        field: "platform",
        label: "Site",
        type: "select",
        options: ["instagram", "facebook"],
        optional: true,
        hint: "Both when empty.",
      },
      { field: "post", label: "Post id", optional: true, hint: "Every post when empty." },
    ],
    done: (made) => `Added ${(made as { keyword?: string }).keyword ?? "the keyword"}`,
  },
  {
    id: "marketing.keywordRemove",
    label: "Delete",
    icon: "trash",
    handler: "marketing/keywordRemove",
    confirm: "Delete this keyword? Its DM log goes with it.",
    bulk: true,
    done: () => "Deleted",
  },
];

export const DISCOVERY_READ = readNow(
  "marketing.discoveryRead",
  "marketing/discoveryRead",
  () => "Reading. Places and Thread replies fill in over a few minutes.",
);

export const PLACE_ACTIONS: Action[] = [
  {
    id: "marketing.placeWatch",
    label: "Watch",
    icon: "eye",
    handler: "marketing/placeWatch",
    bulk: true,
    key: "w",
    when: { state: ["found", "skipped"] },
    done: said("Watching. Its threads are read every 2 hours."),
  },
  {
    id: "marketing.placeSkip",
    label: "Skip",
    icon: "close",
    handler: "marketing/placeSkip",
    bulk: true,
    key: "e",
    when: { state: ["found", "watching"] },
    done: said("Skipped"),
  },
  {
    id: "marketing.placeMove",
    label: "Move account",
    icon: "reschedule",
    handler: "marketing/placeMove",
    each: true,
    form: [
      {
        field: "account",
        label: "Account",
        hint: "One of ours in Reach: reddit@alt or its handle.",
      },
    ],
    when: { state: ["watching"] },
    done: said("Moved"),
  },
  DISCOVERY_READ,
];
