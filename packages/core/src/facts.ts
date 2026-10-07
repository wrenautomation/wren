/**
 * What is true about William and Wren: the only first-person facts a model draft may claim.
 * Every prompt that writes as him or as Wren carries them (`factsBlock`), and the guard
 * (`grounded.ts`) flags a first-person claim none of them backs. Wren's block in `wren_settings`
 * replaces the default. It is edited as one record (`factsRecord`): Marketing → Facts, or
 * `wren drafts facts`, each save a `changes` row with who and Undo. The repo is public: what he
 * built and shipped, never an amount or a client's name.
 */

import type { Queryable } from "@wren/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { settingsFor, setWrenSettings } from "./clients/index.js";
import { wrenSettings } from "./clients/schema.js";
import { defineComponent } from "./components.js";
import { wordsPatch } from "./edits.js";
import {
  DEFAULT_FACTS,
  FACT_MAX,
  FACTS_CAP,
  FACTS_PAGE,
  factsOf,
  factsProblem,
  factsText,
} from "./facts-list.js";
import { date, defineRecord, number, prose, status, text } from "./records.js";

export { DEFAULT_FACTS, FACT_MAX, FACTS_CAP } from "./facts-list.js";

export const FACTS_COMPONENT = "drafts.facts";

export const factsSettingsSchema = z
  .object({
    /** One true line each; claims in drafts must match one. Empty: drafts claim nothing first-person. */
    facts: z
      .array(z.string().trim().min(1).max(FACT_MAX))
      .max(FACTS_CAP)
      .default([...DEFAULT_FACTS]),
  })
  .strict();
export type FactsSettings = z.infer<typeof factsSettingsSchema>;

/** Wren's facts: the saved block, or the default when none is saved or it doesn't parse. */
export async function wrenFacts(db: Queryable): Promise<string[]> {
  const got = factsSettingsSchema.safeParse((await settingsFor(db, null))[FACTS_COMPONENT] ?? {});
  return got.success ? got.data.facts : [...DEFAULT_FACTS];
}

/**
 * The prompt's rule. With facts, they are the only first-person claims allowed; with none, no
 * first-person claim at all. Either way: an insight, a question, or the source's own numbers.
 */
export function factsBlock(facts: readonly string[]): string {
  const rule =
    "Never invent a story, client, result, number or date about the writer or the business: no " +
    '"I built", "we paid", "last year we" unless a fact below says it. With nothing true that ' +
    "fits, add an insight, ask a question, or work with the numbers the source itself gives.";
  return facts.length
    ? `What is true about the writer (the only first-person facts you may use):\n${facts.map((f) => `- ${f}`).join("\n")}\n${rule}`
    : `Nothing about the writer's own experience, clients or results is known. ${rule}`;
}

export const FACTS_RECORD = "marketing.facts";

export const FACTS_COMPONENTS = [
  defineComponent({
    id: FACTS_COMPONENT,
    stage: "run",
    channels: ["social", "dm"],
    name: "Facts for drafts",
    blurb:
      "What is true about you and the business. Drafts may claim only these; a draft that makes up anything else is written again or dropped.",
    icon: "check",
    for: "wren",
    ready: true,
    settings: factsSettingsSchema,
    editor: FACTS_PAGE,
    provides: { records: [FACTS_RECORD] },
    hypothesis: {
      from: "Wren's LinkedIn comments, 2026-10-07",
      guesses: [
        { is: "change", says: "What he has built and shipped.", built: "settings.facts" },
        { is: "fixed", says: "No amounts and no client names: the repo is public." },
        { is: "fixed", says: "A claim no fact backs is redrafted once, then dropped." },
      ],
    },
  }),
];

/** The one list: Wren's. */
export const FACTS_ID = "wren";

/**
 * The facts as one record, so the list saves through the edits path (`./edits.ts`): the version
 * an editor started from, a check, a `changes` row with who, History and Undo. The words are one
 * fact a line. Saving needs `manage`, as every setting does.
 */
export const factsRecord = defineRecord({
  id: FACTS_RECORD,
  app: "marketing",
  channel: null,
  name: { one: "facts list", many: "facts lists" },
  rows: async (db) => {
    const [row] = await db
      .select()
      .from(wrenSettings)
      .where(eq(wrenSettings.component, FACTS_COMPONENT));
    const facts = await wrenFacts(db);
    return [
      {
        id: FACTS_ID,
        name: "Facts for drafts",
        facts: factsText(facts),
        count: facts.length,
        source: row ? "saved" : "default",
        updated_at: row?.updatedAt?.toISOString() ?? null,
        updated_by: row?.updatedBy ?? null,
      },
    ];
  },
  key: "id",
  title: "name",
  fields: {
    name: text("Name"),
    facts: prose("Facts"),
    count: number("Facts"),
    source: status(
      {
        saved: { label: "Yours", tone: "neutral" },
        default: { label: "The default", tone: "neutral" },
      },
      "List",
    ),
    updatedAt: date("Saved"),
    updatedBy: text("By"),
  },
  views: [{ id: "all", label: "All" }],
  edits: {
    fields: ["facts"],
    patch: wordsPatch({ facts: FACTS_CAP * (FACT_MAX + 1) }),
    needs: "manage",
    about:
      "the only first-person facts a draft may claim, one a line, in his words; no amounts, no client names",
    read: async (db, id) => (id === FACTS_ID ? { facts: factsText(await wrenFacts(db)) } : null),
    check: (patch) => factsProblem(factsOf(String(patch.facts ?? ""))),
    write: async (db, _id, patch, by) => {
      const block = factsSettingsSchema.parse({ facts: factsOf(String(patch.facts ?? "")) });
      await setWrenSettings(db, FACTS_COMPONENT, block, by);
    },
    context: async () =>
      [
        "Every draft that writes as William or Wren may claim only these. The guard redrafts a draft",
        "that claims anything else once, then drops it. The repo is public.",
        `One plain line each, ${FACT_MAX} characters at most, ${FACTS_CAP} at most.`,
      ].join(" "),
  },
});
