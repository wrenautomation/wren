/**
 * What the agent can do on a call: look up the lead, offer times and book on our calendar,
 * transfer to a person, take a message, end the call. Each runs against a port, so a test call
 * runs on fakes and a live one on Postgres and our calendar. A tool answers in words the brain
 * reads, and may change the call: a booking, a transfer, the end.
 */
import { type AgentSettings, inHours, type ToolName } from "./agent.js";
import type { CallStart, LeadContext, ToolSpec } from "./types.js";

/** Who a number is. */
export interface LeadPort {
  byPhone(e164: string): Promise<LeadContext | null>;
}

/** Our calendar, as a call needs it. */
export interface VoiceCalendar {
  /** Open starts, soonest first, at most `max`. */
  open(o: { now: Date; max: number }): Promise<Date[]>;
  /** Take `start` for the caller. Throws `TimeTaken` when it went. */
  book(o: { start: Date; name: string; email: string; zone: string; now: Date }): Promise<{
    id: number;
    start: Date;
  }>;
}

/** Someone else took the time between the offer and the yes. */
export class TimeTaken extends Error {
  constructor() {
    super("that time was just taken");
  }
}

/** Where a message goes: the lead's thread, and whoever reads it. */
export interface MessagePort {
  take(o: {
    call: CallStart;
    lead: LeadContext | null;
    text: string;
    callback: string | null;
  }): Promise<void>;
}

export interface ToolPorts {
  leads: LeadPort;
  calendar: VoiceCalendar;
  messages: MessagePort;
}

/** What a tool did to the call, past its words. */
export type Effect =
  | { kind: "booked"; id: number; start: Date }
  | { kind: "transfer"; to: string }
  | { kind: "message"; text: string }
  | { kind: "lead"; lead: LeadContext }
  | { kind: "end" };

export interface ToolResult {
  /** What the brain reads back. */
  says: string;
  effect?: Effect;
}

export const TOOL_SPECS: Readonly<Record<ToolName, ToolSpec>> = {
  lookUpLead: {
    name: "lookUpLead",
    says: "Find who the caller is from their number.",
    args: {},
  },
  offerTimes: {
    name: "offerTimes",
    says: "Get the next open times for a call on our calendar. Offer two or three.",
    args: {},
  },
  book: {
    name: "book",
    says: "Book one of the offered times once the caller picks it and gives a name and email.",
    args: {
      start: "the time, as given by offerTimes (ISO)",
      name: "their name",
      email: "their email",
    },
  },
  transfer: {
    name: "transfer",
    says: "Put the caller through to a person, when they ask for one.",
    args: {},
  },
  takeMessage: {
    name: "takeMessage",
    says: "Take a message for the team.",
    args: { text: "the message", callback: "a number to call back, if they gave one" },
  },
  endCall: { name: "endCall", says: "End the call, after saying goodbye.", args: {} },
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "Tue Oct 7, 10:00 AM" on `zone`'s clock. */
export function spoken(at: Date, zone: string): string {
  return at.toLocaleString("en-US", {
    timeZone: zone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export interface ToolContext {
  agent: AgentSettings;
  call: CallStart;
  lead: LeadContext | null;
  now: Date;
}

/** Run one tool. Never throws for a caller's mistake: the words say what went wrong. */
export async function runTool(
  name: string,
  args: Record<string, unknown>,
  ports: ToolPorts,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { agent, call, now } = ctx;
  if (!(agent.tools as readonly string[]).includes(name))
    return { says: `${name} isn't something this agent may do.` };
  const zone = ctx.lead?.zone ?? agent.zone;
  switch (name as ToolName) {
    case "lookUpLead": {
      const phone = call.direction === "outbound" ? call.to : call.from;
      const lead = phone ? await ports.leads.byPhone(phone) : null;
      if (!lead) return { says: "No record of this number." };
      const parts = [lead.name, lead.company && `at ${lead.company}`, lead.notes].filter(Boolean);
      return { says: `This is ${parts.join(", ")}.`, effect: { kind: "lead", lead } };
    }
    case "offerTimes": {
      const open = await ports.calendar.open({ now, max: 3 });
      if (!open.length)
        return { says: "No open times in the next weeks. Offer to take a message." };
      return {
        says: `Open times: ${open.map((t) => `${spoken(t, zone)} (${t.toISOString()})`).join("; ")}.`,
      };
    }
    case "book": {
      const start = new Date(str(args.start));
      const name = str(args.name) || ctx.lead?.name || "";
      const email = (str(args.email) || ctx.lead?.email || "").toLowerCase();
      if (Number.isNaN(start.getTime())) return { says: "Which time? Offer times first." };
      if (!name) return { says: "Ask for their name first." };
      if (!EMAIL.test(email)) return { says: "Ask for an email to send the invite to." };
      try {
        const b = await ports.calendar.book({ start, name, email, zone, now });
        return {
          says: `Booked for ${spoken(b.start, zone)}. The invite goes to ${email}.`,
          effect: { kind: "booked", id: b.id, start: b.start },
        };
      } catch (err) {
        if (err instanceof TimeTaken) return { says: "That time was just taken. Offer another." };
        throw err;
      }
    }
    case "transfer": {
      if (!agent.transferTo) return { says: "No one takes calls here. Offer to take a message." };
      if (!inHours(agent, now)) return { says: "No one is in now. Offer to take a message." };
      return { says: "Putting them through.", effect: { kind: "transfer", to: agent.transferTo } };
    }
    case "takeMessage": {
      const text = str(args.text);
      if (!text) return { says: "Ask what the message is." };
      const callback = str(args.callback) || null;
      await ports.messages.take({ call, lead: ctx.lead, text, callback });
      return { says: "Message taken.", effect: { kind: "message", text } };
    }
    case "endCall":
      return { says: "Ending the call.", effect: { kind: "end" } };
  }
  return { says: `No tool named ${name}.` };
}

/** The tools an agent may use, as the brain is told them. */
export const toolsOf = (agent: AgentSettings): ToolSpec[] => agent.tools.map((t) => TOOL_SPECS[t]);
