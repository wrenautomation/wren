/**
 * Documents' reads and writes (designs/2026-10-09-documents.md): templates, filling, totals,
 * the frozen text and its SHA-256, the link's token (only its hash kept), and the signer's
 * steps. Every step is a `doc_events` row: the signing record reads from there.
 */
import { createHash, randomBytes } from "node:crypto";
import { clients } from "@wren/core/clients";
import { PortalRefusal } from "@wren/core/refusal";
import { atomic, type Db, type Queryable } from "@wren/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  depositOf as depositShare,
  fillSlots,
  KIND_NAME,
  KIND_PREFIX,
  money,
  slotsLeft,
  totalsOf,
} from "./lines.js";
import {
  DOC_KINDS,
  type Doc,
  type DocChannel,
  type DocEventType,
  type DocKind,
  type DocLine,
  type DocStatus,
  type DocTemplate,
  docCounters,
  docEvents,
  docs,
  docTemplates,
} from "./schema.js";

export * from "./lines.js";

/** A refusal the person asking can act on, with its HTTP status. */
export class DocRefusal extends PortalRefusal {}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A deposit as a share of the total; the percent checked. */
export function depositOf(total: number, pct: number | null | undefined): number | null {
  if (pct && (!Number.isInteger(pct) || pct < 1 || pct > 100))
    throw new DocRefusal("a deposit is 1 to 100 percent");
  return depositShare(total, pct);
}

export const isKind = (v: unknown): v is DocKind => DOC_KINDS.includes(v as DocKind);

/** The consent box's words. A change to them is a new version. */
export const CONSENT_VERSION = "2026-10-09";
export const CONSENT_WORDS = "I agree to sign electronically. Typing my name is my signature.";

/** Statuses a recipient can still act on. */
export const OPEN: readonly DocStatus[] = ["sent", "viewed"];
/** Statuses a client can still call off. */
const VOIDABLE: readonly DocStatus[] = ["draft", "waiting", "failed", "sent", "viewed"];

const MAX_LINES = 50;
const MAX_LINE_CENTS = 99_999_999;
const MAX_BODY = 50_000;

// ---- Money ----

/** "49", "49.5", "$1,200.00" as cents; refused with a third decimal or past $999,999.99. */
export function centsOf(amount: unknown): number {
  if (typeof amount === "number" && Number.isFinite(amount)) amount = amount.toFixed(2);
  const s = String(amount ?? "")
    .trim()
    .replace(/^\$/, "")
    .replace(/,/g, "");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) throw new DocRefusal("type a price in dollars, as 49.00");
  const [whole, part = ""] = s.split(".");
  return Number(whole) * 100 + Number(part.padEnd(2, "0"));
}

/** Line items as typed, checked: a name, a quantity, a unit price in cents, a tax percent. */
export function linesOf(input: unknown): DocLine[] {
  if (input === undefined || input === null || input === "") return [];
  if (!Array.isArray(input)) throw new DocRefusal("line items come as a list");
  if (input.length > MAX_LINES) throw new DocRefusal(`at most ${MAX_LINES} line items`);
  return input.map((raw, i) => {
    const l = (raw ?? {}) as Record<string, unknown>;
    const n = i + 1;
    const name = String(l.name ?? "")
      .trim()
      .slice(0, 200);
    if (!name) throw new DocRefusal(`line ${n}: name it`);
    const qty = Number(l.qty ?? 1);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 100_000 || Math.round(qty * 100) !== qty * 100)
      throw new DocRefusal(`line ${n}: a quantity above 0, up to two decimals`);
    const unit =
      l.unit_cents !== undefined && l.unit_cents !== null
        ? Number(l.unit_cents)
        : centsOf(l.price ?? l.unit ?? "");
    if (!Number.isInteger(unit) || unit < 0 || unit > MAX_LINE_CENTS)
      throw new DocRefusal(`line ${n}: a price from $0 to $999,999.99`);
    const tax =
      l.tax_pct === undefined || l.tax_pct === null || l.tax_pct === "" ? null : Number(l.tax_pct);
    if (tax !== null && (!Number.isFinite(tax) || tax < 0 || tax > 50))
      throw new DocRefusal(`line ${n}: tax from 0 to 50 percent`);
    const detail =
      typeof l.detail === "string" && l.detail.trim() ? l.detail.trim().slice(0, 500) : null;
    return { name, detail, qty, unit_cents: unit, tax_pct: tax };
  });
}

// ---- The text as shown, and its fingerprint ----

type Shown = Pick<
  Doc,
  | "kind"
  | "number"
  | "title"
  | "body"
  | "lines"
  | "currency"
  | "subtotalCents"
  | "taxCents"
  | "totalCents"
  | "depositCents"
  | "expiresAt"
>;

/** The text the signer sees, one canonical string: what the SHA-256 covers. */
export function shownText(d: Shown): string {
  return JSON.stringify({
    kind: d.kind,
    number: d.number,
    title: d.title,
    body: d.body,
    lines: d.lines.map((l) => [l.name, l.detail ?? null, l.qty, l.unit_cents, l.tax_pct ?? null]),
    currency: d.currency,
    subtotal: d.subtotalCents,
    tax: d.taxCents,
    total: d.totalCents,
    deposit: d.depositCents,
    expires: d.expiresAt ? new Date(d.expiresAt).toISOString().slice(0, 10) : null,
  });
}
export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
export const shaOf = (d: Shown) => sha256(shownText(d));

// ---- The link ----

/** 32 random bytes, base64url: the link carries it, we keep its SHA-256. */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: sha256(token) };
}
export const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const docPath = (token: string) => `/o/d/${token}`;

// ---- Templates ----

export interface TemplateInput {
  id?: string | null;
  kind?: unknown;
  name?: unknown;
  body?: unknown;
  lines?: unknown;
  depositPct?: unknown;
  expiresDays?: unknown;
}

const pctOf = (v: unknown): number | null => {
  if (v === undefined || v === null || v === "" || v === 0 || v === "0") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 100)
    throw new DocRefusal("a deposit is 1 to 100 percent");
  return n;
};
const daysOf = (v: unknown): number => {
  if (v === undefined || v === null || v === "") return 30;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 365) throw new DocRefusal("expires in 1 to 365 days");
  return n;
};
const bodyOf = (v: unknown) => {
  const s = String(v ?? "").replace(/\r\n?/g, "\n");
  if (s.length > MAX_BODY) throw new DocRefusal(`keep the words under ${MAX_BODY} characters`);
  return s;
};

/** The three starters every client gets: plain words it edits. */
export const STARTERS: ReadonlyArray<{
  starter: string;
  kind: DocKind;
  name: string;
  body: string;
  lines: DocLine[];
  depositPct: number | null;
}> = [
  {
    starter: "service",
    kind: "contract",
    name: "Service agreement",
    body: [
      "# Service agreement",
      "",
      "Between {biz.name} and {contact.name}.",
      "",
      "## The work",
      "",
      "{biz.name} will do the work described in our quote or as we agree in writing.",
      "",
      "## Payment",
      "",
      "You pay the amounts we agree, when the work is done unless we say otherwise.",
      "",
      "## Changes",
      "",
      "Either of us can ask for a change. A change in price is agreed in writing first.",
      "",
      "## Ending",
      "",
      "Either of us can end this with written notice. You pay for work done until then.",
    ].join("\n"),
    lines: [],
    depositPct: null,
  },
  {
    starter: "proposal",
    kind: "proposal",
    name: "Proposal",
    body: [
      "# Proposal for {contact.name}",
      "",
      "Thanks for the chance to quote. Here is what we'd do and what it costs.",
      "",
      "## What's included",
      "",
      "- The work in the lines below",
      "- Clean-up when we're done",
      "",
      "Sign below to accept. We'll be in touch to book a start date.",
    ].join("\n"),
    lines: [{ name: "Labor", detail: null, qty: 1, unit_cents: 0, tax_pct: null }],
    depositPct: null,
  },
  {
    starter: "estimate",
    kind: "estimate",
    name: "Estimate",
    body: "Here's the price we talked about. It holds until {doc.expires}. Questions: {biz.phone}.",
    lines: [{ name: "Service", detail: null, qty: 1, unit_cents: 0, tax_pct: null }],
    depositPct: null,
  },
];

/** The starters, once per client: a second call adds nothing. */
export async function ensureStarters(main: Queryable, client: string, by: string): Promise<void> {
  await main
    .insert(docTemplates)
    .values(
      STARTERS.map((s) => ({
        client,
        kind: s.kind,
        name: s.name,
        body: s.body,
        lines: s.lines,
        depositPct: s.depositPct,
        starter: s.starter,
        createdBy: by,
        updatedBy: by,
      })),
    )
    .onConflictDoNothing({ target: [docTemplates.client, docTemplates.starter] });
}

export async function templateById(
  main: Queryable,
  client: string,
  id: string,
): Promise<DocTemplate | null> {
  if (!UUID.test(id)) return null;
  const [t] = await main
    .select()
    .from(docTemplates)
    .where(and(eq(docTemplates.id, id), eq(docTemplates.client, client)));
  return t ?? null;
}

/** A new template, or a change to one of the client's. */
export async function saveTemplate(
  main: Queryable,
  client: string,
  input: TemplateInput,
  by: string,
  now: Date,
): Promise<DocTemplate> {
  const name = String(input.name ?? "").trim();
  if (!name) throw new DocRefusal("name the template");
  if (name.length > 120) throw new DocRefusal("keep the name under 120 characters");
  const values = {
    name,
    body: bodyOf(input.body),
    lines: linesOf(input.lines),
    depositPct: pctOf(input.depositPct),
    expiresDays: daysOf(input.expiresDays),
    updatedAt: now,
    updatedBy: by,
  };
  if (input.id) {
    const was = await templateById(main, client, String(input.id));
    if (!was) throw new DocRefusal("no such template", 404);
    const [row] = await main
      .update(docTemplates)
      .set(values)
      .where(eq(docTemplates.id, was.id))
      .returning();
    return row as DocTemplate;
  }
  if (!isKind(input.kind)) throw new DocRefusal("pick contract, proposal or estimate");
  const [row] = await main
    .insert(docTemplates)
    .values({ ...values, client, kind: input.kind, createdAt: now, createdBy: by })
    .returning();
  return row as DocTemplate;
}

export async function archiveTemplates(
  main: Queryable,
  client: string,
  ids: readonly string[],
  now: Date,
): Promise<number> {
  const good = ids.filter((id) => UUID.test(id));
  if (!good.length) return 0;
  const rows = await main
    .update(docTemplates)
    .set({ archivedAt: now })
    .where(and(eq(docTemplates.client, client), inArray(docTemplates.id, good)))
    .returning({ id: docTemplates.id });
  return rows.length;
}

// ---- Documents ----

async function addEvent(
  db: Queryable,
  document: string,
  type: DocEventType,
  e: {
    by: string;
    at: Date;
    ip?: string | null | undefined;
    agent?: string | null | undefined;
    note?: string | null | undefined;
  },
) {
  await db.insert(docEvents).values({
    document,
    type,
    by: e.by,
    at: e.at,
    ip: e.ip?.slice(0, 64) ?? null,
    agent: e.agent?.slice(0, 500) ?? null,
    note: e.note?.slice(0, 1000) ?? null,
  });
}

export interface NewDoc {
  client: string;
  template?: string | null;
  kind?: unknown;
  title?: unknown;
  body?: unknown;
  lines?: unknown;
  depositPct?: unknown;
  expiresDays?: unknown;
  name?: string | null;
  email?: string | null;
  contact?: number | null;
  channel?: DocChannel | null;
  /** Slot values, filled into the words and line names now. */
  facts?: Readonly<Record<string, string>>;
  by: string;
  now: Date;
}

/** Name, email, number and totals as slots: `{contact.*}` and `{doc.*}` over the given facts. */
export function factsFor(
  d: Pick<
    Doc,
    "name" | "email" | "number" | "totalCents" | "depositCents" | "currency" | "expiresAt"
  >,
  facts: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const name = d.name?.trim() ?? "";
  const out: Record<string, string> = { ...facts };
  if (name) {
    out["contact.name"] = name;
    out["contact.first_name"] = name.split(/\s+/)[0] ?? name;
  }
  if (d.email) out["contact.email"] = d.email;
  out["doc.number"] = d.number;
  out["doc.total"] = money(d.totalCents, d.currency);
  if (d.depositCents) out["doc.deposit"] = money(d.depositCents, d.currency);
  if (d.expiresAt)
    out["doc.expires"] = new Date(d.expiresAt).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  return out;
}

/** A new draft: from a template, or blank of a kind. Numbered with the insert. */
export async function makeDoc(main: Db, n: NewDoc): Promise<Doc> {
  const t = n.template ? await templateById(main, n.client, n.template) : null;
  if (n.template && !t) throw new DocRefusal("no such template", 404);
  const kind = t?.kind ?? n.kind;
  if (!isKind(kind)) throw new DocRefusal("pick contract, proposal or estimate");
  const email = n.email?.trim().toLowerCase() || null;
  if (email && !EMAIL.test(email)) throw new DocRefusal("that email doesn't look right");
  const lines = n.lines !== undefined ? linesOf(n.lines) : (t?.lines ?? []);
  const totals = totalsOf(lines);
  const title =
    String(n.title ?? "").trim() ||
    (t ? t.name : KIND_NAME[kind]) + (n.name?.trim() ? ` for ${n.name.trim()}` : "");
  const body = n.body !== undefined ? bodyOf(n.body) : (t?.body ?? "");
  const pct = n.depositPct !== undefined ? pctOf(n.depositPct) : (t?.depositPct ?? null);
  const channel: DocChannel = n.channel ?? (email ? "email" : n.contact ? "sms" : "email");
  return atomic(main, async (tx) => {
    const [c] = await tx
      .insert(docCounters)
      .values({ client: n.client, kind, next: 2 })
      .onConflictDoUpdate({
        target: [docCounters.client, docCounters.kind],
        set: { next: sql`${docCounters.next} + 1` },
      })
      .returning({ next: docCounters.next });
    const number = `${KIND_PREFIX[kind]}-${String((c?.next ?? 2) - 1).padStart(4, "0")}`;
    const draft = {
      name: n.name?.trim().slice(0, 200) || null,
      email,
      number,
      currency: "usd",
      depositCents: depositOf(totals.totalCents, pct),
      expiresAt: null,
      ...totals,
    };
    const facts = factsFor(draft, n.facts);
    const filled = lines.map((l) => ({ ...l, name: fillSlots(l.name, facts) }));
    const [row] = await tx
      .insert(docs)
      .values({
        ...draft,
        client: n.client,
        template: t?.id ?? null,
        kind,
        title: fillSlots(title, facts).slice(0, 200),
        body: fillSlots(body, facts),
        lines: filled,
        contact: n.contact ?? null,
        channel,
        expiresDays: n.expiresDays !== undefined ? daysOf(n.expiresDays) : (t?.expiresDays ?? 30),
        createdAt: n.now,
        createdBy: n.by,
        updatedAt: n.now,
      })
      .returning();
    if (!row) throw new Error("insert returned nothing");
    await addEvent(tx, row.id, "made", { by: n.by, at: n.now });
    return row;
  });
}

export async function docById(main: Queryable, id: string): Promise<Doc | null> {
  if (!UUID.test(id)) return null;
  const [row] = await main.select().from(docs).where(eq(docs.id, id));
  return row ?? null;
}

/** One of a client's documents, or a 404. */
export async function docOf(main: Queryable, client: string, id: string): Promise<Doc> {
  const d = await docById(main, id);
  if (!d || d.client !== client) throw new DocRefusal("no such document", 404);
  return d;
}

export interface DocPatch {
  title?: unknown;
  body?: unknown;
  lines?: unknown;
  depositPct?: unknown;
  expiresDays?: unknown;
  name?: unknown;
  email?: unknown;
  contact?: number | null | undefined;
  channel?: unknown;
}

/** A change to a draft (or one that failed to send). A sent one never changes: duplicate it. */
export async function editDoc(
  main: Queryable,
  client: string,
  id: string,
  p: DocPatch,
  now: Date,
): Promise<Doc> {
  const d = await docOf(main, client, id);
  if (d.status !== "draft" && d.status !== "failed")
    throw new DocRefusal("only a draft changes; duplicate this one to change it", 409);
  const lines = p.lines !== undefined ? linesOf(p.lines) : d.lines;
  const totals = totalsOf(lines);
  const pct =
    p.depositPct !== undefined
      ? pctOf(p.depositPct)
      : d.depositCents && d.totalCents
        ? Math.round((d.depositCents * 100) / d.totalCents)
        : null;
  const email =
    p.email !== undefined
      ? String(p.email ?? "")
          .trim()
          .toLowerCase() || null
      : d.email;
  if (email && !EMAIL.test(email)) throw new DocRefusal("that email doesn't look right");
  const title = p.title !== undefined ? String(p.title ?? "").trim() : d.title;
  if (!title) throw new DocRefusal("give it a title");
  const channel =
    p.channel === "email" || p.channel === "sms" ? (p.channel as DocChannel) : d.channel;
  const [row] = await main
    .update(docs)
    .set({
      title: title.slice(0, 200),
      body: p.body !== undefined ? bodyOf(p.body) : d.body,
      lines,
      ...totals,
      depositCents: depositOf(totals.totalCents, pct),
      expiresDays: p.expiresDays !== undefined ? daysOf(p.expiresDays) : d.expiresDays,
      name:
        p.name !== undefined
          ? String(p.name ?? "")
              .trim()
              .slice(0, 200) || null
          : d.name,
      email,
      contact: p.contact !== undefined ? p.contact : d.contact,
      channel,
      status: "draft",
      why: null,
      updatedAt: now,
    })
    .where(eq(docs.id, d.id))
    .returning();
  return row as Doc;
}

/** Why Send can't go yet: a slot with no value, or nowhere to send it. Null: it can. */
export function sendBlocker(d: Doc): string | null {
  const left = slotsLeft(d.title, d.body, ...d.lines.map((l) => l.name));
  if (left.length) return `Fill ${left.join(", ")} first`;
  if (d.kind !== "contract" && !d.lines.length) return "Add a line item first";
  if (d.channel === "email" && !d.email) return "Add their email first";
  if (d.channel === "sms" && !d.contact) return "Pick their text thread first";
  if (!d.title.trim()) return "Give it a title first";
  return null;
}

/**
 * Send: the slots filled once more with what's known now, checked, the text frozen with its
 * SHA-256 (the expiry is set when it goes). Waits in To approve unless the sender may approve.
 */
export async function askSend(
  main: Db,
  client: string,
  id: string,
  a: { facts: Readonly<Record<string, string>>; by: string; approved: boolean; now: Date },
): Promise<Doc> {
  return atomic(main, async (tx) => {
    const d = await docOf(tx, client, id);
    if (d.status !== "draft" && d.status !== "failed")
      throw new DocRefusal("it's already on its way or done", 409);
    const facts = factsFor(d, a.facts);
    const filled = {
      ...d,
      title: fillSlots(d.title, facts),
      body: fillSlots(d.body, facts),
      lines: d.lines.map((l) => ({ ...l, name: fillSlots(l.name, facts) })),
    };
    const blocked = sendBlocker(filled);
    if (blocked) throw new DocRefusal(blocked, 409);
    const [row] = await tx
      .update(docs)
      .set({
        title: filled.title,
        body: filled.body,
        lines: filled.lines,
        status: a.approved ? "sending" : "waiting",
        why: null,
        updatedAt: a.now,
        ...(a.approved ? { approvedAt: a.now, approvedBy: a.by } : {}),
      })
      .where(eq(docs.id, d.id))
      .returning();
    await addEvent(tx, d.id, "asked", { by: a.by, at: a.now });
    return row as Doc;
  });
}

/** To approve's yes: the waiting ones of these, now on their way. */
export async function approveDocs(
  main: Db,
  ids: readonly string[],
  by: string,
  now: Date,
): Promise<Doc[]> {
  if (!ids.length) return [];
  return main
    .update(docs)
    .set({ status: "sending", approvedAt: now, approvedBy: by, updatedAt: now })
    .where(and(inArray(docs.id, [...ids]), eq(docs.status, "waiting")))
    .returning();
}

/** To approve's no: back to a draft, with who said no. */
export async function declineDocs(
  main: Db,
  ids: readonly string[],
  by: string,
  now: Date,
): Promise<number> {
  if (!ids.length) return 0;
  const rows = await main
    .update(docs)
    .set({ status: "draft", why: `Not approved by ${by}`, updatedAt: now })
    .where(and(inArray(docs.id, [...ids]), eq(docs.status, "waiting")))
    .returning({ id: docs.id });
  return rows.length;
}

/** Called off by the client: the link stops working. A signed one stays signed. */
export async function voidDocs(
  main: Db,
  client: string,
  ids: readonly string[],
  by: string,
  now: Date,
): Promise<number> {
  const good = ids.filter((id) => UUID.test(id));
  if (!good.length) return 0;
  return atomic(main, async (tx) => {
    const rows = await tx
      .update(docs)
      .set({ status: "void", updatedAt: now })
      .where(
        and(eq(docs.client, client), inArray(docs.id, good), inArray(docs.status, [...VOIDABLE])),
      )
      .returning({ id: docs.id });
    for (const r of rows) await addEvent(tx, r.id, "voided", { by, at: now });
    return rows.length;
  });
}

/** A new draft with the same words, lines and recipient: how a sent one is changed. */
export async function duplicateDoc(
  main: Db,
  client: string,
  id: string,
  by: string,
  now: Date,
): Promise<Doc> {
  const d = await docOf(main, client, id);
  return makeDoc(main, {
    client,
    template: d.template,
    kind: d.kind,
    title: d.title,
    body: d.body,
    lines: d.lines,
    depositPct:
      d.depositCents && d.totalCents ? Math.round((d.depositCents * 100) / d.totalCents) : null,
    expiresDays: d.expiresDays,
    name: d.name,
    email: d.email,
    contact: d.contact,
    channel: d.channel as DocChannel,
    by,
    now,
  });
}

/**
 * The link for a send or a reminder: a new token each time, so an older link stops working.
 * The first send sets the expiry and freezes the fingerprint.
 */
export async function issueLink(main: Db, id: string, now: Date): Promise<string> {
  const { token, hash } = newToken();
  await atomic(main, async (tx) => {
    const [d] = await tx.select().from(docs).where(eq(docs.id, id)).for("update");
    if (!d) throw new DocRefusal("no such document", 404);
    const expiresAt = d.expiresAt ?? new Date(now.getTime() + d.expiresDays * 86_400_000);
    const sha = d.sha256 ?? shaOf({ ...d, expiresAt });
    await tx
      .update(docs)
      .set({ tokenHash: hash, expiresAt, sha256: sha, updatedAt: now })
      .where(eq(docs.id, id));
  });
  return token;
}

/** Out: the text queued, or the email gone. A reminder keeps the status it had. */
export async function markSent(
  main: Db,
  id: string,
  s: { message: number | null; by: string; now: Date; remind?: boolean },
): Promise<void> {
  await atomic(main, async (tx) => {
    await tx
      .update(docs)
      .set({
        ...(s.remind ? {} : { status: "sent", sentAt: s.now }),
        message: s.message,
        why: null,
        updatedAt: s.now,
      })
      .where(eq(docs.id, id));
    await addEvent(tx, id, s.remind ? "reminded" : "sent", { by: s.by, at: s.now });
  });
}

export async function markFailed(main: Db, id: string, why: string, now: Date): Promise<void> {
  await main
    .update(docs)
    .set({ status: "failed", why: why.slice(0, 500), updatedAt: now })
    .where(and(eq(docs.id, id), inArray(docs.status, ["sending", "waiting"])));
}

/** A reminder may go: it's out, unsigned and not expired. */
export function remindable(d: Doc, now: Date): string | null {
  if (!OPEN.includes(d.status as DocStatus))
    return "Only a sent, unsigned document gets a reminder";
  if (d.expiresAt && d.expiresAt.getTime() <= now.getTime()) return "It's expired: duplicate it";
  return null;
}

/**
 * The document a link opens, for the owner serving it (`client` null: any, the app host).
 * An open one past its expiry is marked expired here, once.
 */
export async function docByToken(
  main: Db,
  token: string,
  client: string | null,
  now: Date,
): Promise<Doc | null> {
  if (!TOKEN.test(token)) return null;
  const [d] = await main
    .select()
    .from(docs)
    .where(eq(docs.tokenHash, sha256(token)));
  if (!d || (client !== null && d.client !== client)) return null;
  if (
    OPEN.includes(d.status as DocStatus) &&
    d.expiresAt &&
    d.expiresAt.getTime() <= now.getTime()
  ) {
    const done = await atomic(main, async (tx) => {
      const [row] = await tx
        .update(docs)
        .set({ status: "expired", updatedAt: now })
        .where(and(eq(docs.id, d.id), inArray(docs.status, [...OPEN])))
        .returning();
      if (row) await addEvent(tx, d.id, "expired", { by: "wren", at: now });
      return row;
    });
    return done ?? (await docById(main, d.id));
  }
  return d;
}

export interface Visit {
  ip?: string | null | undefined;
  agent?: string | null | undefined;
  now: Date;
}

const VIEW_EVERY_MS = 60 * 60 * 1000;

/** An open of the link: the first marks it viewed; later ones add an event at most hourly. */
export async function seeDoc(main: Db, d: Doc, v: Visit): Promise<"first" | "again" | null> {
  if (!OPEN.includes(d.status as DocStatus)) return null;
  return atomic(main, async (tx) => {
    const [last] = await tx
      .select({ at: docEvents.at })
      .from(docEvents)
      .where(and(eq(docEvents.document, d.id), eq(docEvents.type, "viewed")))
      .orderBy(sql`${docEvents.at} desc`)
      .limit(1);
    if (last && v.now.getTime() - last.at.getTime() < VIEW_EVERY_MS) return null;
    const first = d.status === "sent";
    if (first)
      await tx
        .update(docs)
        .set({ status: "viewed", viewedAt: v.now, updatedAt: v.now })
        .where(and(eq(docs.id, d.id), eq(docs.status, "sent")));
    await addEvent(tx, d.id, "viewed", { by: "recipient", at: v.now, ip: v.ip, agent: v.agent });
    return first ? "first" : "again";
  });
}

export interface Signing extends Visit {
  name: unknown;
  email: unknown;
  consent: unknown;
  /** The SHA-256 the page showed: refused if the text changed since. */
  sha: unknown;
}

/** Signed by a typed name, an email and the consent box, on the text the page showed. */
export async function signDoc(main: Db, d: Doc, s: Signing): Promise<Doc> {
  if (!OPEN.includes(d.status as DocStatus)) throw new DocRefusal("This can't be signed now", 409);
  const name = String(s.name ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 200) throw new DocRefusal("Type your full name");
  const email = String(s.email ?? "")
    .trim()
    .toLowerCase();
  if (!EMAIL.test(email) || email.length > 200) throw new DocRefusal("Give your email");
  if (s.consent !== true && s.consent !== "on" && s.consent !== "yes")
    throw new DocRefusal("Tick the box to agree to sign electronically");
  if (!d.sha256 || s.sha !== d.sha256 || shaOf(d) !== d.sha256)
    throw new DocRefusal(
      "This document changed since you opened it. Reload and read it again.",
      409,
    );
  return atomic(main, async (tx) => {
    const [row] = await tx
      .update(docs)
      .set({
        status: "signed",
        signedAt: s.now,
        signerName: name,
        signerEmail: email,
        signedIp: s.ip?.slice(0, 64) ?? null,
        signedAgent: s.agent?.slice(0, 500) ?? null,
        consentVersion: CONSENT_VERSION,
        updatedAt: s.now,
      })
      .where(and(eq(docs.id, d.id), inArray(docs.status, [...OPEN])))
      .returning();
    if (!row) throw new DocRefusal("This can't be signed now", 409);
    await addEvent(tx, d.id, "signed", {
      by: "recipient",
      at: s.now,
      ip: s.ip,
      agent: s.agent,
      note: `${name} <${email}>`,
    });
    return row;
  });
}

/** Declined by the recipient, with a reason if they gave one. */
export async function declineDoc(main: Db, d: Doc, v: Visit & { why?: unknown }): Promise<Doc> {
  if (!OPEN.includes(d.status as DocStatus))
    throw new DocRefusal("This can't be declined now", 409);
  const why =
    String(v.why ?? "")
      .trim()
      .slice(0, 1000) || null;
  return atomic(main, async (tx) => {
    const [row] = await tx
      .update(docs)
      .set({ status: "declined", declinedAt: v.now, declinedWhy: why, updatedAt: v.now })
      .where(and(eq(docs.id, d.id), inArray(docs.status, [...OPEN])))
      .returning();
    if (!row) throw new DocRefusal("This can't be declined now", 409);
    await addEvent(tx, d.id, "declined", {
      by: "recipient",
      at: v.now,
      ip: v.ip,
      agent: v.agent,
      note: why,
    });
    return row;
  });
}

/** The deposit's pay link, kept once: a second ask reuses it. */
export async function keepPayLink(main: Db, id: string, link: string, now: Date): Promise<void> {
  await main
    .update(docs)
    .set({ payLink: link, updatedAt: now })
    .where(and(eq(docs.id, id), sql`${docs.payLink} is null`));
}

export async function docEventsOf(main: Queryable, id: string) {
  return main
    .select()
    .from(docEvents)
    .where(eq(docEvents.document, id))
    .orderBy(asc(docEvents.at), asc(docEvents.id));
}

/** Documents waiting on a yes, every client's, for To approve. */
export async function waitingDocs(main: Queryable) {
  return main
    .select({
      id: docs.id,
      client: docs.client,
      clientName: clients.name,
      kind: docs.kind,
      number: docs.number,
      title: docs.title,
      name: docs.name,
      email: docs.email,
      channel: docs.channel,
      total: docs.totalCents,
      currency: docs.currency,
      by: docs.createdBy,
      at: docs.updatedAt,
    })
    .from(docs)
    .leftJoin(clients, eq(clients.id, docs.client))
    .where(eq(docs.status, "waiting"))
    .orderBy(asc(docs.updatedAt));
}

/** The To approve item for a document: `doc:<id>`. A bare id reads as itself. */
export const docApprovalId = (id: string) => `doc:${id}`;
export const docIdOf = (id: string) => (id.startsWith("doc:") ? id.slice(4) : id);
