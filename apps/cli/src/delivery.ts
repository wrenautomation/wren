/**
 * `wren --client <id> delivery …`: what we do for a client, as Wren's team.
 * The same domain calls as the portal's composer, on the main database (the
 * delivery schema sits beside the registry). `--by` is who the client sees it
 * from; the audit log still names who ran the command.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import * as restateClients from "@restatedev/restate-sdk-clients";
import { siteExport } from "@wren/channel-email";
import { ingressOf, type Settings } from "@wren/config";
import { getClient, listOperators, normalEmail } from "@wren/core/clients";
import { atomic, type Db, type Queryable, serializable } from "@wren/db";
import {
  addAsk,
  addComment,
  addDeliverable,
  addInvoice,
  agreementOf,
  type CommentView,
  DELIVERABLE_KINDS,
  type DeliverableKind,
  deliveryHome,
  ENGAGEMENT_STATUSES,
  type Engagement,
  type EngagementStatus,
  type EngagementView,
  engagementOf,
  hideUpdate,
  type InvoiceView,
  invoicesOf,
  markDone,
  markInvoice,
  amount as money,
  onboard,
  postUpdate,
  recordResult,
  requestAccess,
  setEngagementSource,
  setEngagementStatus,
  slipMilestone,
  sourceHints,
  startEngagement,
  todayUtc,
} from "@wren/delivery";
import { MAX_FILE_BYTES, newFileKey, s3Files, typeOfName } from "@wren/delivery/files";
import { type DeliveryWatch, WATCH, WATCH_KEY } from "@wren/delivery/restate";
import { seedSample } from "@wren/delivery/sample";
import type { Command } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;
type Opts = { by?: string; engagement?: string };

/** "email (spring)", or "unknown". */
const sourceOf = (e: Engagement) =>
  e.sourceChannel
    ? `${e.sourceChannel}${e.sourceCampaign ? ` (${e.sourceCampaign})` : ""}`
    : "unknown";

const idOf = (v: string) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`not an id: ${v}`);
  return n;
};

/** Who it's from: `--by` (an operator), else the only operator there is. */
async function authorOf(db: Db, by: string | undefined): Promise<string> {
  const ops = await listOperators(db);
  if (by) {
    if (!ops.includes(normalEmail(by)))
      throw new Error(`${by} isn't an operator (wren operators list)`);
    return normalEmail(by);
  }
  if (ops.length === 1) return ops[0] as string;
  throw new Error(
    ops.length
      ? `say who it's from: --by ${ops.join(" | ")}`
      : "no operators yet: wren operators add <email>",
  );
}

const thread = (cs: CommentView[]) =>
  cs.map(
    (c) => `      ${c.at.slice(0, 10)} ${c.author}${c.fromWren ? "" : " (client)"}: ${c.body}`,
  );

/** "1,000" or "499.5" dollars as whole cents. */
const centsOf = (v: string): number => {
  const t = v.replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) throw new Error(`not an amount: ${v}`);
  return Math.round(Number(t) * 100);
};

const renderInvoice = (i: InvoiceView) =>
  `  ${i.number} ${i.status.toUpperCase()} · ${i.currency} ${(i.cents / 100).toFixed(2)} · ${i.description} · issued ${i.issuedOn}, due ${i.dueOn}${i.paidOn ? `, paid ${i.paidOn}` : ""}`;

export function renderEngagement(clientId: string, e: EngagementView): string[] {
  const out = [`${clientId} · ${e.offer.name} (#${e.id}) · from ${e.startsOn} · ${e.status}`];
  const p = e.paperwork;
  if (p.contract || p.access.length > 0) {
    out.push("paperwork:");
    if (p.contract)
      out.push(
        `  contract  ${p.contract.signedAt ? `signed by ${p.contract.signedBy} ${p.contract.signedAt.slice(0, 10)}` : `WAITING (issued ${p.contract.issuedAt.slice(0, 10)})`}`,
      );
    if (p.setupPaid !== null) out.push(`  setup fee ${p.setupPaid ? "paid" : "WAITING"}`);
    for (const a of p.access)
      out.push(`  access #${a.id} ${a.status} · ${a.system}${a.note ? ` → ${a.note}` : ""}`);
  }
  out.push("steps:");
  for (const s of e.steps) {
    const moved = s.dueOn !== s.plannedTo ? ` · due ${s.dueOn ?? "-"}: ${s.slipReason ?? ""}` : "";
    const done = s.doneOn ? ` · done ${s.doneOn}` : "";
    out.push(
      `  ${s.state.padEnd(4)}  ${s.key.padEnd(10)} ${s.plannedFrom} → ${s.plannedTo ?? "open"}${moved}${done}`,
    );
  }
  out.push("asks:");
  for (const a of e.asks) {
    const state = a.answeredAt ? `answered by ${a.answeredBy}` : a.overdue ? "OVERDUE" : "open";
    out.push(
      `  #${a.id} ${state} · due ${a.dueOn ?? "-"} · ${a.text}${a.answer ? ` → ${a.answer}` : ""}`,
    );
  }
  out.push("deliverables:");
  for (const d of e.deliverables)
    out.push(
      `  #${d.id} v${d.version} ${d.status}${d.decisionNote ? ` (${d.decisionNote})` : ""} · ${d.title} · ${d.url ?? "file"}`,
      ...thread(d.comments),
    );
  out.push(`results: ${e.results.map((r) => `${r.key} ${r.value ?? "-"}`).join(", ")}`);
  out.push("updates (latest):");
  for (const u of e.updates)
    out.push(
      `  #${u.id} ${u.at.slice(0, 10)} ${u.author}${u.internal ? " [internal]" : ""}${u.hidden ? " [hidden]" : ""}: ${u.body}`,
      ...thread(u.comments),
    );
  return out;
}

export function registerDelivery(program: Command, withMainDb: WithDb, settings: Settings): void {
  const cmd = program
    .command("delivery")
    .description(
      "what we do for a client (needs --client): plan, timeline, deliverables, asks, results",
    );

  /** One change in one transaction, for the --client named, on its engagement. */
  const change = <T>(
    opts: Opts,
    fn: (db: Queryable, e: Engagement, author: string) => Promise<T>,
  ): Promise<T> =>
    withMainDb(async (main) => {
      const id = program.opts<{ client?: string }>().client;
      if (!id) throw new Error("delivery needs --client <id>");
      const client = await getClient(main, id);
      const author = await authorOf(main, opts.by);
      return serializable(main, async (tx) => {
        const e = await engagementOf(
          tx,
          client.id,
          opts.engagement ? idOf(opts.engagement) : undefined,
        );
        return fn(tx, e, author);
      });
    });
  const clientId = () => {
    const id = program.opts<{ client?: string }>().client;
    if (!id) throw new Error("delivery needs --client <id>");
    return id;
  };
  const by = (c: Command) =>
    c.option("--by <email>", "who it's from (an operator; default: the only one)");
  const onEngagement = (c: Command) =>
    by(c).option(
      "--engagement <id>",
      "which engagement, when the client has more than one running",
    );

  by(cmd.command("start <offer>"))
    .description("Start an offer for the client: its plan becomes dated steps, its asks open")
    .requiredOption("--on <date>", "the first day, YYYY-MM-DD")
    .action(async (offerId: string, opts: Opts & { on: string }) => {
      const e = await withMainDb(async (main) => {
        const client = await getClient(main, clientId());
        const author = await authorOf(main, opts.by);
        return serializable(main, (tx) =>
          startEngagement(tx, { clientId: client.id, offerId, startsOn: opts.on, by: author }),
        );
      });
      console.log(`started engagement #${e.id}: ${offerId} from ${e.startsOn}`);
    });

  by(cmd.command("onboard <offer>"))
    .description(
      "Sell an offer: the contract is issued with these terms and access is asked for; signing it, and paying the setup invoice, starts the plan",
    )
    .option("--start <date>", "the start we aim for, YYYY-MM-DD (default: today)")
    .option("--setup <amount>", "setup fee, dollars (default: the offer's)")
    .option("--monthly <amount>", "monthly fee, dollars")
    .option("--per-unit <amount>", "fee per unit, dollars (default: the offer's)")
    .option("--unit <text>", "what a per-unit fee counts (default: the offer's)")
    .option("--cap <amount>", "most the per-unit fees add up to (default: the offer's)")
    .option("--flat", "the offer's all-upfront price instead of per-unit fees")
    .option("--days <n>", "how long it runs (default: the offer's)")
    .option("--currency <code>", "three letters", "USD")
    .option("--pay-days <n>", "days an invoice is due after its date", "7")
    .action(
      async (
        offerId: string,
        opts: Opts & {
          start?: string;
          setup?: string;
          monthly?: string;
          perUnit?: string;
          unit?: string;
          cap?: string;
          days?: string;
          flat?: boolean;
          currency: string;
          payDays: string;
        },
      ) => {
        const { engagement: e, agreement: a } = await withMainDb(async (main) => {
          const client = await getClient(main, clientId());
          const author = await authorOf(main, opts.by);
          return serializable(main, (tx) =>
            onboard(tx, {
              clientId: client.id,
              offerId,
              startsOn: opts.start ?? todayUtc(),
              terms: {
                currency: opts.currency,
                payDays: Number(opts.payDays),
                ...(opts.setup ? { setupCents: centsOf(opts.setup) } : {}),
                ...(opts.monthly ? { monthlyCents: centsOf(opts.monthly) } : {}),
                ...(opts.perUnit ? { perUnitCents: centsOf(opts.perUnit) } : {}),
                ...(opts.unit ? { unit: opts.unit } : {}),
                ...(opts.cap ? { capCents: centsOf(opts.cap) } : {}),
                ...(opts.days ? { days: idOf(opts.days) } : {}),
              },
              flat: opts.flat === true,
              by: author,
            }),
          );
        });
        const t = a.terms;
        console.log(
          [
            `onboarding #${e.id}: ${offerId}, aiming to start ${e.startsOn}`,
            `contract ${a.version} issued; an owner signs it in the portal`,
            t.setupCents > 0
              ? `setup ${money(t.setupCents, t.currency)}: send it through Wise, then \`delivery invoice <number> <amount> --setup --for "Setup" --due <date>\``
              : "no setup fee: signing starts the plan",
          ].join("\n"),
        );
      },
    );

  onEngagement(cmd.command("contract"))
    .description("The contract: who signed it and when, or its full text")
    .option("--text", "print the full text")
    .action(async (opts: Opts & { text?: boolean }) => {
      const a = await withMainDb(async (main) =>
        agreementOf(
          main,
          await engagementOf(main, clientId(), opts.engagement ? idOf(opts.engagement) : undefined),
        ),
      );
      if (!a) return console.log("no contract: this engagement was started without one");
      if (opts.text) return console.log(a.body);
      console.log(
        [
          `version ${a.version}, issued ${a.issuedAt.toISOString().slice(0, 10)} by ${a.issuedBy}`,
          a.signedAt
            ? `signed ${a.signedAt.toISOString()} by ${a.signerName}${a.signerTitle ? `, ${a.signerTitle}` : ""} <${a.signerEmail}> from ${a.signedIp ?? "?"}`
            : "not signed yet",
          `mailed: ${a.mailedAt?.toISOString() ?? "not yet"}`,
          `sha256 ${a.sha256}`,
        ].join("\n"),
      );
    });

  onEngagement(cmd.command("engagement <state>"))
    .description(`Move the engagement on: ${ENGAGEMENT_STATUSES.join(", ")}; done dates its end`)
    .action(async (state: string, opts: Opts) => {
      if (!(ENGAGEMENT_STATUSES as readonly string[]).includes(state))
        throw new Error(`a status is one of ${ENGAGEMENT_STATUSES.join(", ")}`);
      const e = await change(opts, async (tx, e) => {
        await setEngagementStatus(tx, e.clientId, e.id, state as EngagementStatus);
        return engagementOf(tx, e.clientId, e.id);
      });
      console.log(`engagement #${e.id}: ${e.status}${e.endedOn ? `, ended ${e.endedOn}` : ""}`);
    });

  onEngagement(cmd.command("source [channel]"))
    .description(
      "How the client came in, for unit economics: set it, or with no channel see what the site and replies suggest",
    )
    .option("--campaign <name>", "the campaign it came through")
    .option("--clear", "back to unknown")
    .action(
      async (channel: string | undefined, opts: Opts & { campaign?: string; clear?: boolean }) => {
        if (channel || opts.clear) {
          const e = await change(opts, async (tx, e) => {
            await setEngagementSource(tx, e.clientId, e.id, {
              channel: opts.clear ? null : (channel ?? null),
              campaign: opts.clear ? null : (opts.campaign ?? null),
            });
            return engagementOf(tx, e.clientId, e.id);
          });
          return console.log(`engagement #${e.id}: source ${sourceOf(e)}`);
        }
        const applications = settings.siteExportToken
          ? await siteExport("applications", {
              baseUrl: settings.siteBaseUrl,
              exportToken: settings.siteExportToken,
            })
          : [];
        if (!settings.siteExportToken)
          console.log("WREN_SITE_EXPORT_TOKEN is unset: no site hints");
        const { e, hints } = await withMainDb(async (main) => ({
          e: await engagementOf(
            main,
            clientId(),
            opts.engagement ? idOf(opts.engagement) : undefined,
          ),
          hints: await sourceHints(main, clientId(), applications),
        }));
        console.log(`engagement #${e.id}: source ${sourceOf(e)}`);
        if (!hints.length)
          return console.log("no hints: nothing on the site or in replies matches its people");
        for (const h of hints)
          console.log(`  ${h.channel}${h.campaign ? ` --campaign ${h.campaign}` : ""}: ${h.why}`);
      },
    );

  onEngagement(cmd.command("access <system>"))
    .description("Ask, formally, for access to one of the client's systems")
    .requiredOption("--scope <text>", "how much, and no more")
    .requiredOption("--why <text>", "what we need it for")
    .requiredOption("--revoke <text>", "how they take it back")
    .action(async (system: string, opts: Opts & { scope: string; why: string; revoke: string }) => {
      const r = await change(opts, (db, e, author) =>
        requestAccess(db, e, {
          system,
          scope: opts.scope,
          why: opts.why,
          revoke: opts.revoke,
          by: author,
        }),
      );
      console.log(`access #${r.id} asked: ${r.system}`);
    });

  onEngagement(cmd.command("post <text>"))
    .description("A line on the client's timeline")
    .option("--step <key>", "the plan step it belongs to")
    .option("--internal", "Wren's team only; the client never sees it")
    .action(async (text: string, opts: Opts & { step?: string; internal?: boolean }) => {
      const u = await change(opts, (db, e, author) =>
        postUpdate(db, e, { body: text, author, milestone: opts.step, internal: opts.internal }),
      );
      console.log(`posted #${u.id}${u.internal ? " (internal)" : ""}`);
    });

  /** A local file into the client's private folder (D11), with this machine's AWS login. */
  const upload = async (clientId: string, path: string): Promise<string> => {
    if (!settings.filesBucket) throw new Error("WREN_FILES_BUCKET is unset: no files bucket here");
    const type = typeOfName(path);
    if (!type) throw new Error(`not a file type the portal takes: ${basename(path)}`);
    const bytes = await readFile(path);
    if (bytes.length > MAX_FILE_BYTES)
      throw new Error(`files go up to ${MAX_FILE_BYTES / 1024 / 1024} MB`);
    const key = newFileKey(clientId, basename(path));
    await s3Files({ bucket: settings.filesBucket }).put(key, bytes, type);
    return key;
  };

  onEngagement(cmd.command("deliver <title>"))
    .description("Hand something over; the client approves it or asks for changes")
    .option("--link <url>", "a web page (https)")
    .option("--loom <url>", "a Loom video")
    .option("--doc <url>", "a document (https)")
    .option("--file <path>", "a file from this machine (PDF, image, sheet, doc, zip; up to 50 MB)")
    .option("--step <key>", "the plan step it belongs to")
    .option("--replaces <id>", "a new version of that deliverable")
    .action(
      async (
        title: string,
        opts: Opts & {
          link?: string;
          loom?: string;
          doc?: string;
          file?: string;
          step?: string;
          replaces?: string;
        },
      ) => {
        const given = (["link", "loom", "doc", "file"] as const).filter((k) => opts[k]);
        if (given.length !== 1) throw new Error("give one of --link, --loom, --doc, --file");
        const kind = given[0] as DeliverableKind;
        if (!DELIVERABLE_KINDS.includes(kind)) throw new Error(`not a kind: ${kind}`);
        // Level 4 can rerun the body: upload once.
        let fileKey: string | undefined;
        const d = await change(opts, async (db, e, author) => {
          if (opts.file) fileKey ??= await upload(e.clientId, opts.file);
          return addDeliverable(db, e, {
            title,
            kind,
            url: kind === "file" ? undefined : opts[kind as "link" | "loom" | "doc"],
            fileKey,
            milestone: opts.step,
            replaces: opts.replaces ? idOf(opts.replaces) : undefined,
            by: author,
          });
        });
        console.log(`delivered #${d.id} v${d.version}, waiting on the client`);
      },
    );

  onEngagement(cmd.command("ask <text>"))
    .description("Something we need from the client")
    .option("--due <date>", "YYYY-MM-DD")
    .option("--step <key>", "the plan step it belongs to")
    .action(async (text: string, opts: Opts & { due?: string; step?: string }) => {
      const a = await change(opts, (db, e, author) =>
        addAsk(db, e, { text, dueOn: opts.due, milestone: opts.step, by: author }),
      );
      console.log(`asked #${a.id}${a.dueOn ? `, due ${a.dueOn}` : ""}`);
    });

  onEngagement(cmd.command("done <step>"))
    .description("A plan step is done")
    .option("--on <date>", "YYYY-MM-DD (default: today)")
    .option("--undo", "it isn't done after all")
    .action(async (step: string, opts: Opts & { on?: string; undo?: boolean }) => {
      const m = await change(opts, (db, e) =>
        markDone(db, e, { milestone: step, on: opts.undo ? null : (opts.on ?? todayUtc()) }),
      );
      console.log(m.doneOn ? `${m.key} done ${m.doneOn}` : `${m.key} not done`);
    });

  onEngagement(cmd.command("slip <step>"))
    .description("A step moves: the client sees the new date and why")
    .requiredOption("--to <date>", "the new due date, YYYY-MM-DD")
    .requiredOption("--reason <text>", "why, in a sentence the client reads")
    .action(async (step: string, opts: Opts & { to: string; reason: string }) => {
      const m = await change(opts, (db, e) =>
        slipMilestone(db, e, { milestone: step, to: opts.to, reason: opts.reason }),
      );
      console.log(`${m.key} due ${m.dueOn} (planned ${m.plannedTo ?? "open"})`);
    });

  onEngagement(cmd.command("result <key> <value>"))
    .description("One of the offer's measures so far")
    .option("--note <text>")
    .action(async (key: string, value: string, opts: Opts & { note?: string }) => {
      const n = Number(value);
      await change(opts, (db, e, author) =>
        recordResult(db, e, { key, value: n, note: opts.note, by: author }),
      );
      console.log(`${key} = ${n}`);
    });

  by(cmd.command("comment <text>"))
    .description("Reply in the thread under an update or a deliverable; the client is mailed")
    .option("--update <id>", "the update it's under")
    .option("--deliverable <id>", "the deliverable it's under")
    .action(async (text: string, opts: Opts & { update?: string; deliverable?: string }) => {
      if (!opts.update === !opts.deliverable)
        throw new Error("give one of --update, --deliverable");
      const c = await withMainDb(async (main) => {
        const author = await authorOf(main, opts.by);
        return serializable(main, (tx) =>
          addComment(tx, clientId(), {
            on: opts.update
              ? { updateId: idOf(opts.update) }
              : { deliverableId: idOf(opts.deliverable as string) },
            body: text,
            by: author,
            fromWren: true,
          }),
        );
      });
      console.log(`commented #${c.id}`);
    });

  onEngagement(cmd.command("invoice <number> <amount>"))
    .description(
      "An invoice we sent through Wise: the client's owners see it, we're pinged when it's late",
    )
    .requiredOption("--for <text>", "what it's for, as the client reads it")
    .requiredOption("--due <date>", "YYYY-MM-DD")
    .option("--issued <date>", "YYYY-MM-DD (default: today)")
    .option("--currency <code>", "three letters", "USD")
    .option("--link <url>", "Wise's page for it, to view and pay")
    .option("--setup", "the setup fee: paid, with the contract signed, it starts the plan")
    .option("--period <month>", "the month a recurring bill is for, YYYY-MM (stops the 1st's ping)")
    .option("--units <n>", "how many per-unit fees it bills (meetings booked)")
    .action(
      async (
        number: string,
        amount: string,
        opts: Opts & {
          for: string;
          due: string;
          issued?: string;
          currency: string;
          link?: string;
          setup?: boolean;
          period?: string;
          units?: string;
        },
      ) => {
        const i = await change(opts, (db, e, author) =>
          addInvoice(db, e, {
            number,
            description: opts.for,
            cents: centsOf(amount),
            currency: opts.currency,
            issuedOn: opts.issued,
            dueOn: opts.due,
            link: opts.link,
            setup: opts.setup,
            period: opts.period,
            units: opts.units === undefined ? undefined : Number(opts.units),
            by: author,
          }),
        );
        console.log(`invoice ${i.number} open, due ${i.dueOn}${i.setup ? " (setup fee)" : ""}`);
      },
    );

  cmd
    .command("paid <number>")
    .description("An invoice is paid")
    .option("--on <date>", "YYYY-MM-DD (default: today)")
    .option("--undo", "it isn't paid after all")
    .action(async (number: string, opts: { on?: string; undo?: boolean }) => {
      const i = await withMainDb((main) =>
        serializable(main, (tx) =>
          markInvoice(tx, clientId(), number, opts.undo ? "open" : "paid", opts.on),
        ),
      );
      console.log(i.paidOn ? `${i.number} paid ${i.paidOn}` : `${i.number} open`);
    });

  cmd
    .command("void <number>")
    .description("An invoice is cancelled: it stays on record, owed nothing")
    .action(async (number: string) => {
      const i = await withMainDb((main) => markInvoice(main, clientId(), number, "void"));
      console.log(`${i.number} void`);
    });

  cmd
    .command("hide <updateId>")
    .description("Take an update off the client's timeline (kept on record)")
    .action(async (updateId: string) => {
      await withMainDb((main) => hideUpdate(main, clientId(), idOf(updateId)));
      console.log(`hid #${updateId}`);
    });

  cmd
    .command("status")
    .description("Everything the client's Home shows, plus internal notes")
    .option("--json")
    .action(async (opts: { json?: boolean }) => {
      const id = clientId();
      const [home, bills] = await withMainDb(async (main) => {
        await getClient(main, id);
        return Promise.all([deliveryHome(main, id, { operator: true }), invoicesOf(main, id)]);
      });
      if (opts.json) return console.log(JSON.stringify({ ...home, invoices: bills }, null, 2));
      if (home.engagements.length === 0)
        return console.log(`${id}: nothing started (wren --client ${id} delivery onboard <offer>)`);
      for (const e of home.engagements) console.log(renderEngagement(id, e).join("\n"));
      if (bills.length > 0) console.log(["invoices:", ...bills.map(renderInvoice)].join("\n"));
    });

  cmd
    .command("sample")
    .description("Reseed the demo's sample project from today (DeliveryWatch does it weekly)")
    .action(async () => {
      const id = await withMainDb((main) =>
        atomic(main, (tx) => seedSample(tx, clientId(), todayUtc())),
      );
      console.log(`sample engagement #${id}`);
    });

  // Every client at once, so no --client: `wren delivery watch start`.
  const watch = () =>
    restateClients
      .connect(ingressOf(settings))
      .objectClient<DeliveryWatch>({ name: WATCH }, WATCH_KEY);
  const print = (v: unknown) => console.log(JSON.stringify(v, null, 2));
  const w = cmd
    .command("watch")
    .description("DeliveryWatch: client mail and operator pings, hourly; off until started");
  w.command("status").action(async () => print(await watch().status()));
  w.command("start").action(async () => print(await watch().start()));
  w.command("stop").action(async () => print(await watch().stop()));
  w.command("sync")
    .description("one pass now")
    .action(async () => print(await watch().sync()));
}
