/**
 * `wren train export --notes`: one `wren.note/1` line per note opted in (designs/2026-10-07-notes.md,
 * Training). Off by default. Emails read [email] and each person a stable `person N` unless the
 * export keeps people.
 */
import type { Queryable } from "@wren/db";
import { trainingNotes } from "./store.js";
import { isAgent } from "./types.js";

export interface NoteLine {
  schema: "wren.note/1";
  workspace: string;
  id: string;
  title: string;
  text: string;
  /** Who wrote it: a person, or an agent through the CLI or the API. */
  via: "person" | "agent";
  createdAt: string;
  updatedAt: string;
  versions: {
    number: number;
    kind: string;
    name: string | null;
    at: string;
    authors: string[];
    text: string;
  }[];
}

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;

/** The workspace's training notes as lines; `people` keeps names and emails. */
export async function noteLines(
  db: Queryable,
  workspace: string,
  people = false,
): Promise<NoteLine[]> {
  const rows = await trainingNotes(db);
  return rows.map(({ note, versions }) => {
    const seen = new Map<string, string>();
    const who = (w: string) => {
      if (people || isAgent(w)) return w;
      const k = w.toLowerCase();
      if (!seen.has(k)) seen.set(k, `person ${seen.size + 1}`);
      return seen.get(k) as string;
    };
    const words = (s: string) => (people ? s : s.replace(EMAIL, "[email]"));
    return {
      schema: "wren.note/1",
      workspace,
      id: note.id,
      title: words(note.title),
      text: words(note.text),
      via: note.via,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
      versions: versions.map((v) => ({
        number: v.number,
        kind: v.kind,
        name: v.name,
        at: v.at.toISOString(),
        authors: v.authors.map(who),
        text: words(v.text),
      })),
    };
  });
}
