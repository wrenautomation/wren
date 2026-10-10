/**
 * Voice: the phone agent (designs/2026-10-06-voice-agent.md). Its settings, a test call in the
 * browser on fakes, every call with its transcript and timed turns, and latency per pipeline.
 * In development: no phone line, voice or model until setup. Wren's team only for now.
 */
import type { Module } from "../../module.js";
import { Agent } from "./agent.js";
import { callExtras } from "./calls.js";
import { Latency } from "./latency.js";
import { TestCall } from "./test.js";

const CALL = "voice.call";
const calls = (view: string) => `/voice/calls?view=${view}`;

export const voice: Module = {
  id: "voice",
  name: "Voice",
  component: "voice.agent",
  icon: "mic",
  blurb: "An AI agent that answers the phone, books calls and takes messages.",
  requires: { audience: "team" },
  action: { page: "test", label: "Test call", icon: "phone" },
  pages: [
    {
      id: "overview",
      label: "Overview",
      template: "overview",
      tiles: [
        { label: "Calls", record: CALL, href: calls("live"), period: 30 },
        { label: "Booked", record: CALL, href: calls("booked"), period: 30 },
        { label: "Messages", record: CALL, href: calls("messages"), period: 30 },
        { label: "Test calls", record: CALL, href: calls("tests"), period: 30 },
      ],
      top: [
        {
          label: "Latest calls",
          record: CALL,
          href: calls("all"),
          fields: ["outcome", "started"],
          empty: "No calls yet. Make a test call to try the agent.",
        },
      ],
    },
    { id: "test", label: "Test call", Page: TestCall },
    {
      id: "calls",
      label: "Calls",
      template: "list",
      record: CALL,
      columns: ["who", "direction", "outcome", "turns", "heard", "seconds", "started"],
      empty: {
        all: "Calls show here. Make a test call to try the agent.",
        live: "Real calls show here once the phone line is set up.",
        tests: "Test calls show here when they end.",
        booked: "Calls that booked a time show here.",
        messages: "Calls that left a message show here.",
      },
      extras: callExtras,
    },
    { id: "latency", label: "Latency", Page: Latency },
    { id: "agent", label: "Agent", Page: Agent },
  ],
};
