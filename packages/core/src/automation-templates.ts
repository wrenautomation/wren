/**
 * Automations → New (designs/2026-10-14-automations.md, Templates): graphs a made workflow
 * starts from. Each opens as a draft on the canvas; nothing runs until it's published. Pure,
 * so the portal lists them and the console builds them from the same rows.
 */
import type { Wire, WorkflowNode } from "./workflows.js";

export interface AutomationTemplate {
  id: string;
  name: string;
  /** What it does, in one line, on its card. */
  blurb: string;
  /** What starts it, then what it does, as the card lists them. */
  steps: string[];
  nodes: WorkflowNode[];
  wires: Wire[];
}

const wire = (from: string, to: string): Wire => ({ from, to, via: "events" });
/** Wren's one email topic on prod; the editor flags it if it's renamed. */
const TOPIC = "newsletter";

export const AUTOMATION_TEMPLATES: readonly AutomationTemplate[] = [
  {
    id: "lead_follow_up",
    name: "New lead: ping, then follow up",
    blurb: "A form comes in, you get a ping, and if they don't answer in 2 days they get an email.",
    steps: ["A form is filled", "Ping the team", "Wait up to 2 days for an answer", "Email them"],
    nodes: [
      { id: "form", uses: "trigger.form", with: { form: "any" } },
      {
        id: "ping",
        uses: "logic.notify",
        with: { line: "New lead: {{data.lead.name}} {{data.lead.email}}", kind: "form" },
      },
      {
        id: "wait",
        uses: "logic.wait",
        with: { mode: "until", until: "answer", most: "2 days", kind: "form" },
      },
      {
        id: "email",
        uses: "logic.message",
        with: {
          channel: "email",
          topic: TOPIC,
          subject: "Following up, {first_name|there}",
          body: "Hi {first_name|there},\n\nYou filled in our form two days ago. Want to pick a time to talk? Reply here and I'll send a link.\n\nWilliam",
          kind: "form",
        },
      },
    ],
    wires: [
      wire("form.out", "ping.in"),
      wire("ping.out", "wait.in"),
      wire("wait.timeout", "email.in"),
    ],
  },
  {
    id: "booking_confirm",
    name: "Booking: confirm and ping",
    blurb: "A call is booked: they get a short note, you get a ping. Reminders already go out.",
    steps: ["A call is booked", "Email them", "Ping the team"],
    nodes: [
      { id: "booked", uses: "trigger.booking", with: { on: "booked" } },
      {
        id: "email",
        uses: "logic.message",
        with: {
          channel: "email",
          topic: TOPIC,
          subject: "See you soon, {first_name|there}",
          body: "Hi {first_name|there},\n\nThanks for booking. If anything comes up before the call, reply here.\n\nWilliam",
          kind: "call",
        },
      },
      { id: "ping", uses: "logic.notify", with: { line: "Booked: {{data.name}}", kind: "call" } },
    ],
    wires: [
      wire("booked.out", "email.in"),
      wire("email.sent", "ping.in"),
      wire("email.skipped", "ping.in"),
    ],
  },
  {
    id: "segment_message",
    name: "Segment entry: send a message",
    blurb: "Someone joins a segment in People and gets one email. Pick the segment first.",
    steps: ["Someone enters a segment", "Email them"],
    nodes: [
      { id: "joined", uses: "trigger.segment", with: { on: "entered" } },
      {
        id: "email",
        uses: "logic.message",
        with: {
          channel: "email",
          topic: TOPIC,
          subject: "",
          body: "Hi {first_name|there},\n\n\n\nWilliam",
          kind: "lead",
        },
      },
    ],
    wires: [wire("joined.out", "email.in")],
  },
];

export const templateOf = (id: string) => AUTOMATION_TEMPLATES.find((t) => t.id === id);
