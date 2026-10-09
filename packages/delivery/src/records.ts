/**
 * The project as records: steps, updates, asks, deliverables, paperwork and results. Rows are
 * built per request from what `deliveryHome` reads for this viewer (a client never sees a team
 * note), so the portal's List, Queue and Overview draw them like any other record.
 */

import { CHANGE_FIELDS, CHANGE_VIEWS } from "@wren/core/clients";
import { PortalRefusal } from "@wren/core/portal";
import {
  actor,
  date,
  defineRecord,
  link,
  money,
  number,
  prose,
  type RecordType,
  type State,
  status,
  text,
} from "@wren/core/records";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import {
  amount,
  type DeliveryHome,
  deliveryHome,
  invoicesOf,
  timeline,
  type UpdateView,
  WORK_APP,
} from "./index.js";

/** Wren's own notes on a project: a client's people never see a change to them. */
const TEAM_TABLES = [
  "delivery.flags",
  "delivery.health_ratings",
  "delivery.health_overrides",
  "delivery.pulses",
  "delivery.moments",
];
type Event = {
  id: string;
  table_name: string;
  row_key: Record<string, unknown> | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
};

/**
 * One client's changes from main's log, the last 7 days, as `audit_changes` lines: its row, its
 * people, and its projects' rows. An insert logs only the key, so a row's project is read from
 * the row; a row deleted since is matched by what its delete logged. A team-only update is left out.
 */
export async function clientChanges(db: Queryable, clientId: string) {
  const events = await db.execute<Event>(sql`
    select id::text id, table_name, row_key, old_values, new_values from audit_events
    where at > now() - interval '7 days'
      and (table_name like 'delivery.%' or table_name in ('clients', 'client_members'))
      and not table_name = any(${`{${TEAM_TABLES}}`}::text[])`);
  const mine = new Set(
    (
      await db.execute<{ id: number }>(
        sql`select id from delivery.engagements where client_id = ${clientId}`,
      )
    ).map((r) => String(r.id)),
  );
  const field = (e: Event, k: string) => e.row_key?.[k] ?? e.new_values?.[k] ?? e.old_values?.[k];
  // Rows logged by id alone: their project and team flag, read once per table.
  const live = new Map<string, Map<string, { engagement: string; internal: boolean }>>();
  for (const table of new Set(events.map((e) => e.table_name))) {
    if (!/^delivery\.[a-z_]+$/.test(table) || table === "delivery.member_mail") continue;
    const ids = events
      .filter((e) => e.table_name === table && e.row_key?.id != null)
      .map((e) => Number(e.row_key?.id));
    if (!ids.length) continue;
    const engagement = table === "delivery.engagements" ? "id" : "engagement_id";
    const internal = table === "delivery.updates" ? "internal" : "false";
    const rows = await db.execute<{ id: number; engagement: number; internal: boolean }>(
      sql`select id, ${sql.raw(engagement)} engagement, ${sql.raw(internal)} internal
          from ${sql.raw(table)} where id = any(${`{${ids}}`}::int[])`,
    );
    live.set(
      table,
      new Map(
        rows.map((r) => [String(r.id), { engagement: String(r.engagement), internal: r.internal }]),
      ),
    );
  }
  const ours = (e: Event) => {
    if (e.table_name === "clients") return String(e.row_key?.id) === clientId;
    if (e.table_name === "client_members" || e.table_name === "delivery.member_mail")
      return String(field(e, "client_id")) === clientId;
    const row = live.get(e.table_name)?.get(String(e.row_key?.id));
    if (row?.internal || e.old_values?.internal === true || e.new_values?.internal === true)
      return false;
    const engagement =
      e.table_name === "delivery.engagements" ? e.row_key?.id : field(e, "engagement_id");
    return mine.has(String(engagement ?? row?.engagement));
  };
  const ids = events.filter(ours).map((e) => e.id);
  if (!ids.length) return [];
  return db.execute<Record<string, unknown>>(
    sql`select * from audit_changes where id = any(${`{${ids}}`}::text[])`,
  );
}

const STEP: Record<string, State> = {
  late: { label: "Late", tone: "bad" },
  now: { label: "Now", tone: "neutral" },
  next: { label: "Next", tone: "neutral" },
  done: { label: "Done", tone: "good" },
};
const ASK: Record<string, State> = {
  late: { label: "Late", tone: "bad" },
  open: { label: "Open", tone: "warn" },
  answered: { label: "Answered", tone: "good" },
};
const PIECE: Record<string, State> = {
  waiting: { label: "Waiting", tone: "warn" },
  changes: { label: "Changes", tone: "neutral" },
  approved: { label: "Approved", tone: "good" },
};
const SEEN: Record<string, State> = {
  shared: { label: "Shared", tone: "good" },
  team: { label: "Team only", tone: "neutral" },
  hidden: { label: "Hidden", tone: "neutral" },
};
const PAPER: Record<string, State> = {
  sign: { label: "To sign", tone: "warn" },
  pay: { label: "To pay", tone: "warn" },
  open: { label: "To grant", tone: "warn" },
  declined: { label: "Declined", tone: "bad" },
  revoked: { label: "Revoked", tone: "neutral" },
  done: { label: "Done", tone: "good" },
  granted: { label: "Granted", tone: "good" },
};
const BILL: Record<string, State> = {
  open: { label: "Due", tone: "neutral" },
  overdue: { label: "Overdue", tone: "bad" },
  paid: { label: "Paid", tone: "good" },
  void: { label: "Cancelled", tone: "neutral" },
};
const KIND: Record<string, string> = { link: "Link", loom: "Video", doc: "Document", file: "File" };
const figure = (unit: string, v: number | null) =>
  v === null
    ? null
    : unit === "usd"
      ? `$${v.toLocaleString("en-US")}`
      : unit === "hours"
        ? `${v.toLocaleString("en-US")} h`
        : v.toLocaleString("en-US");

/** A project's updates, newest first, a page at a time until they end. */
// ponytail: stops at 500; page the list from the server if a project ever posts more.
async function allUpdates(
  db: Queryable,
  clientId: string,
  operator: boolean,
  engagementId: number,
) {
  const out: UpdateView[] = [];
  let before: number | undefined;
  for (let i = 0; i < 5; i++) {
    const page = await timeline(db, clientId, {
      operator,
      engagementId,
      limit: 100,
      ...(before ? { before } : {}),
    });
    out.push(...page.updates);
    before = page.updates.at(-1)?.id;
    if (!page.more || !before) break;
  }
  return out;
}

/**
 * The types for one client as this viewer sees them, read once per request: the projects run
 * in `app`, or all of them in the work app. Invoices are every project's, read only when
 * `bills` says this viewer may: an owner or Wren. Changes likewise, when `manages` says so.
 * ponytail: a client's projects share one list; split by project if one client ever runs two
 * in the same app at once.
 */
export function deliveryRecords(
  db: Queryable,
  clientId: string,
  operator: boolean,
  app = WORK_APP,
  bills: () => Promise<boolean> = async () => operator,
  manages: () => Promise<boolean> = async () => operator,
): RecordType[] {
  let home: Promise<DeliveryHome> | undefined;
  const es = async () => {
    home ??= deliveryHome(db, clientId, { operator });
    const all = (await home).engagements;
    return app === WORK_APP ? all : all.filter((e) => e.offer.app === app);
  };
  let talk: Promise<(UpdateView & { stepName: string | null })[]> | undefined;
  const updates = () =>
    (talk ??= es().then(async (list) =>
      (
        await Promise.all(
          list.map(async (e) =>
            (
              await allUpdates(db, clientId, operator, e.id)
            ).map((u) => ({
              ...u,
              stepName: e.steps.find((s) => s.key === u.step)?.name ?? null,
            })),
          ),
        )
      ).flat(),
    ));

  const steps = async () =>
    (await es()).flatMap((e) =>
      e.steps.map((s, i) => ({
        id: `${e.id}.${s.key}`,
        name: s.name,
        n: i + 1,
        state: s.state,
        starts: s.plannedFrom,
        due: s.dueOn,
        done: s.doneOn,
        why: s.slipReason,
      })),
    );
  const asks = async () =>
    (await es()).flatMap((e) =>
      e.asks.map((a) => ({
        id: a.id,
        text: a.text,
        state: a.answeredAt ? "answered" : a.overdue ? "late" : "open",
        due: a.dueOn,
        step: e.steps.find((s) => s.key === a.step)?.name ?? null,
        stepid: a.step ? `${e.id}.${a.step}` : null,
        answer: a.answer,
        file: a.file,
        by: a.answeredBy,
        answered: a.answeredAt,
      })),
    );
  const pieces = async () =>
    (await es()).flatMap((e) =>
      e.deliverables.map((d) => ({
        id: d.id,
        title: d.title,
        status: d.status,
        kind: d.file ?? KIND[d.kind],
        version: d.version,
        step: e.steps.find((s) => s.key === d.step)?.name ?? null,
        stepid: d.step ? `${e.id}.${d.step}` : null,
        at: d.at,
        by: d.decidedBy,
        decided: d.decidedAt,
        note: d.decisionNote,
        comments: d.comments.length,
      })),
    );

  const step = defineRecord({
    id: "delivery.step",
    app: "work",
    channel: null,
    name: { one: "step", many: "steps" },
    rows: steps,
    key: "id",
    title: "name",
    fields: {
      name: text("Step"),
      n: number("Order"),
      state: status(STEP, "State"),
      starts: date("Starts"),
      due: date("Due"),
      done: date("Done"),
      why: text("Why it moved"),
    },
    views: [
      { id: "all", label: "Plan", sort: "n" },
      { id: "open", label: "To do", where: { state: ["late", "now", "next"] }, sort: "n" },
      { id: "done", label: "Done", where: { state: ["done"] }, sort: "-done", at: "done" },
    ],
    related: [
      { record: "delivery.ask", by: "stepid" },
      { record: "delivery.deliverable", by: "stepid" },
    ],
    actions: ["delivery.done", "delivery.undone", "delivery.slip"],
  });

  const update = defineRecord({
    id: "delivery.update",
    app: "work",
    channel: null,
    name: { one: "update", many: "updates" },
    rows: async () =>
      (await updates()).map((u) => ({
        id: u.id,
        body: u.body,
        step: u.stepName,
        author: u.author,
        at: u.at,
        seen: operator ? (u.hidden ? "hidden" : u.internal ? "team" : "shared") : null,
        comments: u.comments.length,
      })),
    key: "id",
    title: "body",
    fields: {
      body: text("Update"),
      at: date("Posted"),
      step: text("Step"),
      author: text("From"),
      comments: number("Comments"),
      ...(operator ? { seen: status(SEEN, "Who sees it") } : {}),
    },
    views: [{ id: "all", label: "All updates", sort: "-at", at: "at" }],
    actions: ["delivery.post", "delivery.note", "delivery.hide"],
    load: async (_db, id) => (await updates()).find((u) => String(u.id) === id) ?? null,
  });

  const ask = defineRecord({
    id: "delivery.ask",
    app: "work",
    channel: null,
    name: { one: "ask", many: "asks" },
    rows: asks,
    key: "id",
    title: "text",
    fields: {
      text: text("Ask"),
      state: status(ASK, "State"),
      due: date("Due"),
      step: text("Step"),
      answer: text("Answer"),
      file: text("File"),
      by: actor("Answered by"),
      answered: date("Answered"),
    },
    views: [
      { id: "open", label: "Open", where: { state: ["late", "open"] }, sort: "due" },
      { id: "answered", label: "Answered", where: { state: ["answered"] }, sort: "-answered" },
    ],
    actions: ["delivery.ask", "delivery.answer"],
    load: async (_db, id) =>
      (await es()).flatMap((e) => e.asks).find((a) => String(a.id) === id) ?? null,
  });

  const deliverable = defineRecord({
    id: "delivery.deliverable",
    app: "work",
    channel: null,
    name: { one: "deliverable", many: "deliverables" },
    rows: pieces,
    key: "id",
    title: "title",
    fields: {
      title: text("Title"),
      status: status(PIECE, "State"),
      kind: text("Kind"),
      version: number("Version"),
      at: date("Handed over"),
      step: text("Step"),
      by: actor("Decided by"),
      decided: date("Decided"),
      note: text("Note"),
      comments: number("Comments"),
    },
    views: [
      { id: "waiting", label: "Waiting", where: { status: ["waiting"] }, sort: "-at" },
      { id: "all", label: "All", sort: "-at", at: "at" },
    ],
    actions: ["delivery.deliver", "delivery.version", "delivery.approve", "delivery.changes"],
    load: async (_db, id) =>
      (await es()).flatMap((e) => e.deliverables).find((d) => String(d.id) === id) ?? null,
  });

  const paperwork = defineRecord({
    id: "delivery.paperwork",
    app: "work",
    channel: null,
    name: { one: "item", many: "paperwork" },
    rows: async () =>
      (await es()).flatMap((e) => {
        const p = e.paperwork;
        return [
          ...(p.contract
            ? [
                {
                  id: `c${e.id}`,
                  what: "Contract",
                  state: p.contract.signedAt ? "done" : "sign",
                  scope: "Read and sign it",
                  by: p.contract.signedBy,
                  answered: p.contract.signedAt,
                },
              ]
            : []),
          ...(p.setupPaid === null
            ? []
            : [
                {
                  id: `f${e.id}`,
                  what: "Setup fee",
                  state: p.setupPaid ? "done" : "pay",
                  scope: "Pay the setup invoice",
                },
              ]),
          ...p.access.map((a) => ({
            id: `a${a.id}`,
            what: `Access to ${a.system}`,
            state: a.status,
            scope: a.scope,
            why: a.why,
            revoke: a.revoke,
            note: a.note,
            by: a.answeredBy,
            answered: a.answeredAt,
          })),
        ];
      }),
    key: "id",
    title: "what",
    subtitle: "scope",
    fields: {
      what: text("What"),
      state: status(PAPER, "State"),
      scope: text("What we need"),
      why: text("Why"),
      revoke: text("To take it back"),
      note: text("Note"),
      by: actor("By"),
      answered: date("Done on"),
    },
    views: [
      { id: "all", label: "All" },
      { id: "open", label: "To do", where: { state: ["sign", "pay", "open"] } },
    ],
    actions: ["delivery.grant", "delivery.revoke", "delivery.decline"],
    // Nothing more to read; a detail lets the page add the contract's and the invoice's links.
    load: async (_db, id) => ({ id }),
  });

  const result = defineRecord({
    id: "delivery.result",
    app: "work",
    channel: null,
    name: { one: "result", many: "results" },
    rows: async () =>
      (await es()).flatMap((e) =>
        e.results.map((r) => ({
          id: `${e.id}.${r.key}`,
          label: r.label,
          value: figure(r.unit, r.value),
          note: r.note,
          at: r.at,
        })),
      ),
    key: "id",
    title: "label",
    fields: {
      label: text("Measure"),
      value: text("So far"),
      note: text("Note"),
      at: date("Recorded"),
    },
    views: [{ id: "all", label: "Results" }],
    actions: ["delivery.result"],
  });

  const invoice = defineRecord({
    id: "delivery.invoice",
    app: "work",
    channel: null,
    name: { one: "invoice", many: "invoices" },
    rows: async () => {
      if (!(await bills())) throw new PortalRefusal("billing is for this account's owners", 403);
      return (await invoicesOf(db, clientId)).map((i) => ({
        id: i.id,
        number: i.number,
        status: i.status,
        amount: i.cents / 100,
        currency: i.currency,
        due: i.dueOn,
        description: i.description,
        offer: i.offer,
        sent: i.issuedOn,
        paid: i.paidOn,
        link: i.link,
        lines: i.lines.map((l) => `${l.what}: ${amount(l.cents, i.currency)}`).join("\n"),
      }));
    },
    key: "id",
    title: "number",
    subtitle: "description",
    fields: {
      number: text("Invoice"),
      status: status(BILL, "State"),
      amount: money("Amount"),
      due: date("Due"),
      description: text("For"),
      offer: text("Offer"),
      sent: date("Sent"),
      paid: date("Paid"),
      lines: prose("Lines"),
      link: link("In Wise"),
    },
    views: [
      { id: "all", label: "All invoices", sort: "-sent", at: "sent" },
      { id: "open", label: "To pay", where: { status: ["open", "overdue"] }, sort: "due" },
    ],
  });

  const change = defineRecord({
    id: "delivery.change",
    app: "work",
    channel: null,
    name: { one: "change", many: "changes" },
    rows: async () => {
      if (!(await manages())) throw new PortalRefusal("changes are for this account's owners", 403);
      return clientChanges(db, clientId);
    },
    key: "id",
    title: "change",
    subtitle: "who",
    fields: CHANGE_FIELDS,
    views: CHANGE_VIEWS,
  });

  return [step, update, ask, deliverable, paperwork, result, invoice, change];
}
