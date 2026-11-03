/**
 * The draft desk over every kind (designs/2026-10-06-content-desk.md, 3 and 4): read a draft with
 * what Claude needs, list what waits, write the field the console edits, undo. Every write is a
 * `runs` row (`draft-ask`, `draft-set`, `draft-undo`) keeping the text it replaced, so the item's
 * thread shows it and Undo puts it back. The app composes the kinds (`draftDesk`); the Ask Claude
 * prompt (`askPrompt`) is the same for all of them.
 */
import { finishRun, openRun } from "@wren/core";
import { type DraftCommand, draftEdits, draftTurns, editsFor } from "@wren/core/ask";
import { recordDraft } from "@wren/core/draft-record";
import { staleRefusal } from "@wren/core/refusal";
import { parseKind } from "@wren/core/slots";
import { type LiveTemplate, promptRef, renderPrompt } from "@wren/core/templates";
import { defaultSource } from "@wren/core/templates/defaults";
import { atomic, type Queryable } from "@wren/db";
import {
  type DraftItem,
  type DraftKind,
  type DraftKinds,
  type DraftType,
  GONE,
} from "./draft-kinds.js";

export interface DraftDeskDeps {
  /** Every kind a draft box shows, by Inbox prefix. */
  kinds: DraftKinds;
  /** His past comment decisions as a prompt block, closest to `about` first; "" with none. */
  examplesFor(db: Queryable, about: string): Promise<string>;
}

export interface WriteOptions {
  command: DraftCommand;
  by: string;
  /** Write only over this text, so a hand edit made meanwhile is never lost. */
  expect?: string | null;
  argv?: object;
  run?: string;
  stats?: object;
  /** Claude's write: what he asked, and what Claude was given. */
  ask?: string;
  llm?: Record<string, unknown>;
}

export interface DraftDesk {
  /** "comment:12" as its kind and id; throws on one no kind holds. */
  itemOf(item: string): { record: string; id: string; kind: DraftKind };
  /** The draft and what it needs, or a throw that says why not. */
  readDraft(db: Queryable, item: string): Promise<DraftItem & { edits: string; examples: string }>;
  /** Drafts waiting on William, every kind or one, newest first. */
  listWaiting(
    db: Queryable,
    o?: { type?: DraftType; limit?: number },
  ): ReturnType<DraftKind["waiting"]>;
  /** His newest edits of one type (or every type), newest first, for `wren drafts edits`. */
  listEdits(db: Queryable, o?: { type?: DraftType; limit?: number }): ReturnType<typeof draftEdits>;
  /** Write `text` over the draft as one `runs` row that keeps what it replaced. */
  writeDraft(
    db: Queryable,
    item: string,
    text: string | null,
    o: WriteOptions,
  ): Promise<{
    run: string;
    before: string | null;
    turn: Awaited<ReturnType<typeof draftTurns>>[number] | null;
    version: string | null;
  }>;
  /** Put back the text the newest change replaced. */
  undoDraft(db: Queryable, item: string, by: string): ReturnType<DraftDesk["writeDraft"]>;
}

export function draftDesk(deps: DraftDeskDeps): DraftDesk {
  const { kinds } = deps;
  const itemOf: DraftDesk["itemOf"] = (item) => {
    const at = item.indexOf(":");
    const record = item.slice(0, at);
    const kind = kinds[record];
    if (at < 1 || !kind || at === item.length - 1)
      throw new Error(`say a draft as ${Object.keys(kinds).join(":<id>, ")}:<id>`);
    return { record, id: item.slice(at + 1), kind };
  };
  /** The records whose edits teach a type; by Inbox prefix when `type` is one. */
  const editRecords = (type: string): readonly string[] =>
    Object.values(kinds).find((k) => k.type === type)?.edits ?? [type];

  // A comment also gets his past decisions on comments, closest to what it answers: the same
  // few-shot its drafting prompt reads.
  const readDraft: DraftDesk["readDraft"] = async (db, item) => {
    const { kind, id } = itemOf(item);
    const got = await kind.read(db, id);
    if (!got) throw new Error(GONE);
    const examples = got.about !== undefined ? await deps.examplesFor(db, got.about) : "";
    return { ...got, edits: await editsFor(db, kind.edits), examples };
  };

  const listWaiting: DraftDesk["listWaiting"] = async (db, o = {}) => {
    const limit = Math.min(Math.max(o.limit ?? 50, 1), 500);
    const some = Object.values(kinds).filter((k) => !o.type || k.type === o.type);
    const all = (await Promise.all(some.map((k) => k.waiting(db, limit)))).flat();
    return all.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
  };

  const listEdits: DraftDesk["listEdits"] = (db, o = {}) =>
    draftEdits(db, { ...(o.type ? { records: editRecords(o.type) } : {}), limit: o.limit ?? 5 });

  // `run` when one is open (an ask), else a new one.
  const writeDraft: DraftDesk["writeDraft"] = async (db, item, text, o) => {
    const { kind, record, id } = itemOf(item);
    return atomic(db, async (tx) => {
      const now = await kind.read(tx, id);
      if (!now) throw new Error(GONE);
      // The draft moved since the box read it: a coded conflict, so the page shows both.
      if (o.expect !== undefined && now.draft !== o.expect) throw staleRefusal("draft");
      if (text && text.length > now.max)
        throw new Error(
          `"${now.title}": it is ${text.length} characters, over the ${now.max} it can take. Cut it down.`,
        );
      await kind.write(tx, id, text);
      const run =
        o.run ??
        (await openRun(tx, { command: o.command, argv: { ...o.argv, record, id, by: o.by } })).id;
      await finishRun(tx, run, { ...o.stats, draft: text, before: now.draft });
      // His box emptied is a no; anything else is a new version.
      const cleared = text === null && o.command === "draft-set";
      await recordDraft(tx, {
        item,
        platform: now.platform ?? null,
        event: cleared ? "rejected" : "edited",
        via: o.command === "draft-ask" ? "claude" : "person",
        by: o.by,
        text: cleared ? now.draft : text,
        ask: o.ask ?? null,
        llm: o.llm ?? null,
        meta: o.command === "draft-undo" ? { undo: true } : {},
        runId: run,
      });
      // The turn as the draft's thread reads it, so the page adds "Edited by" without reading again.
      const [turn] = (await draftTurns(tx, record, id)).filter((t) => t.id === String(run));
      // The kind's version of the text, so the page's Approve names it without reading again.
      const version = kind.version && text ? kind.version(text.trim()) : null;
      return { run, before: now.draft, turn: turn ?? null, version };
    });
  };

  // Undo twice and the change is back.
  const undoDraft: DraftDesk["undoDraft"] = async (db, item, by) => {
    const { record, id } = itemOf(item);
    // A clear (a DM canceled) wrote null over words: undo puts the words back too.
    const last = (await draftTurns(db, record, id)).findLast(
      (t) => t.state === "done" && (t.draft !== null || t.before !== null),
    );
    if (!last) throw new Error("nothing to undo");
    return writeDraft(db, item, last.before, {
      command: "draft-undo",
      by,
      expect: last.draft,
      argv: { of: last.id },
    });
  };

  return { itemOf, readDraft, listWaiting, listEdits, writeDraft, undoDraft };
}

/** The longest draft Ask Claude takes: the desk's system prompt holds 8,000 characters. */
const ASK_DRAFT_MAX = 5000;
const QUESTION_MAX = 4000;
const SYSTEM_MAX = 8000;
export const ASK_MESSAGE_MAX = 2000;

/**
 * The system prompt (kind prompt, system `content`, name `draft-ask`); its words ship as
 * `packages/templates/defaults/prompt/content/draft-ask.prompt`. His edits, then his past
 * decisions on comments, come before the SOP: the cut takes the end, and his own say the most.
 */
export const DRAFT_ASK_REF = { system: "content", name: "draft-ask" } as const;
/** The shipped words, parsed. */
export const draftAskDefault = () =>
  parseKind(
    "prompt",
    DRAFT_ASK_REF.name,
    defaultSource(promptRef(DRAFT_ASK_REF.system, DRAFT_ASK_REF.name)),
  );

/** The desk's question and system prompt for one ask, or why it can't go. `prompt`: the store's. */
export function askPrompt(
  d: DraftItem,
  ask: { by: string; message: string },
  prompt: Pick<LiveTemplate, "template"> = { template: draftAskDefault() },
): { question: string; system: string } | { error: string } {
  if ((d.draft?.length ?? 0) > ASK_DRAFT_MAX)
    return { error: `the draft is over ${ASK_DRAFT_MAX} characters; use wren drafts set` };
  const system = renderPrompt(prompt, {
    what: d.what,
    max: String(d.max),
    draft: d.draft ? `"""\n${d.draft}\n"""` : "(none yet)",
    edits: d.edits || null,
    examples: d.examples || null,
    guide: d.guide || null,
  });
  return {
    question: `${ask.by} asks: ${ask.message}\n\n${d.context}`.slice(0, QUESTION_MAX),
    system: system.slice(0, SYSTEM_MAX),
  };
}
