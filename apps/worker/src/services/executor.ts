/**
 * The executor: every workspace's journeys stepped, and each Schedule node's clock.
 */
import { billsStep } from "@wren/books";
import { BOOKS_KEY } from "@wren/books/restate";
import { emailTouchStep } from "@wren/channel-email";
import { isGoogleMailbox } from "@wren/channel-email/access/access";
import { briefStep, CALL_BRIEF } from "@wren/channel-email/calls";
import { EMAIL_TOUCH } from "@wren/channel-email/components";
import {
  clientSms,
  firstTextStep,
  LINK_ORIGIN,
  placeIdOf,
  reviewStep,
  textBackStep,
  touchStep,
} from "@wren/channel-sms";
import {
  MISSED_CALL,
  missedCallSettingsSchema,
  REVIEW_STEP,
  REVIEWS,
  reviewsSettingsSchema,
  TEXT_BACK,
  TOUCH,
} from "@wren/channel-sms/components";
import { SENDER_KEY } from "@wren/channel-sms/restate";
import { ingressOf } from "@wren/config";
import { commentGuide } from "@wren/content";
import { askFollowEmail } from "@wren/content/inbox";
import { findClient, sendsOn } from "@wren/core/clients";
import type { Platform } from "@wren/core/content";
import { setFieldStep } from "@wren/core/custom-fields";
import { type ExecutorEvent, makeExecutor, makeExecutorClock } from "@wren/core/executor";
import { wrenFacts } from "@wren/core/facts";
import { messageStep, notifyStep } from "@wren/core/message-step";
import { isVendorStop, meteredModel } from "@wren/core/metered";
import { namedFor } from "@wren/core/notify";
import { clientKey, ingressSend } from "@wren/core/restate";
import { segmentStep } from "@wren/core/segment-step";
import { SETUP_STEP, setupStep } from "@wren/core/setup";
import { SETUP_AGENT } from "@wren/core/setup-agent";
import { gate } from "@wren/core/vendors";
import { webhookStep, webhooksPublish } from "@wren/core/webhooks";
import type { Db } from "@wren/db";
import {
  clientAskedOnRead,
  judges as learnJudges,
  readStep as learnRead,
  type Practice,
  pageFetcher,
  practiceOf,
  scoreStep,
  type VideoReader,
} from "@wren/learn";
import { gatewayGemini, llmForKey, withPart } from "@wren/llm";
import { touchStep as reachTouchStep, sortStep } from "@wren/outreach";
import { collectSteps } from "@wren/pipeline/collect";
import { shapeWorkflowsOf, soundShapes } from "@wren/pipeline/journeys";
import { journeySteps } from "@wren/pipeline/steps";
import { youtubeByUrl } from "@wren/research/sops";
import { CALL_NOW, callNowStep } from "@wren/voice/node";
import { clientTriageStep, triageStep, mail as watchMail } from "@wren/watch";
import { geminiReader } from "@wrenautomation/read/video";
import { eq } from "drizzle-orm";
import { COMPONENTS } from "../components.js";
import { journeyResearcher } from "../journey-research.js";
import { SETUPS } from "../setups.js";
import { WORKFLOWS } from "../workflows.js";
import { type AnyService, type Deps, playbooksOf } from "./deps.js";

/** Learn's YouTube reads on the worker: Gemini by URL through the gateway, up to 40 minutes. */
function youtubeReader(env: NodeJS.ProcessEnv): VideoReader | null {
  const gateway = env.WREN_LLM_GATEWAY_URL;
  const token = env.WREN_LLM_GATEWAY_TOKEN;
  if (!gateway || !token) return null;
  // The gateway passes generate calls only, so the reader skips the key check.
  const model = geminiReader(["gateway"], { fetch: gatewayGemini(gateway, token) });
  return async ({ url, duration }) => {
    // Longer reads outrun a step: the Mac reads those from the captions.
    if (duration && duration > 2400) throw new Error("over 40 minutes: read on the Mac");
    const s = await youtubeByUrl(url, { model, durationS: duration });
    return { file: s.name, md: s.md };
  };
}

/** Learn scores against each pushed SOP's newest text. */
const practicesOf = async (db: Db): Promise<Practice[]> =>
  (await playbooksOf(db)).map((r) => practiceOf(r.label, r.text));

/** The executor domain's services, in the order they were served from `services.ts`. */
export function executorServices(deps: Deps): AnyService[] {
  const {
    bookerMailer,
    callBriefs,
    clientDb,
    clientTexts,
    db,
    draftsLlm,
    googleLlm,
    keys,
    llm,
    mailOf,
    notifier,
    reach,
    settings,
    setupChecks,
    setupLane,
    setupParts,
    sms,
    watchLlm,
  } = deps;
  const services: AnyService[] = [];
  /** Why texts can't leave now, or null: the global gate, the client's texts, the provider. */
  const textsWhy = (provider: string, off: string | null) =>
    !settings.smsLive
      ? "WREN_SMS_LIVE is off"
      : off
        ? `texts are off: ${off}`
        : provider === "none"
          ? "no SMS provider (WREN_SMS_PROVIDER)"
          : null;
  /** Wake whose sender, so a queued text leaves in seconds; the key wakes it once. */
  const nudgeSender = (client: string | null) => (key: string) =>
    ingressSend(
      ingressOf(settings),
      {
        service: "SmsSender",
        key: client ? clientKey(client, SENDER_KEY) : SENDER_KEY,
        handler: "sync",
      },
      key,
    );
  /** Whose texts an executor step runs on: Wren's, a client's with texts on, or why they're off. */
  const textsOf = async (client: string | null) => {
    if (!client) return { deps: sms, off: null };
    const plan = await clientSms(db, client);
    return plan.kind === "work"
      ? { deps: clientTexts.forClient(plan), off: null }
      : { deps: { ...sms, db: clientDb(client), bookings: null }, off: plan.why };
  };
  services.push(
    makeExecutor({
      main: db,
      clientDb,
      workflows: WORKFLOWS,
      components: COMPONENTS,
      // Shape versions of a workspace, as workflows: the newest, and any older one that still
      // holds open journeys. One that fails the workflow check is left out and logged. A read
      // failure throws, so the call retries and no version goes missing quietly.
      shapes: async (client) =>
        soundShapes(
          await shapeWorkflowsOf(client ? clientDb(client) : db, client ? "client" : "wren"),
          WORKFLOWS,
          COMPONENTS,
        ),
      // Parts register here as they move onto the executor; the rest keep arrivals and stop.
      steps: {
        // The shape's moves and nodes: a journey per person, in its workspace's database.
        ...journeySteps({
          db: (client) => (client ? clientDb(client) : db),
          // A stage's `research` runs on the person-research code (free reads, then a queued run).
          // Its ICP fit asks the gateway model (the bulk one) about the plain-word rules; no other vendor.
          researcher: journeyResearcher({
            main: db,
            ingress: ingressOf(settings),
            model: llm.provider === "gateway" ? llm : null,
          }),
        }),
        // Payments folded into the deal they name (`pipeline.money`).
        ...collectSteps({ db: (client) => (client ? clientDb(client) : db) }),
        // Account setups. With WREN_SETUP_AGENT a done-for-you step goes to SetupAgent on its
        // first round; off, it waits on Wren's team. Its alerts (stuck, waiting, done, lost)
        // tell the team on the clients lane.
        [SETUP_STEP]: setupStep({
          main: db,
          setups: SETUPS,
          checks: setupChecks,
          agent: settings.setupAgent
            ? (job, key) =>
                ingressSend(ingressOf(settings), { service: SETUP_AGENT, handler: "run" }, key, job)
            : null,
          notifierFor: setupLane,
          parts: setupParts,
        }),
        // A follow-up touch (no step) also reads the clients and why texts can't go now.
        [TOUCH]: touchStep(async (client) => {
          const { deps, off } = await textsOf(client);
          return { ...deps, main: db, off: textsWhy(deps.provider.name, off) };
        }),
        // Speed to lead's first text: live only with WREN_SMS_LIVE and the client's texts on.
        "sms.forms": firstTextStep(async (client) => {
          const { deps: d, off } = await textsOf(client);
          const why = textsWhy(d.provider.name, off);
          return {
            db: d.db,
            live: why === null,
            why,
            policy: d.policy,
            provider: d.provider,
            senderName: d.senderName,
            bookingLink: d.bookingLink ?? null,
            nudge: (key) =>
              ingressSend(
                ingressOf(settings),
                {
                  service: "SmsSender",
                  key: client ? clientKey(client, SENDER_KEY) : SENDER_KEY,
                  handler: "sync",
                },
                key,
              ),
          };
        }),
        // Missed-call text back: live only with WREN_SMS_LIVE, the client's texts and its sends on.
        [TEXT_BACK]: textBackStep(async (client) => {
          const { deps: d, off } = await textsOf(client);
          const c = client ? await findClient(db, client) : null;
          const why =
            textsWhy(d.provider.name, off) ??
            (c && !sendsOn(c, MISSED_CALL) ? "sends are off for this client" : null);
          const set = missedCallSettingsSchema.safeParse(c?.products[MISSED_CALL] ?? {});
          return {
            db: d.db,
            live: why === null,
            why,
            senderName: d.senderName,
            bookingLink: d.bookingLink ?? null,
            onceEvery: set.success ? set.data.hoursBetween : 24,
            zone: set.success ? set.data.zone : null,
            nudge: nudgeSender(client),
          };
        }),
        // Review requests: the same gates, the Place ID the setup found. An email ask goes from
        // portal@ under the client's name and waits only on its sends switch.
        [REVIEW_STEP]: reviewStep(async (client) => {
          const { deps: d, off } = await textsOf(client);
          const c = await findClient(db, client);
          const sendsOff = c && !sendsOn(c, REVIEWS) ? "sends are off for this client" : null;
          const why = textsWhy(d.provider.name, off) ?? sendsOff;
          const set = reviewsSettingsSchema.safeParse(c?.products[REVIEWS] ?? {});
          return {
            db: d.db,
            live: why === null,
            why,
            senderName: d.senderName,
            placeId: await placeIdOf(db, client),
            via: set.success ? set.data.via : "text",
            mail: { send: bookerMailer?.(d.senderName) ?? null, why: sendsOff },
            feedback: set.success ? set.data.feedback : false,
            onceEvery: set.success ? set.data.daysBetween : 90,
            origin: LINK_ORIGIN,
            nudge: nudgeSender(client),
          };
        }),
        // Speed to lead's call: "Call now" for the rep. No dialer until voice is set up.
        [CALL_NOW]: callNowStep(async (client) => {
          const { deps: d } = await textsOf(client);
          return { db: d.db, bookings: d.bookings ?? null, dialer: null };
        }),
        // A follow-up's email waits in To approve as an Inbox reply asked on the lead.
        [EMAIL_TOUCH]: emailTouchStep(
          (client) => (client ? clientDb(client) : db),
          (client, o) => askFollowEmail(client ? clientDb(client) : db, o),
        ),
        // A booked call's brief: built now, pinged to the team before the call.
        [CALL_BRIEF]: briefStep({
          ...callBriefs,
          queue: (ask, delayMs, key) =>
            ingressSend(
              ingressOf(settings),
              { service: "CallBriefs", handler: "send" },
              key,
              ask,
              delayMs,
            ),
        }),
        "reach.touch": reachTouchStep(
          db,
          { sequences: reach.sequences, sender: reach.senderName },
          clientDb,
          { off: () => (settings.reachLive ? null : "WREN_REACH_LIVE is off") },
        ),
        "watch.triage": triageStep(db, watchLlm ? withPart(watchLlm, "watch.triage") : null),
        // A client's mail, by its own name: the model only with the part installed and its
        // `models` gate open, metered. Else the rules alone, and what they can't settle shows.
        "mail.triage": clientTriageStep(async (client) => {
          const c = await findClient(db, client);
          const ok = !!c && "mail.triage" in c.products && (await gate(db, client, "models", 1)).ok;
          const meter = (m: NonNullable<typeof watchLlm>) =>
            meteredModel(m, {
              main: db,
              client,
              part: "mail.triage",
              now: () => new Date(),
              store: keys,
              own: llmForKey,
            });
          return {
            db: clientDb(client),
            name: c?.name ?? client,
            modelFor: async (mailbox) => {
              if (!ok) return null;
              const m = (await isGoogleMailbox(db, client, mailbox)) ? googleLlm : watchLlm;
              return m ? meter(m) : null;
            },
          };
        }),
        // Learn: an article and a YouTube video read here, other videos marked for the Mac; then scored.
        "learn.read": learnRead(db, pageFetcher(), youtubeReader(process.env)),
        // Each item by its own workspace: a client's on its models allowance, against its own SOPs,
        // and an SOP it asked for written into its Notes once read.
        "learn.score": scoreStep(
          db,
          learnJudges({
            db,
            llm: watchLlm ? withPart(watchLlm, "learn") : null,
            keys,
            wrenPractices: () => practicesOf(db),
          }),
          clientAskedOnRead(db, clientDb),
        ),
        // A bill in the Monitor's mail runs the books now; the books' pass is the box's.
        "books.bills": billsStep({
          mailOf: async (id) =>
            (
              await db
                .select({ fromAddress: watchMail.fromAddress, subject: watchMail.subject })
                .from(watchMail)
                .where(eq(watchMail.id, id))
            )[0] ?? null,
          runBooks: (key) =>
            ingressSend(
              ingressOf(settings),
              { service: "Books", key: BOOKS_KEY, handler: "sync" },
              key,
            ),
        }),
        // The Monitor's model: both read a few lines and answer in one.
        "comments.sort": sortStep(
          db,
          draftsLlm,
          (p) => commentGuide(db, p as Platform),
          // A client's comment sorts in its database; the model only with the part installed and
          // its `models` gate open, metered. Else the words alone.
          async (client) => {
            const d = clientDb(client);
            const c = await findClient(db, client);
            const ok =
              !!c && "comments.sort" in c.products && (await gate(db, client, "models", 1)).ok;
            return {
              db: d,
              llm:
                ok && watchLlm
                  ? meteredModel(watchLlm, {
                      main: db,
                      client,
                      part: "comments.sort",
                      now: () => new Date(),
                      store: keys,
                      own: llmForKey,
                    })
                  : null,
              guide: (p) => commentGuide(d, p as Platform),
            };
          },
          () => wrenFacts(db),
        ),
        // Send webhook: any https URL past the SSRF guard (designs/2026-10-07-webhooks-out.md).
        "logic.webhook": webhookStep(),
        // Set field: one custom field on the subject's record (designs/2026-10-09-custom-fields.md).
        "logic.set_field": setFieldStep(db, clientDb),
        // In segment: yes or no by a People segment now (designs/2026-10-15-channel-stats.md).
        "logic.segment": segmentStep(db, clientDb),
        // Send message and Notify me (designs/2026-10-14-automations.md): one person's broadcast,
        // gated and sent like one, in the workspace's own database; a line to Wren's team on the
        // main lane.
        "logic.message": messageStep(db, {
          mail: (client, cdb) => mailOf(client, cdb),
          open: clientDb,
        }),
        "logic.notify": notifyStep((client) =>
          settings.notify === "none" ? null : client ? namedFor(notifier, client) : notifier,
        ),
      },
      // What a client's own URLs hear: deliveries signed and tried on Webhooks' ladder.
      publish: webhooksPublish,
      // A client's rule on its own model key or Wren's, metered on its share. A stop (a cap, no
      // key) answers no: the event waits on no model it can't pay for.
      rule: async (when: string, e: ExecutorEvent, client?: string | null) => {
        const model = client
          ? meteredModel(llm, {
              main: db,
              client,
              part: "executor.rule",
              now: () => new Date(),
              store: keys,
              own: llmForKey,
              unset: "managed",
            })
          : llm;
        try {
          const r = await model.complete(
            `Rule: ${when}\n\nEvent (${e.kind}, ${e.subject}):\n${JSON.stringify(e.data).slice(0, 4000)}`,
            { system: "Does the event pass the rule? Answer yes or no.", maxTokens: 5 },
          );
          return /^\s*yes/i.test(r.text);
        } catch (err) {
          if (!isVendorStop(err)) throw err;
          console.warn(`executor rule for ${client}: no (${err.why})`);
          return false;
        }
      },
    }),
    // Each Schedule node's clock: started by publish and approve, a tick at each slot.
    makeExecutorClock({ main: db, workflows: WORKFLOWS, components: COMPONENTS }),
  );
  return services;
}
