/**
 * `wren books …`: the business's books. `import` keeps every billing email
 * since the books began (the raw message and its PDFs, forever), reads each
 * into a bill with its lines, taxes and payments, and posts the journal. The
 * rest read the books back, or settle what the checks held for a look.
 */
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import * as clients from "@restatedev/restate-sdk-clients";
import {
  ALERT_KINDS,
  type AlertKind,
  assignVendor,
  bankOfCanada,
  billDetail,
  capture,
  type DocumentStore,
  delegatedMailbox,
  dirStore,
  dismissDocuments,
  formatCents,
  formatMoney,
  getDocument,
  listBills,
  listPayments,
  listSpend,
  listSubscriptions,
  type Mailbox,
  openAlerts,
  post,
  readDocuments,
  reviewQueue,
  s3Store,
  seedBooks,
  setReview,
  siteMailbox,
  today,
  usageMonth,
} from "@wren/books";
import { BOOKS_KEY, type Books } from "@wren/books/restate";
import { expandHome, GmailClient } from "@wren/channel-email";
import { ingressOf, type Settings } from "@wren/config";
import { recordedRun } from "@wren/core";
import type { Db } from "@wren/db";
import { loadLlmEnv, makeLlm } from "@wren/llm";
import type { Command } from "commander";
import { ingressSites } from "./sites.js";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const json = (v: unknown) => console.log(JSON.stringify(v, null, 2));
const log = (line: string) => console.log(line);

const idOf = (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`not an id: ${v}`);
  return n;
};
const dayOf = (v: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`not a day (YYYY-MM-DD): ${v}`);
  return v;
};
const cad = (cents: number | null) => (cents === null ? "-" : formatCents(cents));
const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? "-";

type Detail = NonNullable<Awaited<ReturnType<typeof billDetail>>>;

function printBill(d: Detail): void {
  const { bill, cost } = d;
  const money = (cents: number) => formatMoney(cents, bill.currency);
  console.log(
    `bill ${bill.id}: ${cost?.vendorName ?? "?"} ${bill.number} (${bill.kind}, ${bill.review})`,
  );
  for (const r of bill.reviewReasons) console.log(`  held: ${r}`);
  const facts: Array<[string, string | null | undefined]> = [
    ["issued", bill.issuedOn],
    ["due", bill.dueOn],
    ["period", bill.periodStart && `${bill.periodStart} to ${bill.periodEnd}`],
    ["plan", bill.plan],
    ["cycle", bill.cycle],
    ["paid by", bill.paymentMethod],
    ["billed to", bill.billedTo],
    ["vendor tax number", bill.vendorTaxNumber],
    ["account", cost?.account],
  ];
  for (const [k, v] of facts) if (v) console.log(`${k}: ${v}`);
  console.log("lines:");
  for (const l of d.lines) {
    const each = [l.quantity && `x ${l.quantity}`, l.unitPrice && `@ ${l.unitPrice}`]
      .filter(Boolean)
      .join(" ");
    const period = l.periodStart ? `  (${l.periodStart} to ${l.periodEnd})` : "";
    console.log(`  ${l.description}${each ? ` ${each}` : ""}: ${money(l.amountCents)}${period}`);
  }
  console.log(`subtotal: ${money(bill.subtotalCents)}`);
  for (const t of d.taxes) {
    const rate = t.ratePercent === null ? "" : ` ${Number(t.ratePercent)}%`;
    const tags = [t.claimable ? "claimable" : "cost", t.taxNumber].filter(Boolean).join(", ");
    console.log(`  ${t.name}${rate}: ${money(t.amountCents)} (${tags})`);
  }
  const charged =
    bill.chargedCadCents === null ? "" : `, charged ${formatMoney(bill.chargedCadCents, "CAD")}`;
  console.log(`total: ${money(bill.totalCents)}${charged}`);
  if (cost?.cadCents != null)
    console.log(
      `in CAD: ${formatMoney(cost.cadCents, "CAD")}, expense ${formatMoney(cost.costCadCents ?? 0, "CAD")}`,
    );
  if (d.payments.length) console.log("payments:");
  for (const p of d.payments)
    console.log(
      `  ${p.paidOn} ${formatMoney(p.amountCents, p.currency)}${p.method ? ` by ${p.method}` : ""}${
        p.reference ? `, ref ${p.reference}` : ""
      } (document ${p.documentId})`,
    );
  console.log("documents:");
  for (const doc of d.documents)
    console.log(
      doc.parentId === null
        ? `  ${doc.id} ${doc.mediaType === "message/rfc822" ? "email" : doc.mediaType} ${day(doc.sentAt)} ${doc.fromAddress ?? ""}: ${doc.subject ?? ""}`
        : `    ${doc.id} ${doc.filename ?? doc.mediaType} (${doc.size} bytes)`,
    );
  let entryId: number | null = null;
  if (d.journal.length) console.log("journal:");
  for (const { entry, line, account } of d.journal) {
    if (entry.id !== entryId) {
      entryId = entry.id;
      console.log(`  entry ${entry.id} ${entry.postedOn}: ${entry.memo ?? ""}`);
    }
    const foreign =
      line.currency === "CAD"
        ? ""
        : ` (${formatMoney(line.amountCents, line.currency)} at ${Number(line.rate)}, ${line.rateSource})`;
    console.log(
      `    ${account.padEnd(22)} ${formatCents(line.cadCents).padStart(12)} CAD${foreign}`,
    );
  }
}

export function registerBooks(
  program: Command,
  withDb: WithDb,
  settings: Settings,
  rootDir: string,
): void {
  const books = program
    .command("books")
    .description("The books: bills from the mailboxes, spend, subscriptions, what needs a look");

  const store = (): DocumentStore =>
    settings.booksBucket ? s3Store(settings.booksBucket) : dirStore(resolve(rootDir, ".books"));
  const mailboxOf = (m: Settings["booksMailboxes"][number]): Mailbox =>
    m.via === "delegated"
      ? delegatedMailbox(
          new GmailClient({ keyPath: expandHome(settings.googleServiceAccount) }),
          m.address,
        )
      : siteMailbox(ingressSites(settings, "wren:books"), m.address);
  const reader = () => {
    if (settings.llm === "fake")
      throw new Error("books reads bills with a real model; WREN_LLM is fake");
    // Provider keys live in llm.env (or the host's env); never logged.
    loadLlmEnv(settings.llmEnvPath, rootDir);
    return makeLlm(settings.llm, process.env, { anthropicModel: settings.llmModel });
  };
  const posting = (db: Db, runId: string) =>
    post(db, { feed: bankOfCanada(), runId, log }).then((p) => {
      console.log(`posted ${p.posted}, reversed ${p.reversed}, unchanged ${p.unchanged}`);
      return p;
    });

  books
    .command("import")
    .description("Keep new billing mail from each mailbox, read it into bills, post the journal")
    .option("--since <day>", "first day to look at", dayOf, settings.booksSince)
    .option("--mailbox <address>", "only this mailbox")
    .action(async (opts: { since: string; mailbox?: string }) => {
      const mailboxes = settings.booksMailboxes.filter(
        (m) => !opts.mailbox || m.address === opts.mailbox,
      );
      if (!mailboxes.length)
        throw new Error(
          opts.mailbox
            ? `${opts.mailbox} is not in WREN_BOOKS_MAILBOXES`
            : "no mailboxes: set WREN_BOOKS_MAILBOXES to address:delegated or address:autobrowse, comma separated",
        );
      const llm = reader();
      const documents = store();
      const { run, stats } = await withDb((db) =>
        recordedRun(db, { command: "books import", argv: opts }, async (r) => {
          await seedBooks(db);
          const captured = [];
          for (const m of mailboxes) {
            const c = await capture(db, mailboxOf(m), {
              since: opts.since,
              store: documents,
              runId: r.id,
              log,
            });
            console.log(
              `${c.mailbox}: ${c.found} found, ${c.known} known, ${c.kept} kept (${c.attachments} pdf, ${c.unmatched} no vendor)`,
            );
            captured.push(c);
          }
          const read = await readDocuments(db, llm, { runId: r.id, log });
          console.log(
            `read ${read.read}: ${read.bills} bills (${read.review} held), ${read.payments} payments, ${read.unreadable} unreadable${read.voided ? `, ${read.voided} void` : ""}`,
          );
          return { captured, read, posted: await posting(db, r.id) };
        }),
      );
      console.log(`run ${run.id}`);
      if (stats.read.review || stats.read.unreadable || stats.captured.some((c) => c.unmatched))
        console.log("some need a look: wren books review");
    });

  books
    .command("read [documents...]")
    .description("Read documents again (all unread when none are named), then post")
    .option("--vendor <key>", "who sent them, when no sender rule matched")
    .action(async (ids: string[], opts: { vendor?: string }) => {
      const documentIds = ids.map(idOf);
      if (opts.vendor && !documentIds.length) throw new Error("--vendor needs document ids");
      const llm = reader();
      await withDb((db) =>
        recordedRun(
          db,
          { command: "books read", argv: { ids: documentIds, ...opts } },
          async (r) => {
            if (opts.vendor) await assignVendor(db, documentIds, opts.vendor);
            const read = await readDocuments(db, llm, {
              runId: r.id,
              log,
              ...(documentIds.length ? { ids: documentIds } : {}),
            });
            console.log(
              `read ${read.read}: ${read.bills} bills (${read.review} held), ${read.payments} payments, ${read.unreadable} unreadable${read.voided ? `, ${read.voided} void` : ""}`,
            );
            return { read, posted: await posting(db, r.id) };
          },
        ),
      );
    });

  books
    .command("post")
    .description("Make the journal match the bills (idempotent)")
    .action(async () => {
      await withDb((db) =>
        recordedRun(db, { command: "books post", argv: {} }, (r) => posting(db, r.id)),
      );
    });

  for (const [verb, review, what] of [
    ["accept", "accepted", "Post held bills as read"],
    ["personal", "personal", "Keep bills out of the books (not the business's)"],
  ] as const)
    books
      .command(`${verb} <bills...>`)
      .description(what)
      .action(async (ids: string[]) => {
        const billIds = ids.map(idOf);
        await withDb((db) =>
          recordedRun(db, { command: `books ${verb}`, argv: { ids: billIds } }, async (r) => {
            for (const id of billIds)
              if (!(await setReview(db, id, review))) throw new Error(`no bill ${id}`);
            return posting(db, r.id);
          }),
        );
      });

  books
    .command("dismiss <documents...>")
    .description("Emails that are not billing: keep them, stop asking")
    .action(async (ids: string[]) => {
      const n = await withDb((db) => dismissDocuments(db, ids.map(idOf)));
      console.log(`dismissed ${n} documents`);
    });

  books
    .command("review")
    .description("What needs a look: held bills, payments with no bill, emails that gave nothing")
    .option("--json", "print JSON")
    .action(async (opts: { json?: boolean }) => {
      const q = await withDb(reviewQueue);
      if (opts.json) return json(q);
      if (!q.bills.length && !q.payments.length && !q.documents.length)
        return console.log("nothing needs a look");
      if (q.bills.length) console.log("held bills (accept, personal, or read the document again):");
      for (const b of q.bills) {
        console.log(
          `  ${b.id} ${b.issuedOn} ${b.vendor} ${b.number}: ${formatMoney(b.totalCents, b.currency)}`,
        );
        for (const r of b.reasons) console.log(`      ${r}`);
      }
      if (q.payments.length) console.log("payments no bill claims:");
      for (const p of q.payments)
        console.log(
          `  ${p.paidOn} ${p.vendor} toward ${p.invoiceNumber}: ${formatMoney(p.amountCents, p.currency)} (document ${p.documentId})`,
        );
      if (q.documents.length) console.log("emails that gave nothing (read again, or dismiss):");
      for (const d of q.documents) {
        console.log(`  ${d.id} ${day(d.sentAt)} ${d.fromAddress ?? ""}: ${d.subject ?? ""}`);
        console.log(`      ${[d.why, ...(d.notes ?? [])].join("; ")}`);
      }
    });

  books
    .command("bills")
    .description("Bills, oldest first, with what each cost in CAD")
    .option("--from <day>", "issued on or after", dayOf)
    .option("--to <day>", "issued on or before", dayOf)
    .option("--vendor <key>", "one vendor")
    .option("--review", "only bills held for review")
    .option("--json", "print JSON")
    .action(
      async (opts: {
        from?: string;
        to?: string;
        vendor?: string;
        review?: boolean;
        json?: boolean;
      }) => {
        const rows = await withDb((db) => listBills(db, opts));
        if (opts.json) return json(rows);
        for (const b of rows)
          console.log(
            [
              String(b.billId).padStart(5),
              b.issuedOn,
              (b.vendorName ?? "").padEnd(18),
              (b.number ?? "").padEnd(22),
              formatMoney(b.totalCents ?? 0, b.currency ?? "").padStart(16),
              cad(b.cadCents).padStart(12),
              b.review,
            ].join("  "),
          );
        const total = rows.reduce((sum, b) => sum + (b.cadCents ?? 0), 0);
        console.log(`${rows.length} bills, ${formatMoney(total, "CAD")} posted`);
      },
    );

  books
    .command("payments")
    .description("Payments, oldest first: the bill each pays, or on account")
    .option("--from <day>", "paid on or after", dayOf)
    .option("--to <day>", "paid on or before", dayOf)
    .option("--vendor <key>", "one vendor")
    .option("--json", "print JSON")
    .action(async (opts: { from?: string; to?: string; vendor?: string; json?: boolean }) => {
      const rows = await withDb((db) => listPayments(db, opts));
      if (opts.json) return json(rows);
      for (const p of rows)
        console.log(
          [
            p.paidOn,
            p.vendor.padEnd(18),
            formatMoney(p.amountCents, p.currency).padStart(16),
            p.invoiceNumber === null
              ? "on account"
              : `toward ${p.invoiceNumber}${p.billId === null ? " (no bill yet)" : ` (bill ${p.billId})`}`,
            p.method ?? "",
          ]
            .join("  ")
            .trimEnd(),
        );
      console.log(`${rows.length} payments`);
    });

  books
    .command("show <bill>")
    .description("One bill in full: as printed, what paid it, its documents, how it posted")
    .option("--json", "print JSON")
    .action(async (id: string, opts: { json?: boolean }) => {
      const detail = await withDb((db) => billDetail(db, idOf(id)));
      if (!detail) throw new Error(`no bill ${id}`);
      if (opts.json) return json(detail);
      printBill(detail);
    });

  books
    .command("spend")
    .description("Expense by month, account and vendor, in CAD")
    .option("--from <day>", "from this month", dayOf)
    .option("--to <day>", "to this month", dayOf)
    .option("--json", "print JSON")
    .action(async (opts: { from?: string; to?: string; json?: boolean }) => {
      const rows = await withDb((db) => listSpend(db, opts));
      if (opts.json) return json(rows);
      let month: string | null = null;
      let monthTotal = 0;
      let total = 0;
      const close = () => {
        if (month) console.log(`  ${"total".padEnd(52)} ${formatCents(monthTotal).padStart(12)}`);
      };
      for (const r of rows) {
        if (r.month !== month) {
          close();
          month = r.month;
          monthTotal = 0;
          console.log(month?.slice(0, 7));
        }
        const account = `${r.accountName ?? r.account}${r.t2125Line ? ` (${r.t2125Line})` : ""}`;
        console.log(
          `  ${account.padEnd(30)} ${(r.vendorName ?? "-").padEnd(21)} ${formatCents(r.cadCents ?? 0).padStart(12)}`,
        );
        monthTotal += r.cadCents ?? 0;
        total += r.cadCents ?? 0;
      }
      close();
      console.log(`${formatMoney(total, "CAD")} in all`);
    });

  books
    .command("subs")
    .description("Subscriptions: what each costs a month and when it renews")
    .option("--on <day>", "running on this day (default today)", dayOf)
    .option("--json", "print JSON")
    .action(async (opts: { on?: string; json?: boolean }) => {
      const rows = await withDb((db) => listSubscriptions(db, opts));
      if (opts.json) return json(rows);
      for (const s of rows)
        console.log(
          [
            // A plan that already names its vendor ("Google Workspace Business Plus") stands alone.
            (s.plan?.toLowerCase().startsWith((s.vendorName ?? "").toLowerCase())
              ? s.plan
              : `${s.vendorName}${s.plan ? ` ${s.plan}` : ""}`
            ).padEnd(40),
            (s.cycle ?? "").padEnd(8),
            `last ${s.lastBilledOn}`,
            `renews ${s.renewsOn}`,
            `${cad(s.monthlyCadCents).padStart(10)} CAD/month`,
          ].join("  "),
        );
      const monthly = rows.reduce((sum, s) => sum + (s.monthlyCadCents ?? 0), 0);
      console.log(`${formatMoney(monthly, "CAD")} a month`);
    });

  books
    .command("doc <document>")
    .description("Write a kept document (the raw email or a PDF) to a file")
    .option("--out <path>", "where to write it (default: a temp file)")
    .action(async (id: string, opts: { out?: string }) => {
      const doc = await withDb((db) => getDocument(db, idOf(id)));
      if (!doc) throw new Error(`no document ${id}`);
      const out = resolve(
        opts.out ?? join(tmpdir(), `wren-books-${doc.id}${extname(doc.storeKey)}`),
      );
      await writeFile(out, await store().get(doc.storeKey));
      console.log(out);
    });

  books
    .command("alerts")
    .description("What the daily pass raised and is still open")
    .option("--kind <kind>", `only one kind: ${ALERT_KINDS.join(", ")}`)
    .action(async (opts: { kind?: string }) => {
      if (opts.kind && !(ALERT_KINDS as readonly string[]).includes(opts.kind))
        throw new Error(`no alert kind ${opts.kind}: ${ALERT_KINDS.join(", ")}`);
      const rows = await withDb((db) => openAlerts(db, opts.kind as AlertKind | undefined));
      for (const a of rows) console.log(`${day(a.raisedAt)} ${a.kind.padEnd(16)} ${a.message}`);
      if (!rows.length) console.log("nothing open");
    });

  books
    .command("aws")
    .description("AWS spend per service this month so far, beside the same days last month")
    .option("--on <day>", "count up to this day (default today)", dayOf)
    .action(async (opts: { on?: string }) => {
      const on = opts.on ?? today();
      const rows = await withDb((db) => usageMonth(db, "aws", on));
      const sum = (k: "sofar" | "before") => rows.reduce((n, r) => n + r[k], 0);
      console.log(
        `${"service".padEnd(44)} ${"this month".padStart(11)} ${"last month".padStart(11)}`,
      );
      for (const r of rows)
        console.log(
          `${r.service.slice(0, 44).padEnd(44)} ${r.sofar.toFixed(2).padStart(11)} ${r.before.toFixed(2).padStart(11)}`,
        );
      console.log(
        `${"total (USD, through yesterday)".padEnd(44)} ${sum("sofar").toFixed(2).padStart(11)} ${sum("before").toFixed(2).padStart(11)}`,
      );
      if (!rows.length)
        console.log("no spend kept yet: the daily pass takes it in (WREN_BOOKS_AWS_USAGE)");
    });

  const loop = () =>
    clients.connect(ingressOf(settings)).objectClient<Books>({ name: "Books" }, BOOKS_KEY);
  const daily = books
    .command("loop")
    .description("Books/all on the Postgres box: import, read, post, AWS spend and alerts, daily");
  daily.command("status").action(async () => json(await loop().status()));
  daily
    .command("start")
    .description("Daily from now on")
    .action(async () => json(await loop().start()));
  daily.command("stop").action(async () => json(await loop().stop()));
  daily
    .command("sync")
    .description("One pass now")
    .action(async () => json(await loop().sync()));
}
