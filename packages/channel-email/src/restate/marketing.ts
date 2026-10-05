/**
 * `Marketing`: the lander's signup form and preference center, through the phone Worker
 * (designs/2026-10-04-borrowed-ui.md, M2). The lander signs each signup after its bot check;
 * the preference center's links are signed per address, so the link is the login.
 * The confirm email is transactional mail from portal@.
 */
import { timingSafeEqual } from "node:crypto";
import * as restate from "@restatedev/restate-sdk";
import {
  askConsent,
  confirmConsent,
  giveConsent,
  type LinkFor,
  linkKey,
  mayAskConsent,
  pauseMarketing,
  preferencesOf,
  readLink,
  setFrequency,
  signLink,
  signupSig,
  undoUnsubscribeEverything,
  unsubscribeEverything,
  withdrawConsent,
} from "@wren/core/marketing";
import { serviceHandler } from "@wren/core/restate";
import { FREQUENCIES, type Frequency, topics } from "@wren/core/schema";
import type { Db } from "@wren/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { PlainMail } from "../send/gmail.js";

/** Who clicked: the lander passes the visitor's IP and user agent as proof. */
interface Visit {
  ip?: string;
  ua?: string;
}

export interface SignUpRequest extends Visit {
  topic: string;
  address: string;
  /** `signupSig(shared, topic, address)`, from the lander after its bot check. */
  sig: string;
  /** The page the form was on, and the exact words next to the button. */
  form: string;
  text: string;
  textVersion: string;
}

export type Change =
  | { topic: string; on: boolean }
  | { frequency: Frequency }
  | { pause: 30 | 90 | null }
  | { everything: true }
  | { undo: number };

const VISIT = {
  ip: z.string().optional().describe("The visitor's IP, as proof"),
  ua: z.string().optional().describe("The visitor's user agent, as proof"),
};
const TOKEN = z.string().describe("The signed preference link's token");
const SIGN_UP = z.looseObject({
  ...VISIT,
  topic: z.string(),
  address: z.string(),
  sig: z.string().describe("signupSig(shared, topic, address), from the lander"),
  form: z.string().describe("The page the form was on"),
  text: z.string().describe("The exact words next to the button"),
  textVersion: z.string(),
});
const CHANGE = z.union([
  z.object({ topic: z.string(), on: z.boolean() }),
  z.object({ frequency: z.enum(FREQUENCIES) }),
  z.object({ pause: z.union([z.literal(30), z.literal(90), z.null()]) }),
  z.object({ everything: z.literal(true) }),
  z.object({ undo: z.number().int() }),
]);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const confirmMail = (o: { to: string; topic: string; link: string }): PlainMail => ({
  to: o.to,
  subject: `Confirm: ${o.topic}`,
  text: [
    "Hi,",
    "",
    `Click this link to start getting ${o.topic}:`,
    o.link,
    "",
    "Didn't sign up? Ignore this email and you won't hear from me.",
    "",
    "William",
    "Wren Automation",
  ].join("\n"),
});

export function makeMarketing(deps: {
  db: Db;
  /** The secret the lander and Wren share (`WREN_SITE_EXPORT_TOKEN`). Unset = every call refused. */
  shared: string | null;
  /** The lander, e.g. https://wrenautomation.com: links point at its /prefs/. */
  site: string;
  /** Sends the confirm email; null = signups are refused, since none could confirm. */
  send: ((m: PlainMail) => Promise<void>) | null;
}) {
  const { db } = deps;
  const key = (): string => {
    if (!deps.shared)
      throw new restate.TerminalError("marketing is off: no shared secret", { errorCode: 503 });
    return linkKey(deps.shared);
  };
  const subscriber = (token: unknown): LinkFor => {
    const link = typeof token === "string" ? readLink(key(), token) : null;
    if (!link) throw new restate.TerminalError("this link isn't valid", { errorCode: 404 });
    return link;
  };
  const proof = (v: Visit, extra: Record<string, unknown> = {}) => ({
    ...extra,
    ...(v.ip ? { ip: v.ip } : {}),
    ...(v.ua ? { ua: v.ua.slice(0, 300) } : {}),
  });
  const topicNamed = (name: string) =>
    db
      .select()
      .from(topics)
      .where(and(eq(topics.name, name), eq(topics.channel, "email")))
      .then((r) => r[0] ?? null);
  const prefs = async (link: LinkFor) => ({
    ...(await preferencesOf(db, link.channel, link.address)),
    channel: link.channel,
    /** The topic the link names (a confirm or an unsubscribe), and its public name. */
    topic: link.topic ?? null,
    named: link.topic ? ((await topicNamed(link.topic))?.publicName ?? null) : null,
  });

  return restate.service({
    name: "Marketing",
    handlers: {
      /** The lander's form. Always `{ ok: true }`: the form never says who is on the list. */
      signUp: serviceHandler(
        { input: SIGN_UP, effect: "sends" },
        async (ctx: restate.Context, req: SignUpRequest): Promise<{ ok: true }> => {
          const shared = deps.shared;
          if (!shared || !deps.send)
            throw new restate.TerminalError("signups are off", { errorCode: 503 });
          const address = String(req?.address ?? "")
            .trim()
            .toLowerCase();
          const want = Buffer.from(signupSig(shared, String(req?.topic), address));
          const got = Buffer.from(String(req?.sig ?? ""));
          if (got.length !== want.length || !timingSafeEqual(got, want))
            throw new restate.TerminalError("unsigned signup", { errorCode: 401 });
          if (!EMAIL.test(address) || address.length > 320)
            throw new restate.TerminalError("that isn't an email address", { errorCode: 400 });
          const topic = await ctx.run("topic", () => topicNamed(req.topic));
          if (!topic?.public) throw new restate.TerminalError("no such list", { errorCode: 404 });
          const now = new Date(await ctx.date.now());
          const asked = await ctx.run("ask", async () => {
            if (!(await mayAskConsent(db, "email", address))) return false;
            const r = await askConsent(db, {
              channel: "email",
              address,
              topic: topic.name,
              source: "lander_form",
              textVersion: String(req.textVersion).slice(0, 64),
              evidence: proof(req, { form: req.form, text: req.text }),
              by: "lander:form",
              now,
            });
            return r.confirm;
          });
          if (asked) {
            const token = signLink(key(), { channel: "email", address, topic: topic.name });
            const send = deps.send;
            await ctx.run("confirm mail", () =>
              send(
                confirmMail({
                  to: address,
                  topic: topic.publicName,
                  link: `${deps.site}/prefs/${token}?confirm=1`,
                }),
              ),
            );
          }
          return { ok: true };
        },
      ),

      /** The confirm click. `ok` false: too late, or nothing to confirm. */
      confirm: serviceHandler(
        { input: z.looseObject({ ...VISIT, token: TOKEN }) },
        async (ctx: restate.Context, req: Visit & { token: string }) => {
          const link = subscriber(req?.token);
          if (!link.topic)
            throw new restate.TerminalError("not a confirm link", { errorCode: 404 });
          const topic = link.topic;
          const now = new Date(await ctx.date.now());
          const row = await ctx.run("confirm", () =>
            confirmConsent(db, {
              ...link,
              topic,
              evidence: proof(req, { click: true }),
              by: "subscriber",
              now,
            }),
          );
          return { ok: row !== null, prefs: await ctx.run("prefs", () => prefs(link)) };
        },
      ),

      /** What the preference center shows. */
      prefs: serviceHandler(
        { input: z.looseObject({ token: TOKEN }) },
        async (ctx: restate.Context, req: { token: string }) => {
          const link = subscriber(req?.token);
          return ctx.run("prefs", () => prefs(link));
        },
      ),

      /** One change from the preference center, or a mail app's one-click unsubscribe. */
      set: serviceHandler(
        { input: z.looseObject({ ...VISIT, token: TOKEN, change: CHANGE }) },
        async (ctx: restate.Context, req: Visit & { token: string; change: Change }) => {
          const link = subscriber(req?.token);
          const c = req?.change;
          const now = new Date(await ctx.date.now());
          const by = "subscriber";
          const base = { channel: link.channel, address: link.address };
          const event = await ctx.run("set", async (): Promise<number | null> => {
            if (c && "topic" in c) {
              const shown = (await preferencesOf(db, link.channel, link.address)).topics;
              if (c.topic !== link.topic && !shown.some((t) => t.name === c.topic))
                throw new restate.TerminalError("no such list", { errorCode: 404 });
              if (c.on)
                await giveConsent(db, {
                  ...base,
                  topic: c.topic,
                  source: "preference_center",
                  textVersion: "prefs-v1",
                  evidence: proof(req, { page: "prefs" }),
                  by,
                  now,
                });
              else
                await withdrawConsent(db, {
                  ...base,
                  topic: c.topic,
                  evidence: proof(req, { page: "prefs" }),
                  by,
                  now,
                });
            } else if (c && "frequency" in c) {
              await setFrequency(db, { ...base, frequency: c.frequency, by });
            } else if (c && "pause" in c) {
              await pauseMarketing(db, { ...base, days: c.pause, by, now });
            } else if (c && "everything" in c) {
              return unsubscribeEverything(db, {
                ...base,
                evidence: proof(req, { page: "prefs" }),
              });
            } else if (c && "undo" in c) {
              await undoUnsubscribeEverything(db, { ...base, event: Number(c.undo), now });
            } else throw new restate.TerminalError("unknown change", { errorCode: 400 });
            return null;
          });
          return { prefs: await ctx.run("prefs", () => prefs(link)), event };
        },
      ),
    },
  });
}

export type Marketing = ReturnType<typeof makeMarketing>;
