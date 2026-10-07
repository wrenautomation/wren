/**
 * What is true about William and Wren: the only first-person facts a model draft may claim.
 * Every prompt that writes as him or as Wren carries them (`factsBlock`), and the guard
 * (`grounded.ts`) flags a first-person claim none of them backs. Wren's block in `wren_settings`
 * (Shop → Facts for drafts, or `wren drafts facts`) replaces the default. The repo is public: what
 * he built and shipped, never an amount or a client's name.
 */

import type { Queryable } from "@wren/db";
import { z } from "zod";
import { settingsFor } from "./clients/index.js";
import { defineComponent } from "./components.js";

export const FACTS_COMPONENT = "drafts.facts";

/** A fact is one plain line in his words. */
export const FACT_MAX = 300;

export const DEFAULT_FACTS: readonly string[] = [
  "I'm William, the founder of Wren Automation, a one-person automation agency.",
  "I built Wren's cold email system: it finds leads, checks each address, writes each email, sends from a fleet of inboxes and reads the replies.",
  "I built autobrowse, an open-source browser automation tool on npm that signs in to sites and runs tasks on them.",
  "I built a lead reactivation product: it researches a business's old CRM contacts and drafts messages to win them back.",
  "I built a content loop: it drafts posts from my notes and my commits, I approve each one, then it posts.",
  "I built a client portal where clients see their drafts and approve them before anything sends.",
  "Wren's code is public on GitHub.",
];

export const factsSettingsSchema = z
  .object({
    /** One true line each; claims in drafts must match one. Empty: drafts claim nothing first-person. */
    facts: z
      .array(z.string().trim().min(1).max(FACT_MAX))
      .max(40)
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
