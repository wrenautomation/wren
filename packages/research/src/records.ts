/** Research as console records: signals, under Outbound. A row opens its link and its raw. */
import { date, defineRecord, link, name, named, number, status, text } from "@wren/core/records";
import { eq } from "drizzle-orm";
import { documents, findings, SIGNAL_KINDS } from "./schema.js";

const KIND_LABELS: Record<(typeof SIGNAL_KINDS)[number], string> = {
  news: "News",
  post: "Post",
  hiring: "Hiring",
  job_change: "Job change",
  stack: "Tech stack",
  site_change: "Site change",
  talk: "Talk",
  demand: "Demand",
};

export const signalRecord = defineRecord({
  id: "research.signal",
  app: "outbound",
  channel: null,
  name: { one: "signal", many: "signals" },
  view: "research_signals",
  key: "id",
  title: "title",
  subtitle: "subject",
  fields: {
    title: text(),
    subject: name("About"),
    kind: status(
      Object.fromEntries(
        SIGNAL_KINDS.map((k) => [k, { label: KIND_LABELS[k], tone: "neutral" as const }]),
      ),
    ),
    topic: text(),
    at: date("When"),
    dated: status(
      {
        published: { label: "Printed", tone: "good" },
        approx: { label: "About", tone: "neutral" },
        seen: { label: "First seen", tone: "neutral" },
      },
      "Dated by",
    ),
    url: link("Source"),
    via: named("Read by"),
    confidence: number(),
    firstSeen: date("First seen"),
    seen: date("Last read"),
    age: status(
      {
        fresh: { label: "Last 30 days", tone: "good" },
        older: { label: "Older", tone: "neutral" },
      },
      "Age",
    ),
  },
  views: [
    { id: "fresh", label: "Fresh", where: { age: "fresh" }, sort: "-at", at: "at" },
    { id: "all", label: "All", sort: "-at", at: "at" },
    ...SIGNAL_KINDS.map((k) => ({
      id: k,
      label: KIND_LABELS[k],
      where: { kind: k },
      sort: "-at",
      at: "at",
    })),
  ],
  // The finding's whole value and its raw source.
  load: async (db, id) => {
    const [f] = await db
      .select({ value: findings.value, documentId: findings.documentId })
      .from(findings)
      .where(eq(findings.id, Number(id)));
    if (!f) return null;
    const [doc] = f.documentId
      ? await db
          .select({
            url: documents.url,
            title: documents.title,
            kind: documents.kind,
            text: documents.text,
            fetchedAt: documents.fetchedAt,
          })
          .from(documents)
          .where(eq(documents.id, f.documentId))
      : [];
    return { value: f.value, document: doc ?? null };
  },
});

export const RESEARCH_RECORDS = [signalRecord];
