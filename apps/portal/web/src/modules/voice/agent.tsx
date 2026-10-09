/**
 * The agent: the `voice.agent` part's settings, Wren's own (`wren_settings`). Read here, edited
 * in Loops > Settings with History and Undo, as every part that runs for Wren is.
 */
import type { RecordAnswer } from "@wren/core/records/serve";
import { Alert, Facts, LoadFailed, Loading, PageHeader, Section, Tag } from "@wren/ui";
import { type AgentSettings, agentOf, openingLine, TOOL_NAMES, VOICE_AGENT } from "@wren/voice";
import { call } from "../../api.js";
import { type Load, useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { InDevelopment, QUIET } from "./bits.js";

export interface AgentLoad {
  agent: AgentSettings;
  /** Why the saved block didn't parse; the defaults stand in. */
  problem: string | null;
}

/** The saved agent, read from its part's record; defaults when nothing is saved. */
export function useAgent(): Load<AgentLoad> {
  return useCall(`voice:agent`, async () => {
    const got = await call<RecordAnswer>("console/recordsGet", {
      record: "console.component",
      id: VOICE_AGENT,
    });
    const values = (got.detail as { values?: unknown } | null)?.values ?? {};
    try {
      return { agent: agentOf(values), problem: null };
    } catch (err) {
      return { agent: agentOf({}), problem: err instanceof Error ? err.message : String(err) };
    }
  });
}

const TOOL_NAME: Record<(typeof TOOL_NAMES)[number], string> = {
  lookUpLead: "Look up the caller",
  offerTimes: "Offer times",
  book: "Book",
  transfer: "Put through",
  takeMessage: "Take a message",
  endCall: "End the call",
};

const DAYS = [
  ["mon", "Mon"],
  ["tue", "Tue"],
  ["wed", "Wed"],
  ["thu", "Thu"],
  ["fri", "Fri"],
  ["sat", "Sat"],
  ["sun", "Sun"],
] as const;

export function Agent(_: PageProps) {
  const got = useAgent();
  const settingsLink = `/loops/settings?q=${encodeURIComponent("Voice agent")}`;
  return (
    <>
      <PageHeader
        title="Agent"
        lede="Who answers the phone, what it says and what it may do."
        actions={<a href={settingsLink}>Change in Settings</a>}
      />
      <InDevelopment>
        No phone number or voice yet. Picking those, and the numbers behind them, comes at setup.
        Until then, try the agent on a test call.
      </InDevelopment>
      {got.error && !got.data ? (
        <LoadFailed error={got.error} onRetry={got.retry} />
      ) : !got.data ? (
        <Loading lines={6} />
      ) : (
        <AgentFacts {...got.data} />
      )}
    </>
  );
}

function AgentFacts({ agent, problem }: AgentLoad) {
  const on = new Set(agent.tools);
  return (
    <div className="grid max-w-[72ch] gap-10">
      {problem ? (
        <Alert>The saved settings don't read, so these are the defaults. {problem}</Alert>
      ) : null}
      <Section
        title="First line"
        note="What every caller hears first. The AI line is added when it's missing."
      >
        <p className="rounded-(--ui-radius) bg-(--ui-paper) px-4 py-3 text-[15px]/[1.55] shadow-[inset_0_0_0_1px_var(--ui-hair)]">
          {openingLine(agent)}
        </p>
      </Section>
      <Section title="How it talks">
        <p className="text-[14.5px]/[1.6] text-pretty whitespace-pre-wrap">{agent.prompt}</p>
      </Section>
      <Section
        title="What it may do"
        note="It books on Wren's calendar, in the Calendar's open hours."
      >
        <ul className="flex flex-wrap gap-2">
          {TOOL_NAMES.map((t) => (
            <li key={t}>
              <Tag tone={on.has(t) ? "green" : "neutral"} dot={on.has(t)}>
                {on.has(t) ? TOOL_NAME[t] : `${TOOL_NAME[t]}: off`}
              </Tag>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Turns and calls">
        <Facts
          items={[
            ["Turn ends after", `${agent.turn.pauseMs} ms of quiet`],
            ["Caller can cut in", agent.turn.bargeIn ? "Yes" : "No"],
            ["While a tool runs", agent.fillers.join(" / ") || "Silence"],
            ["Longest call", `${agent.maxMinutes} min`],
            ["Records calls", agent.record ? "Yes, asking first" : "No"],
            ["Voice", agent.voice === "default" ? "Picked at setup" : agent.voice],
          ]}
        />
      </Section>
      <Section
        title="Putting callers through"
        note={`In these hours (${agent.zone}), a caller who asks for a person is put through.`}
      >
        <Facts
          items={[
            ["To", agent.transferTo ?? "No one set: it offers to take a message"],
            ...DAYS.map(([k, label]): [string, string] => [label, agent.hours[k] || "Closed"]),
          ]}
        />
      </Section>
      <Section title="Calling out">
        <p className={QUIET}>
          {agent.outbound ? "Allowed" : "Off"}. It only dials a number with written consent for AI
          calls on file, outside quiet hours, and never one that opted out. The code checks before
          every dial.
        </p>
      </Section>
    </div>
  );
}
