/**
 * Follow-up and Nurture (designs/2026-10-07-follow-up-nurture.md): two parts whose insides are
 * workflows of the channels' own touch steps and Waits. A touch node with no `step` setting is one
 * follow-up touch: it finds the lead's thread on its channel and sends the node's copy. This file
 * holds what every channel's touch shares: the parts, their insides, the checks before a send and
 * the note each touch leaves on its output.
 */
import type { Queryable } from "@wren/db";
import { z } from "zod";
import { findClient, sendsOn, settingsFor } from "./clients/index.js";
import { defineComponent } from "./components.js";
import { activeSequence, leadAnswered, leadOfEvent, threadOn, type Who } from "./leads.js";
import type { SpineEvent, StepAt } from "./spine.js";
import type { TemplateRef } from "./templates.js";
import { defineWorkflow, type Wire, type WorkflowNode } from "./workflows.js";

export const FOLLOW_UP = "follow_up";
export const NURTURE = "nurture";
export type FollowPart = typeof FOLLOW_UP | typeof NURTURE;
export type FollowChannel = "text" | "dm" | "email";

/** Which channels a part may use: off, its touches on that channel pass the lead on. */
export const followSettingsSchema = z
  .object({
    texts: z.boolean().default(true).describe("Send texts"),
    dms: z.boolean().default(true).describe("Send DMs"),
  })
  .strict();
export type FollowSettings = z.infer<typeof followSettingsSchema>;

const CHANNEL_SETTING: Partial<Record<FollowChannel, keyof FollowSettings>> = {
  text: "texts",
  dm: "dms",
};

const CHANNEL_WORD: Record<FollowChannel, string> = { text: "text", dm: "DM", email: "email" };

/** A touch with no `step` is a follow-up touch; one with a step is a sequence's (cadences). */
export const isFollowTouch = (at: Pick<StepAt, "with">): boolean =>
  at.with.step === undefined || at.with.step === "";

/** The part a touch runs for: Nurture inside Nurture, else Follow-up. */
export const followPartOf = (at: Pick<StepAt, "part">): FollowPart =>
  at.part === NURTURE ? NURTURE : FOLLOW_UP;

/** What one follow-up touch did, kept on its output as `data.follow`. */
export interface FollowNote {
  part: FollowPart;
  node: string;
  channel: FollowChannel;
  did: "queued" | "would_send" | "skipped" | "answered";
  why: string | null;
}

export type Outs = Array<{ port: string; event: SpineEvent }>;

/** The lead goes on to the next step, with what this touch did. */
export const passed = (e: SpineEvent, note: FollowNote): Outs => [
  { port: "sent", event: { ...e, data: { ...e.data, follow: note } } },
];

/** They answered: the lead leaves by `replied`, as a reply. */
export const answered = (e: SpineEvent, note: FollowNote): Outs => [
  { port: "replied", event: { ...e, kind: "reply", data: { ...e.data, follow: note } } },
];

/** Why sends are off for this client and part, or null when on. */
export type GlobalGate = string | null;

export interface FollowStart {
  who: Who;
  /** Their thread on this channel: the contact or enrollment id the touch writes on. */
  thread: number;
  note: FollowNote;
  /** Null: send. Else why it only records "would send". */
  would: string | null;
}

/**
 * Everything a follow-up touch asks before its channel's own consent, in order: whose lead it
 * is, did they answer (a Wait let them go on a reply, or any channel shows one), are they in an
 * active sequence, is this channel on for the part, have they a thread on it, and are sends on.
 * `outs` when it ends here.
 */
export async function followStart(
  o: {
    /** The workflow's database: the client's own, or Wren's. */
    db: Queryable;
    /** Wren's main database, where clients and Wren's settings are. */
    main: Queryable;
    channel: FollowChannel;
    /** The global env gate for this channel: null when on, else why off. */
    globalOff: GlobalGate;
  },
  e: SpineEvent,
  at: StepAt,
): Promise<{ outs: Outs } | FollowStart> {
  const note: FollowNote = {
    part: followPartOf(at),
    node: at.node,
    channel: o.channel,
    did: "skipped",
    why: null,
  };
  const happened = e.data.happened as { kind?: string; data?: { change?: string } } | undefined;
  if (
    happened?.kind === "reply" ||
    (happened?.kind === "call" && happened.data?.change !== "cancelled")
  )
    return {
      outs: answered(e, {
        ...note,
        did: "answered",
        why: happened.kind === "call" ? "booked a call" : "replied",
      }),
    };
  const who = await leadOfEvent(o.db, e);
  if (!who) return { outs: passed(e, { ...note, why: "no lead on this event" }) };
  const how = await leadAnswered(o.db, who);
  if (how) return { outs: answered(e, { ...note, did: "answered", why: how }) };
  // The Email step is where every follow-up ends, until email to a quiet lead is built.
  if (o.channel === "email")
    return { outs: passed(e, { ...note, why: "email is in development" }) };
  const busy = await activeSequence(o.db, who);
  if (busy) return { outs: passed(e, { ...note, why: busy }) };
  const settings = followSettingsSchema.safeParse(
    (await settingsFor(o.main, at.client))[note.part] ?? {},
  );
  const key = CHANNEL_SETTING[o.channel];
  if (key && settings.success && !settings.data[key])
    return { outs: passed(e, { ...note, why: `${key} are off in its settings` }) };
  const thread = await threadOn(o.db, who, o.channel);
  if (thread === null)
    return { outs: passed(e, { ...note, why: `no ${CHANNEL_WORD[o.channel]} thread with them` }) };
  let would = o.globalOff;
  if (!would && at.client !== null) {
    const client = await findClient(o.main, at.client);
    if (!client) would = "no such client";
    else if (!sendsOn(client, note.part)) would = "sends are off for this client";
  }
  return { who, thread, note, would };
}

// ---- The parts' insides ----

/** A Wait until a reply or a booking, at most `most`. */
const wait = (id: string, most: string): WorkflowNode => ({
  id,
  uses: "logic.wait",
  with: { mode: "until", until: "answer", most, kind: "lead" },
});

/** One follow-up touch on a channel, with its copy. */
const touch = (id: string, uses: string, template: TemplateRef | null, note: string) => ({
  id,
  uses,
  note,
  ...(template ? { template } : {}),
});

const TOUCH: Record<FollowChannel, string> = {
  text: "sms.touch",
  dm: "reach.touch",
  email: "email.touch",
};

export const textCopy = (name: string): TemplateRef => ({ kind: "sms", system: "texts", name });
export const dmCopy = (name: string): TemplateRef => ({ kind: "dm", system: "reach", name });

interface Beat {
  channel: FollowChannel;
  copy: TemplateRef | null;
  note: string;
  /** The Wait after it: at most this long for an answer. None after the last. */
  waitUpTo?: string;
}

/**
 * A run of touches, each followed by a Wait until a reply or a booking. Both ways out of a Wait
 * go to the next touch, which asks first whether they answered: so an answer leaves by `replied`
 * at once, and time running out sends the next one. `first` waits before the first touch.
 */
function touches(id: string, name: string, blurb: string, beats: Beat[], first?: string) {
  const nodes: WorkflowNode[] = [];
  const wires: Wire[] = [];
  const ids = beats.map((b, i) => `${b.channel}${i + 1}`);
  let from = ["in.leads"];
  if (first) {
    nodes.push(wait("wait0", first));
    wires.push({ from: "in.leads", to: "wait0.in", via: "events" });
    from = ["wait0.out", "wait0.timeout"];
  }
  beats.forEach((b, i) => {
    const t = ids[i] as string;
    nodes.push(touch(t, TOUCH[b.channel], b.copy, b.note));
    for (const f of from) wires.push({ from: f, to: `${t}.lead`, via: "events" });
    wires.push({ from: `${t}.replied`, to: "out.replied", via: "events" });
    if (b.waitUpTo) {
      const w = `wait${i + 1}`;
      nodes.push(wait(w, b.waitUpTo));
      wires.push({ from: `${t}.sent`, to: `${w}.in`, via: "events" });
      from = [`${w}.out`, `${w}.timeout`];
    } else wires.push({ from: `${t}.sent`, to: "out.quiet", via: "events" });
  });
  return defineWorkflow({
    id,
    name,
    blurb,
    icon: "cycle",
    for: "client",
    stage: "follow",
    in: [{ id: "leads", label: "leads", kind: "lead" }],
    out: [
      { id: "replied", label: "replies", kind: "reply" },
      { id: "quiet", label: "still quiet", kind: "lead" },
    ],
    nodes,
    wires,
  });
}

const EMAIL_NOTE = "In development: checks for an answer, then passes the lead on.";

export const FOLLOW_UP_INSIDE = touches(
  `${FOLLOW_UP}.touches`,
  "Follow-up",
  "A text, a DM, then a text, each waiting for an answer.",
  [
    { channel: "text", copy: textCopy("follow-up#1"), note: "Text 1.", waitUpTo: "2 days" },
    { channel: "dm", copy: dmCopy("follow-up#1"), note: "DM 1.", waitUpTo: "3 days" },
    { channel: "text", copy: textCopy("follow-up#2"), note: "Text 2.", waitUpTo: "4 days" },
    { channel: "email", copy: null, note: EMAIL_NOTE },
  ],
);

export const NURTURE_INSIDE = touches(
  `${NURTURE}.touches`,
  "Nurture",
  "One touch a month for four months, until they answer.",
  [
    { channel: "text", copy: textCopy("nurture#1"), note: "Month 1.", waitUpTo: "30 days" },
    { channel: "dm", copy: dmCopy("nurture#1"), note: "Month 2.", waitUpTo: "30 days" },
    { channel: "text", copy: textCopy("nurture#2"), note: "Month 3.", waitUpTo: "30 days" },
    { channel: "dm", copy: dmCopy("nurture#2"), note: "Month 4.", waitUpTo: "30 days" },
    { channel: "email", copy: null, note: EMAIL_NOTE },
  ],
  "30 days",
);

export const FOLLOW_WORKFLOWS = [FOLLOW_UP_INSIDE, NURTURE_INSIDE];

/** Every default copy ref a part's inside sends: installing the part imports them. */
const copyOf = (w: { nodes: WorkflowNode[] }) =>
  w.nodes.flatMap((n) =>
    n.template ? [`${n.template.kind}:${n.template.system}/${n.template.name}`] : [],
  );

const LATER = ["voice.dialer", "voice.voicemail"];
const SENDS_ON = "sends from the channel's own sender";

export const FOLLOW_COMPONENTS = [
  defineComponent({
    id: FOLLOW_UP,
    stage: "follow",
    channels: ["text", "dm", "email"],
    name: "Follow-up",
    blurb: "Works a quiet lead through texts and DMs, waiting for an answer after each one.",
    icon: "cycle",
    for: "client",
    ready: true,
    inside: FOLLOW_UP_INSIDE.id,
    settings: followSettingsSchema,
    requires: { anyAccount: ["telnyx", "linkedin", "reddit"] },
    provides: { templates: copyOf(FOLLOW_UP_INSIDE) },
    liveSwitch: true,
    effects: ["sends"],
    later: LATER,
    in: [{ id: "leads", label: "leads who went quiet", kind: "lead" }],
    out: [
      { id: "replied", label: "replies", kind: "reply" },
      { id: "quiet", label: "still quiet", kind: "lead" },
    ],
    hypothesis: {
      from: "Designed 2026-10-05, built 2026-10-07",
      guesses: [
        { is: "change", says: "The copy of each touch.", built: "the follow-up templates" },
        { is: "change", says: "How long each wait is, and the order.", built: "inside" },
        { is: "change", says: "Which channels it may use.", built: "settings.texts" },
        {
          is: "needs",
          says: "A channel to send on: texts, DMs.",
          built: "sms.touch",
        },
        { is: "fixed", says: `Stops on a reply or a booking on any channel; ${SENDS_ON}.` },
      ],
    },
  }),
  defineComponent({
    id: NURTURE,
    stage: "follow",
    channels: ["text", "dm", "email"],
    name: "Nurture",
    blurb: "Keeps not-yet leads warm with a touch a month, until they answer.",
    icon: "mail",
    for: "client",
    ready: true,
    inside: NURTURE_INSIDE.id,
    settings: followSettingsSchema,
    requires: { anyAccount: ["telnyx", "linkedin", "reddit"] },
    provides: { templates: copyOf(NURTURE_INSIDE) },
    liveSwitch: true,
    effects: ["sends"],
    later: LATER,
    in: [{ id: "leads", label: "not yet", kind: "lead" }],
    out: [
      { id: "replied", label: "replies", kind: "reply" },
      { id: "quiet", label: "still quiet", kind: "lead" },
    ],
    hypothesis: {
      from: "Designed 2026-10-05, built 2026-10-07",
      guesses: [
        { is: "change", says: "What it sends, per client.", built: "the nurture templates" },
        { is: "change", says: "How often, and on which channel.", built: "inside" },
        { is: "change", says: "Which channels it may use.", built: "settings.dms" },
        { is: "fixed", says: "Stops the moment they answer or opt out." },
      ],
    },
  }),
];
