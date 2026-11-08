/**
 * Birdwatch's views for the agent thread (`AgentThread` `views`): a part named here draws as its
 * card. Each product adds its own names the same way.
 */
import { useContext } from "react";
import { Say } from "../agent-cards.js";
import type { AgentViews } from "../agent-thread.js";
import { RunCard, SourceCard, type SourceRead } from "./cards.js";
import type { ResearchRun } from "./model.js";

function RunView({ data }: { data: unknown }) {
  const say = useContext(Say);
  return <RunCard run={data as ResearchRun} onAsk={say} />;
}

function SourceView({ data }: { data: unknown }) {
  const say = useContext(Say);
  return <SourceCard read={data as SourceRead} onAsk={say} />;
}

export const RESEARCH_VIEWS: AgentViews = {
  "research.run": RunView,
  "research.source": SourceView,
};
