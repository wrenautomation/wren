/**
 * The training record's backfill (designs/2026-10-07-training-record.md, Backfill): the drafts
 * made before `draft_events` existed, folded in from where their history sits. Posts from
 * `content_drafts` (the model's words from its kept output or the first audited change), their
 * edits from `runs` and `audit_events`, their yes, no and send; comments and Reddit threads from
 * their own rows; DMs from the messages he sent; video words from the video's change runs.
 *
 * Idempotent: every step carries a `bf:` ref, so a second run writes nothing. An item that already
 * has steps from the live record is left alone, so nothing is counted twice.
 */
import { type DraftStep, recordDraft } from "@wren/core/draft-record";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";

export interface BackfillReport {
  /** Items with history to fold in. */
  items: number;
  /** Items left alone: the live record already holds them. */
  live: number;
  steps: number;
  /** Steps not kept before this run; in a dry run, what it would write. */
  written: number;
}

type Raw = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const when = (v: unknown) => new Date(v as string);
const later = (d: Date, ms = 1) => new Date(d.getTime() + ms);

/** The model's own words, from a stage's kept output: `{"text": …, "title": …}`. */
function modelWords(llm: unknown): { text: string; title: string | null } | null {
  const raw = (llm as { raw_text?: unknown } | null)?.raw_text;
  if (typeof raw !== "string") return null;
  const from = raw.indexOf("{");
  const to = raw.lastIndexOf("}");
  if (from < 0 || to <= from) return null;
  try {
    const o = JSON.parse(raw.slice(from, to + 1)) as { text?: unknown; title?: unknown };
    return typeof o.text === "string"
      ? { text: o.text, title: typeof o.title === "string" ? o.title : null }
      : null;
  } catch {
    return null;
  }
}

/** A stage's kept envelope as a `generated` step's `llm`; the prompt wasn't kept then. */
const llmFrom = (stage: string, env: unknown) => {
  const e = (env ?? {}) as { call?: Record<string, unknown>; raw_text?: unknown };
  return {
    stage,
    model: e.call?.model ?? null,
    provider: e.call?.provider ?? null,
    system: null,
    prompt: null,
    max_tokens: null,
    usage: e.call?.usage ?? null,
    raw_text: e.raw_text ?? null,
    backfilled: true,
  };
};

/** Each draft's edits from the ledger: `draft-set`, `draft-ask`, `draft-undo`. */
async function runEdits(db: Queryable, record: string) {
  const rows = await db.execute<Raw>(sql`
    select id::text id, command, argv, stats, started_at from runs
    where command in ('draft-set', 'draft-ask', 'draft-undo') and argv->>'record' = ${record}
      and finished_at is not null and not stats ? 'error'
    order by started_at, id`);
  const by = new Map<string, Raw[]>();
  for (const r of rows) {
    const id = str((r.argv as Raw)?.id) ?? "";
    by.set(id, [...(by.get(id) ?? []), r]);
  }
  return by;
}

/** A run's edit as a step: a cleared box is his no; a Claude write keeps what he asked. */
function editStep(item: string, r: Raw, base: Partial<DraftStep>): DraftStep | null {
  const argv = (r.argv ?? {}) as Raw;
  const stats = (r.stats ?? {}) as Raw;
  const text = str(stats.draft);
  const cleared = text === null && r.command === "draft-set";
  if (text === null && !cleared) return null;
  if (!cleared && text === str(stats.before)) return null;
  return {
    ...base,
    item,
    event: cleared ? "rejected" : "edited",
    via: r.command === "draft-ask" ? "claude" : "person",
    by: str(argv.by),
    text: cleared ? str(stats.before) : text,
    ask: r.command === "draft-ask" ? str(argv.message) : null,
    meta: {
      ...(r.command === "draft-undo" ? { undo: true } : {}),
      ...(argv.sent ? { at_send: true } : {}),
    },
    runId: str(r.id),
    ref: `bf:run:${r.id}`,
    at: when(r.started_at),
  };
}

/** Posts and video uploads from `content_drafts`. */
async function postSteps(db: Queryable): Promise<DraftStep[]> {
  const drafts = await db.execute<Raw>(sql`
    select d.id::text id, d.idea_id::text idea, d.platform, d.text, d.title, d.status,
      d.approved_at, d.scheduled_for, d.published_at, d.published_id, d.url, d.error,
      d.redraft_of::text redraft_of, d.note, d.prompt_version, d.playbook_id::text playbook,
      d.llm, d.created_at,
      (select c.id::text from content_drafts c where c.redraft_of = d.id
        order by c.created_at limit 1) redrafted_as,
      (select c.created_at from content_drafts c where c.redraft_of = d.id
        order by c.created_at limit 1) redrafted_at,
      (select c.note from content_drafts c where c.redraft_of = d.id
        order by c.created_at limit 1) redraft_note
    from content_drafts d order by d.created_at, d.id`);
  const audits = await db.execute<Raw>(sql`
    select a.id, a.at, a.actor, a.row_key->>'id' draft, a.old_values, a.new_values
    from audit_events a where a.table_name = 'content_drafts' and a.op = 'update'
      and (a.new_values ? 'text' or a.new_values ? 'title' or a.new_values ? 'status')
    order by a.at, a.id`);
  const auditOf = new Map<string, Raw[]>();
  for (const a of audits) {
    const id = str(a.draft) ?? "";
    auditOf.set(id, [...(auditOf.get(id) ?? []), a]);
  }
  const runs = await runEdits(db, "draft");
  const out: DraftStep[] = [];
  for (const d of drafts) {
    const id = String(d.id);
    const item = `draft:${id}`;
    const video = d.prompt_version === "video";
    const base: Partial<DraftStep> = {
      kind: video ? "video" : "post",
      platform: str(d.platform),
      round: 1,
    };
    const changes = auditOf.get(id) ?? [];
    const firstWords = changes.find((a) => (a.old_values as Raw | null)?.text !== undefined);
    const model = video ? null : modelWords(d.llm);
    const old = (firstWords?.old_values ?? {}) as Raw;
    const original = model ?? {
      text: str(old.text) ?? String(d.text),
      title: old.title !== undefined ? str(old.title) : str(d.title),
    };
    const created = when(d.created_at);
    out.push({
      ...base,
      item,
      event: "generated",
      via: video ? "wren" : d.llm ? "model" : "person",
      by: video ? "video add" : null,
      text: original.text,
      title: original.title,
      ask: d.redraft_of ? str(d.note) : null,
      llm: d.llm && !video ? llmFrom("content_draft", d.llm) : null,
      meta: {
        idea: str(d.idea),
        ...(d.redraft_of ? { redraft_of: str(d.redraft_of) } : {}),
        ...(d.playbook ? { playbook: str(d.playbook) } : {}),
        prompt_version: str(d.prompt_version),
        backfilled: true,
      },
      ref: `bf:${item}:generated`,
      at: created,
    });
    const edits = (runs.get(id) ?? [])
      .map((r) => editStep(item, r, base))
      .filter((s): s is DraftStep => s !== null);
    // A change the ledger didn't see (the CLI's edit, the desk's): from the audit log.
    for (const a of changes) {
      const now = (a.new_values ?? {}) as Raw;
      if (now.text === undefined && now.title === undefined) continue;
      const at = when(a.at);
      const seen = edits.some(
        (e) =>
          (now.text === undefined || e.text === now.text) &&
          Math.abs((e.at?.getTime() ?? 0) - at.getTime()) < 60_000,
      );
      if (seen) continue;
      edits.push({
        ...base,
        item,
        event: "edited",
        via: "person",
        by: str(a.actor),
        text: str(now.text) ?? null,
        title: now.title !== undefined ? str(now.title) : null,
        ref: `bf:audit:${a.id}`,
        at,
      });
    }
    edits.sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
    // An edit of the title alone carries the words it left as they were.
    let words = original;
    for (const e of edits) {
      if (e.event !== "edited") continue;
      words = { text: e.text ?? words.text, title: e.title ?? words.title };
      e.text = words.text;
      e.title = words.title;
    }
    out.push(...edits);
    const statusAt = (s: string) => changes.find((a) => (a.new_values as Raw | null)?.status === s);
    const lastAt = edits.at(-1)?.at ?? created;
    const approved = statusAt("approved");
    if (d.approved_at || approved)
      out.push({
        ...base,
        item,
        event: "approved",
        via: video ? "wren" : "person",
        by: str(approved?.actor),
        slot: d.scheduled_for ? when(d.scheduled_for) : null,
        ref: `bf:${item}:approved`,
        at: d.approved_at ? when(d.approved_at) : when(approved?.at),
      });
    if (d.redrafted_as || d.status === "rejected") {
      const no = statusAt("rejected");
      out.push({
        ...base,
        item,
        event: "rejected",
        via: "person",
        by: str(no?.actor),
        text: words.text,
        note: d.redrafted_as ? str(d.redraft_note) : null,
        meta: d.redrafted_as ? { redrafted_as: str(d.redrafted_as) } : {},
        ref: `bf:${item}:rejected`,
        at: d.redrafted_at ? when(d.redrafted_at) : no ? when(no.at) : later(lastAt),
      });
    }
    if (d.status === "published" && d.published_at)
      out.push({
        ...base,
        item,
        event: "sent",
        via: "wren",
        by: "scheduler",
        text: String(d.text),
        title: str(d.title),
        externalId: str(d.published_id),
        url: str(d.url),
        ref: `bf:${item}:sent`,
        at: when(d.published_at),
      });
    if (d.status === "failed") {
      const failed = statusAt("failed");
      out.push({
        ...base,
        item,
        event: "failed",
        via: "wren",
        by: "scheduler",
        note: str(d.error),
        ref: `bf:${item}:failed`,
        at: failed ? when(failed.at) : later(lastAt),
      });
    }
  }
  return out;
}

/**
 * A comment's or Reddit thread's draft: the model's words (the first edit's `before`, else the
 * draft it still holds), his edits, the answer posted, or his no.
 */
async function answerSteps(db: Queryable, kind: "comment" | "thread"): Promise<DraftStep[]> {
  const rows =
    kind === "comment"
      ? await db.execute<Raw>(sql`
          select c.id::text id, c.platform, c.draft, c.answer, c.answer_ref, c.answered_at,
            c.state, c.created_at,
            (select a.at from audit_events a where a.table_name = 'comments' and a.op = 'update'
              and a.row_key->>'id' = c.id::text and a.new_values ? 'draft'
              order by a.at limit 1) drafted_at,
            (select a.at from audit_events a where a.table_name = 'comments' and a.op = 'update'
              and a.row_key->>'id' = c.id::text and a.new_values->>'state' = 'dropped'
              order by a.at desc limit 1) dropped_at
          from comments c
          where c.draft is not null or c.answer is not null
          order by c.created_at, c.id`)
      : await db.execute<Raw>(sql`
          select t.id, 'reddit' platform, t.draft, t.answer, t.answer_ref, t.answered_at,
            t.state, coalesce(t.scored_at, t.created_at) created_at,
            (select a.at from audit_events a where a.table_name = 'reddit_threads'
              and a.op = 'update' and a.row_key->>'id' = t.id and a.new_values ? 'draft'
              order by a.at limit 1) drafted_at,
            (select a.at from audit_events a where a.table_name = 'reddit_threads'
              and a.op = 'update' and a.row_key->>'id' = t.id
              and a.new_values->>'state' = 'dropped' order by a.at desc limit 1) dropped_at
          from reddit_threads t
          where t.draft is not null or t.answer is not null
          order by t.created_at, t.id`);
  const runs = await runEdits(db, kind);
  const out: DraftStep[] = [];
  for (const r of rows) {
    const id = String(r.id);
    const item = `${kind}:${id}`;
    const base: Partial<DraftStep> = { kind, platform: str(r.platform), round: 1 };
    const edits = (runs.get(id) ?? [])
      .map((x) => editStep(item, x, base))
      .filter((s): s is DraftStep => s !== null);
    const first = (runs.get(id) ?? [])[0];
    const model = first ? str((first.stats as Raw)?.before) : str(r.draft);
    const at = when(r.drafted_at ?? r.created_at);
    if (model)
      out.push({
        ...base,
        item,
        event: "generated",
        via: "model",
        text: model,
        llm: llmFrom(kind === "comment" ? "comments.sort" : "reddit.draft", null),
        meta: { backfilled: true },
        ref: `bf:${item}:generated`,
        at: edits[0]?.at && edits[0].at < at ? new Date(edits[0].at.getTime() - 1) : at,
      });
    out.push(...edits);
    if (r.answer_ref && r.answer)
      out.push({
        ...base,
        item,
        event: "sent",
        via: "person",
        text: String(r.answer),
        externalId: str(r.answer_ref),
        ref: `bf:${item}:sent`,
        at: when(r.answered_at ?? r.created_at),
      });
    else if (r.state === "dropped" && model)
      out.push({
        ...base,
        item,
        event: "rejected",
        via: "person",
        text: str(r.draft) ?? model,
        ref: `bf:${item}:rejected`,
        at: r.dropped_at ? when(r.dropped_at) : later(edits.at(-1)?.at ?? at),
      });
  }
  return out;
}

/**
 * The DMs he sent by hand: one round each, a first message after an accepted invite under
 * `invite:`, the rest under `dm:`. A model draft he changed at send left its words in the
 * ledger's `before`; one sent untouched is only his send.
 */
async function dmSteps(db: Queryable): Promise<DraftStep[]> {
  const rows = await db.execute<Raw>(sql`
    select m.id, m.contact_id, m.body, m.created_at, c.platform, c.connected_at,
      exists (select 1 from reach_messages p where p.contact_id = m.contact_id
        and p.created_at < m.created_at
        and (p.direction = 'in' or p.kind not in ('connect'))) answered_before
    from reach_messages m join reach_contacts c on c.id = m.contact_id
    where m.direction = 'out' and m.kind = 'manual'
    order by m.contact_id, m.created_at, m.id`);
  const runs = await db.execute<Raw>(sql`
    select id::text id, argv, stats, started_at from runs
    where command = 'draft-set' and argv->>'record' in ('dm', 'invite') and argv ? 'sent'
      and finished_at is not null
    order by started_at, id`);
  const out: DraftStep[] = [];
  const rounds = new Map<string, number>();
  for (const m of rows) {
    const contact = String(m.contact_id);
    const at = when(m.created_at);
    const edit = runs.find(
      (r) =>
        str((r.argv as Raw).id) === contact &&
        Math.abs(when(r.started_at).getTime() - at.getTime()) < 60_000,
    );
    const record =
      str((edit?.argv as Raw | undefined)?.record) ??
      (m.connected_at && !m.answered_before ? "invite" : "dm");
    const item = `${record}:${contact}`;
    const round = (rounds.get(item) ?? 0) + 1;
    rounds.set(item, round);
    const base: Partial<DraftStep> = {
      kind: record as "dm" | "invite",
      platform: str(m.platform),
      round,
    };
    const stats = (edit?.stats ?? {}) as Raw;
    if (edit && str(stats.before)) {
      const editAt = when(edit.started_at);
      out.push({
        ...base,
        item,
        event: "generated",
        via: "model",
        text: str(stats.before),
        llm: llmFrom("reach.dm_draft", null),
        meta: { backfilled: true },
        ref: `bf:${item}:${m.id}:generated`,
        at: new Date(Math.min(editAt.getTime(), at.getTime()) - 2),
      });
      out.push({
        ...base,
        item,
        event: "edited",
        via: "person",
        by: str((edit.argv as Raw).by),
        text: str(stats.draft),
        meta: { at_send: true },
        runId: str(edit.id),
        ref: `bf:run:${edit.id}`,
        at: new Date(Math.min(editAt.getTime(), at.getTime()) - 1),
      });
    }
    out.push({
      ...base,
      item,
      event: "sent",
      via: "person",
      by: str((edit?.argv as Raw | undefined)?.by),
      text: String(m.body),
      meta: { message: Number(m.id) },
      ref: `bf:${item}:${m.id}:sent`,
      at,
    });
  }
  return out;
}

/**
 * A video's title and description: what they started as (each change run keeps what it
 * replaced), then each change, Claude's when an Ask made it.
 */
async function videoSteps(db: Queryable): Promise<DraftStep[]> {
  const videos = await db.execute<Raw>(sql`
    select id, title, description, created_at from video_edits order by id`);
  const runs = await db.execute<Raw>(sql`
    select id::text id, command, argv, stats, started_at from runs
    where command like 'video %' and argv ? 'id' and finished_at is not null
      and not stats ? 'error'
      and (stats->'before' ? 'title' or stats->'before' ? 'description')
    order by started_at, id`);
  const out: DraftStep[] = [];
  for (const v of videos) {
    const id = String(v.id);
    const item = `video:${id}`;
    const base: Partial<DraftStep> = { kind: "video", platform: "youtube", round: 1 };
    const mine = runs.filter((r) => str((r.argv as Raw).id) === id);
    // Walk back from today's words: each run's `before` is the state ahead of it.
    let now = { title: String(v.title), description: String(v.description) };
    const after: { run: Raw; words: typeof now }[] = [];
    for (const r of [...mine].reverse()) {
      after.unshift({ run: r, words: now });
      const before = ((r.stats as Raw).before ?? {}) as Raw;
      now = {
        title: before.title !== undefined ? String(before.title) : now.title,
        description:
          before.description !== undefined ? String(before.description) : now.description,
      };
    }
    if (!now.title && !now.description && !after.length) continue;
    out.push({
      ...base,
      item,
      event: "generated",
      via: "wren",
      by: "video add",
      text: now.description,
      title: now.title,
      ref: `${item}:first`,
      at: when(v.created_at),
    });
    let prev = now;
    for (const { run, words } of after) {
      if (words.title === prev.title && words.description === prev.description) continue;
      prev = words;
      out.push({
        ...base,
        item,
        event: "edited",
        via: String(run.command).includes("ask") ? "claude" : "person",
        by: str((run.argv as Raw).by),
        text: words.description,
        title: words.title,
        meta: run.command === "video undo" ? { undo: true } : {},
        runId: str(run.id),
        ref: `bf:run:${run.id}`,
        at: when(run.started_at),
      });
    }
  }
  return out;
}

/** Fold every draft's old history into `draft_events`. A dry run counts and writes nothing. */
export async function backfillTraining(
  db: Queryable,
  o: { dryRun?: boolean } = {},
): Promise<BackfillReport> {
  const all = [
    ...(await postSteps(db)),
    ...(await answerSteps(db, "comment")),
    ...(await answerSteps(db, "thread")),
    ...(await dmSteps(db)),
    ...(await videoSteps(db)),
  ];
  const items = [...new Set(all.map((s) => s.item))];
  const liveRows = items.length
    ? await db.execute<{ item: string }>(sql`
        select distinct item from draft_events
        where (ref is null or ref not like 'bf:%') and ref is distinct from item || ':first'
          and item in (${sql.join(
            items.map((i) => sql`${i}`),
            sql`, `,
          )})`)
    : [];
  const live = new Set(liveRows.map((r) => r.item));
  const steps = all.filter((s) => !live.has(s.item));
  const refs = steps.map((s) => s.ref).filter((r): r is string => !!r);
  const keptRows = refs.length
    ? await db.execute<{ ref: string }>(sql`
        select ref from draft_events where ref in (${sql.join(
          refs.map((r) => sql`${r}`),
          sql`, `,
        )})`)
    : [];
  const kept = new Set(keptRows.map((r) => r.ref));
  // Oldest first, so ids follow time and break a tie in `at` the way the history ran.
  const fresh = steps
    .filter((s) => !s.ref || !kept.has(s.ref))
    .sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
  if (!o.dryRun) for (const s of fresh) await recordDraft(db, s);
  return {
    items: items.length - live.size,
    live: live.size,
    steps: steps.length,
    written: fresh.length,
  };
}
