/** Loops → Flags: add and delete; rules, fallback and the kill switch edit in place (`loops.flag`). */
import type { Action } from "@wren/ui";

export const FLAG_ACTIONS: Action[] = [
  {
    id: "loops.flagAdd",
    label: "New flag",
    handler: "console/flagAdd",
    form: [
      {
        field: "key",
        label: "Key",
        hint: "Lower case, as the code asks for it: voice, new-inbox.",
      },
      { field: "about", label: "What it's for", optional: true },
      {
        field: "surface",
        label: "Read by",
        type: "select",
        options: ["portal", "site", "both"],
        optional: true,
      },
      {
        field: "variants",
        label: "Variants",
        optional: true,
        hint: "Comma between each; off, on when empty. The first is what everyone gets until a rule says otherwise.",
      },
    ],
    done: (made) => `Added ${(made as { key?: string }).key ?? "the flag"}`,
  },
  {
    id: "loops.flagRemove",
    label: "Delete",
    handler: "console/flagRemove",
    confirm: "Delete this flag? Code that asks for it gets off.",
    bulk: true,
    done: () => "Deleted",
  },
];
