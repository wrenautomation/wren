/**
 * The project as records: steps, updates, asks, deliverables, paperwork and results. Rows are
 * built per request from what `deliveryHome` reads for this viewer (a client never sees a team
 * note), so the portal's List, Queue and Overview draw them like any other record.
 */

import {
  date,
  defineRecord,
  number,
  type RecordType,
  type State,
  status,
  text,
} from "@wren/core/records";
import type { Queryable } from "@wren/db";
import { type DeliveryHome, deliveryHome, timeline, type UpdateView, WORK_APP } from "./index.js";

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
 * in `app`, or all of them in the work app.
 * ponytail: a client's projects share one list; split by project if one client ever runs two
 * in the same app at once.
 */
export function deliveryRecords(
  db: Queryable,
  clientId: string,
  operator: boolean,
  app = WORK_APP,
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
      by: text("Answered by"),
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
      by: text("Decided by"),
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
      by: text("By"),
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

  return [step, update, ask, deliverable, paperwork, result];
}
