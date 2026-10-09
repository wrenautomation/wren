/**
 * Documents on Restate (designs/2026-10-09-documents.md).
 *
 * - `send`: an approved document gets a fresh link and goes out: an email from the client's name
 *   when its sends flag is on, or a text through `SmsDesk.reply` as kind `doc` (it waits for the
 *   window). `remind` sends the same again with a new link; the old one stops working.
 * - `serve`, `act`, `pdf`, `deposit`: the signing page's calls, as the portal Worker passes them
 *   at `/o/d/<token>`. No sign-in: the token is the key, and only its SHA-256 is kept.
 *
 * Opened, signed and declined each tell the spine (`trigger.document`), so workflows and the
 * webhooks out hear them. A deposit is a pay link made on the client's Stripe key when the
 * signer asks for it.
 */
import * as restate from "@restatedev/restate-sdk";
import type { SmsDeskService } from "@wren/channel-sms/restate";
import { type Client, clientMembers, findClient, sendsOn } from "@wren/core/clients";
import { customFacts } from "@wren/core/custom-fields";
import { serviceHandler } from "@wren/core/restate";
import type { Fired, FireTriggers } from "@wren/core/spine";
import type { Db } from "@wren/db";
import { payLinks } from "@wren/payments/schema";
import type { PaymentsDeps } from "@wren/payments/service";
import { stripeKeyOf } from "@wren/payments/service";
import {
  createLink,
  keepStripeLink,
  markSent as markPaySent,
  PayRefusal,
} from "@wren/payments/store";
import { StripeError, stripeApi } from "@wren/payments/stripe";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { DOCUMENTS } from "./components.js";
import { docPdf } from "./pdf.js";
import { docPage, lookOf, type PageCtx, shutPage } from "./render.js";
import type { Doc, DocKind } from "./schema.js";
import {
  DocRefusal,
  declineDoc,
  docById,
  docByToken,
  docEventsOf,
  docPath,
  issueLink,
  KIND_NAME,
  keepPayLink,
  markFailed,
  markSent,
  money,
  remindable,
  seeDoc,
  signDoc,
} from "./store.js";

/** Mail from the client's name. */
export type SendMail = (m: { to: string; subject: string; text: string }) => Promise<void>;

export interface DocumentsDeps
  extends Pick<PaymentsDeps, "main" | "open" | "keys" | "fetch" | "portal" | "stripeBase"> {
  /** Mail under a sender's name; null: no document email here. */
  mailer: ((from: string) => SendMail) | null;
  /** The spine's ear for `trigger.document`; unset where no Spine runs. */
  fire?: FireTriggers;
}

export const DOCUMENTS_SERVICE = { name: "Documents" } as const;
/** Wren's own documents are under this client; its link is on Wren's site. */
export const WREN_CLIENT = "wren";
const WREN_HOST = "wrenautomation.com";

/** Where a client's links live: its live domain, else the portal's host. */
export async function hostOf(main: Db, client: string, portal: string): Promise<string> {
  if (client === WREN_CLIENT) return WREN_HOST;
  const rows = await main.execute(sql`
    select hostname from client_domains where client_id = ${client} and status = 'active'
    order by created_at limit 1`);
  const host = ([...rows][0] as { hostname?: string } | undefined)?.hostname;
  return host ?? new URL(portal).host;
}

/** What the page says about the owner: its name, its Look, how to reach it. */
async function ownerOf(main: Db, client: string) {
  const c = await findClient(main, client);
  const facts = await customFacts(main, client === WREN_CLIENT ? null : client).catch(
    () => ({}) as Record<string, string>,
  );
  return {
    client: c,
    business: c?.name ?? "Wren",
    look: lookOf(c?.look),
    reach: { phone: facts["biz.phone"] ?? null, email: facts["biz.email"] ?? null },
  };
}

const kindWord = (d: Pick<Doc, "kind">) => KIND_NAME[d.kind as DocKind].toLowerCase();

/** The text: who it's from, what, the link. */
export const docText = (business: string, d: Doc, url: string, remind = false) =>
  `${business}: ${remind ? "a reminder, " : ""}your ${kindWord(d)} ${d.number} is ready to read and sign: ${url}`;

/** The email: a subject and a few plain lines. */
export function docEmail(business: string, d: Doc, url: string, remind = false) {
  const first = d.name?.trim().split(/\s+/)[0];
  return {
    subject: `${remind ? "Reminder: " : ""}${KIND_NAME[d.kind as DocKind]} ${d.number} from ${business}`,
    text: [
      `Hi ${first || "there"},`,
      "",
      `${remind ? "A reminder: " : ""}${business} sent you ${d.kind === "estimate" ? "an" : "a"} ${kindWord(d)}: ${d.title}.${d.totalCents ? ` Total ${money(d.totalCents, d.currency)}.` : ""}`,
      "",
      "Read and sign it here:",
      url,
      "",
      d.expiresAt ? `It's open until ${new Date(d.expiresAt).toISOString().slice(0, 10)}.` : "",
      "",
      business,
    ]
      .filter((l, i, a) => l !== "" || a[i - 1] !== "")
      .join("\n"),
  };
}

/** A step as the spine hears it: about the recipient's email and their thread. */
export function docFired(d: Doc, change: "viewed" | "signed" | "declined"): Fired {
  return {
    client: d.client,
    facts: { trigger: "trigger.document", change, kind: d.kind },
    about: [
      ...(d.signerEmail ? [d.signerEmail] : d.email ? [d.email] : []),
      ...(d.contact ? [`sms:${d.contact}`] : []),
    ],
    event: {
      subject: `document:${d.id}`,
      kind: "document",
      data: {
        document: d.id,
        number: d.number,
        kind: d.kind,
        title: d.title,
        change,
        total_cents: d.totalCents,
        deposit_cents: d.depositCents,
        currency: d.currency,
        name: d.signerName ?? d.name,
        email: d.signerEmail ?? d.email,
        contact: d.contact,
        why: change === "declined" ? d.declinedWhy : null,
      },
    },
  };
}

/** What the edge answers with: a status and a page, a file, or a place to go. */
export interface Answer {
  status: number;
  html?: string;
  /** The PDF, base64. */
  pdf?: string;
  filename?: string;
  /** A redirect: the deposit's Stripe page. */
  location?: string;
}

interface Asked {
  /** Whose host it was asked on: null on the app host, which serves anyone's. */
  client: string | null;
  token: string;
  siteKey?: string | null;
  ip?: string | null;
  agent?: string | null;
  /** A preview or a crawler: served, never counted as an open. */
  bot?: boolean | null;
}

/** The owner a host serves: Wren's apex is `wren`; the app host any. */
const ownerAsked = (client: string | null | undefined, apex: boolean | null | undefined) =>
  apex ? WREN_CLIENT : (client ?? null);

/** The deposit's state on the page. */
async function depositState(main: Db, d: Doc): Promise<PageCtx["deposit"]> {
  if (!d.depositCents || d.status !== "signed") return null;
  if (!d.payLink) return "pay";
  const [l] = await main
    .select({ status: payLinks.status })
    .from(payLinks)
    .where(eq(payLinks.id, d.payLink));
  return l?.status === "paid" ? "paid" : "pay";
}

/** The page for a document as it stands. */
async function pageFor(
  main: Db,
  d: Doc | null,
  req: Asked,
  extra: Pick<PageCtx, "error" | "typed"> = {},
): Promise<Answer> {
  if (!d) {
    const o = { business: "", look: lookOf(null), reach: { phone: null, email: null } };
    return { status: 404, html: shutPage("missing", o) };
  }
  const o = await ownerOf(main, d.client);
  if (d.status === "expired" || d.status === "void")
    return { status: 410, html: shutPage(d.status, o) };
  if (!["sent", "viewed", "signed", "declined"].includes(d.status))
    return { status: 404, html: shutPage("missing", o) };
  return {
    status: extra.error ? 400 : 200,
    html: docPage(d, {
      business: o.business,
      look: o.look,
      reach: o.reach,
      token: req.token,
      siteKey: req.siteKey ?? null,
      deposit: await depositState(main, d),
      ...extra,
    }),
  };
}

/** The signer and the owners hear of a signature, with the signed copy's link. */
async function mailSigned(deps: DocumentsDeps, d: Doc, url: string) {
  if (!deps.mailer) return;
  const c = await findClient(deps.main, d.client);
  if (!c || !sendsOn(c, DOCUMENTS)) return;
  const send = deps.mailer(c.name);
  const pdf = `${url}/pdf`;
  const what = `${KIND_NAME[d.kind as DocKind]} ${d.number}`;
  if (d.signerEmail)
    await send({
      to: d.signerEmail,
      subject: `Signed: ${what} from ${c.name}`,
      text: `Hi ${d.signerName?.split(/\s+/)[0] ?? "there"},\n\nYou signed ${what}: ${d.title}. Your copy:\n${pdf}\n\n${c.name}`,
    });
  const owners = await deps.main
    .select({ email: clientMembers.email })
    .from(clientMembers)
    .where(and(eq(clientMembers.clientId, d.client), eq(clientMembers.role, "owner")));
  for (const o of owners)
    await send({
      to: o.email,
      subject: `${d.signerName} signed ${what}`,
      text: `${d.signerName} <${d.signerEmail}> signed ${what}: ${d.title}.\n\nThe signed copy: ${pdf}`,
    });
}

type Made = { url: string } | { error: string };

export function makeDocuments(deps: DocumentsDeps) {
  const { main } = deps;
  const now = async (ctx: restate.Context) => new Date(await ctx.date.now());
  const linkOf = async (client: string, token: string) =>
    `https://${await hostOf(main, client, deps.portal)}${docPath(token)}`;
  const ASK = {
    client: z.string().max(40).nullish().describe("The host's owner; null on the app host"),
    apex: z.boolean().nullish().describe("Asked on Wren's own site"),
    token: z.string().max(64).describe("The link's token"),
    siteKey: z.string().max(200).nullish().describe("Turnstile's site key for the page"),
    ip: z.string().max(64).nullish(),
    agent: z.string().max(500).nullish(),
    bot: z.boolean().nullish().describe("A preview or crawler, by its user agent"),
  };
  type Req = Asked & { apex?: boolean | null };

  return restate.service({
    name: DOCUMENTS_SERVICE.name,
    handlers: {
      /** Out with a fresh link; `remind` again with a new one. Anything else is left. */
      send: serviceHandler(
        {
          input: z.looseObject({
            id: z.string().describe("The document's id"),
            remind: z.boolean().nullish().describe("A reminder: the same message, a new link"),
            by: z.string().nullish().describe("Who asked"),
          }),
          effect: "sends",
        },
        async (
          ctx: restate.Context,
          req: { id: string; remind?: boolean | null; by?: string | null },
        ) => {
          const at = await now(ctx);
          const got = await ctx.run("load", async () => {
            const d = await docById(main, req.id);
            if (!d) return null;
            if (req.remind ? remindable(d, at) : d.status !== "sending") return null;
            const c = await findClient(main, d.client);
            if (!c) return null;
            return { doc: d, business: c.name, sends: sendsOn(c, DOCUMENTS) };
          });
          if (!got) return { sent: false, url: null };
          const d = got.doc as unknown as Doc;
          const url = await ctx.run("link", async () =>
            linkOf(d.client, await issueLink(main, d.id, at)),
          );
          const fresh = (await ctx.run("reload", () => docById(main, d.id))) as unknown as Doc;
          let message: number | null = null;
          let why: string | null = null;
          const remind = !!req.remind;
          if (d.channel === "sms" && d.contact) {
            try {
              const r = await ctx.serviceClient<SmsDeskService>({ name: "SmsDesk" }).reply({
                contactId: d.contact,
                body: docText(got.business, fresh, url, remind),
                client: d.client,
                kind: "doc",
              });
              message = r.messageId;
            } catch (err) {
              if (!(err instanceof restate.TerminalError)) throw err;
              why = `Text: ${err.message}`;
            }
          } else if (d.channel === "email" && d.email) {
            if (!got.sends) why = "Email sends are off for this client. An admin turns them on.";
            else if (!deps.mailer) why = "No mailer here";
            else {
              const mail = docEmail(got.business, fresh, url, remind);
              const send = deps.mailer(got.business);
              const to = d.email;
              await ctx.run("email", () => send({ to, ...mail }));
            }
          } else why = "Nowhere to send it";
          if (why) {
            const said = why;
            if (!remind) await ctx.run("failed", () => markFailed(main, d.id, said, at));
            return { sent: false, why, url: null };
          }
          await ctx.run("sent", () =>
            markSent(main, d.id, {
              message,
              by: req.by ?? d.approvedBy ?? d.createdBy,
              now: at,
              remind,
            }),
          );
          return { sent: true, url };
        },
      ),

      /** The page: the first open marks it viewed and tells the spine. */
      serve: serviceHandler(
        { input: z.looseObject(ASK) },
        async (ctx: restate.Context, req: Req) => {
          const at = await now(ctx);
          const got = await ctx.run("serve", async () => {
            const d = await docByToken(main, req.token, ownerAsked(req.client, req.apex), at);
            // A link preview (a texting app, a mail scanner) isn't the recipient opening it.
            const seen =
              d && !req.bot
                ? await seeDoc(main, d, { ip: req.ip, agent: req.agent, now: at })
                : null;
            const fresh = seen && d ? await docById(main, d.id) : d;
            return {
              page: await pageFor(main, fresh, req),
              first: seen === "first" ? fresh : null,
            };
          });
          if (got.first && deps.fire)
            deps.fire(ctx, docFired(got.first as unknown as Doc, "viewed"));
          return got.page;
        },
      ),

      /** A post from the page: sign or decline. The edge has checked Turnstile already. */
      act: serviceHandler(
        {
          input: z.looseObject({
            ...ASK,
            act: z.enum(["sign", "decline"]),
            fields: z.record(z.string(), z.string().max(2000)).describe("The form's fields"),
          }),
        },
        async (
          ctx: restate.Context,
          req: Req & { act: "sign" | "decline"; fields: Record<string, string> },
        ) => {
          const at = await now(ctx);
          const got = await ctx.run("act", async () => {
            const d = await docByToken(main, req.token, ownerAsked(req.client, req.apex), at);
            if (!d) return { page: await pageFor(main, null, req), done: null };
            const f = req.fields;
            try {
              const done =
                req.act === "sign"
                  ? await signDoc(main, d, {
                      name: f.name,
                      email: f.email,
                      consent: f.consent,
                      sha: f.sha,
                      ip: req.ip,
                      agent: req.agent,
                      now: at,
                    })
                  : await declineDoc(main, d, {
                      why: f.why,
                      ip: req.ip,
                      agent: req.agent,
                      now: at,
                    });
              return { page: await pageFor(main, done, req), done };
            } catch (err) {
              if (!(err instanceof DocRefusal)) throw err;
              const now2 = (await docById(main, d.id)) ?? d;
              return {
                page: await pageFor(main, now2, req, {
                  error: err.message,
                  typed: { name: f.name ?? "", email: f.email ?? "" },
                }),
                done: null,
              };
            }
          });
          if (got.done) {
            const d = got.done as unknown as Doc;
            if (deps.fire) deps.fire(ctx, docFired(d, req.act === "sign" ? "signed" : "declined"));
            if (req.act === "sign") {
              const url = await ctx.run("url", () => linkOf(d.client, req.token));
              await ctx.run("mail signed", () => mailSigned(deps, d, url));
            }
          }
          return got.page;
        },
      ),

      /** The signed copy, or the document as sent, as a PDF. */
      pdf: serviceHandler({ input: z.looseObject(ASK) }, async (ctx: restate.Context, req: Req) =>
        ctx.run("pdf", async (): Promise<Answer> => {
          const d = await docByToken(main, req.token, ownerAsked(req.client, req.apex), new Date());
          if (!d || !["sent", "viewed", "signed", "declined"].includes(d.status))
            return pageFor(main, d, req);
          const o = await ownerOf(main, d.client);
          const bytes = await docPdf(d, await docEventsOf(main, d.id), o.business);
          return {
            status: 200,
            pdf: Buffer.from(bytes).toString("base64"),
            filename: `${d.number}${d.status === "signed" ? "-signed" : ""}.pdf`,
          };
        }),
      ),

      /** Pay the deposit: a pay link on the client's Stripe key, made once, then Stripe's page. */
      deposit: serviceHandler(
        { input: z.looseObject(ASK), effect: "sends" },
        async (ctx: restate.Context, req: Req): Promise<Answer> => {
          const at = await now(ctx);
          const got = await ctx.run("load", async () => {
            const d = await docByToken(main, req.token, ownerAsked(req.client, req.apex), at);
            if (d?.status !== "signed" || !d.depositCents) return null;
            if (d.payLink) {
              const [l] = await main.select().from(payLinks).where(eq(payLinks.id, d.payLink));
              if (l?.url && l.status !== "paid") return { doc: d, url: l.url };
              if (l?.status === "paid") return { doc: d, url: null };
            }
            return { doc: d, url: null as string | null };
          });
          if (!got) return pageFor(main, await docByToken(main, req.token, null, at), req);
          const d = got.doc as unknown as Doc;
          if (got.url) return { status: 303, location: got.url };
          if (d.payLink) return pageFor(main, d, req);
          const made: Made = await ctx.run("stripe", async () => {
            try {
              const link = await createLink(main, {
                client: d.client,
                channel: "email",
                email: d.signerEmail,
                name: d.signerName,
                description: `Deposit for ${KIND_NAME[d.kind as DocKind]} ${d.number}`.slice(
                  0,
                  200,
                ),
                cents: d.depositCents as number,
                by: "recipient",
                approved: true,
                now: at,
              });
              await main.update(payLinks).set({ document: d.id }).where(eq(payLinks.id, link.id));
              await keepPayLink(main, d.id, link.id, at);
              const key = await stripeKeyOf(deps, d.client, `make deposit link ${link.id}`);
              const api = stripeApi(key, deps.fetch, deps.stripeBase);
              const price = await api.createPrice({
                id: link.id,
                cents: link.amountCents,
                currency: link.currency,
                description: link.description,
              });
              const pl = await api.createPaymentLink({
                id: link.id,
                client: d.client,
                price: price.id,
                quantity: 1,
              });
              await keepStripeLink(main, link.id, {
                stripeLink: pl.id,
                url: pl.url,
                live: pl.livemode,
              });
              await markPaySent(main, link.id, { message: null, now: at });
              return { url: pl.url };
            } catch (err) {
              if (
                err instanceof StripeError ||
                err instanceof PayRefusal ||
                err instanceof DocRefusal
              )
                return { error: err.message };
              throw err;
            }
          });
          if ("error" in made) {
            const o = await ctx.run("owner", () => ownerOf(main, d.client));
            return {
              status: 503,
              html: shutPage("missing", o).replace(
                "There's no document here.",
                "The deposit can't be paid online right now.",
              ),
            };
          }
          return { status: 303, location: made.url };
        },
      ),
    },
  });
}
export type DocumentsService = ReturnType<typeof makeDocuments>;
export type { Client };
