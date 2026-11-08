/**
 * Weaver's cards in the agent chat. A `view` part carries a ref (the CLI's `::view` line); the
 * card reads the run from `weaver serve`, so no data passes through the model and the card
 * follows the ledger live (designs/2026-11-05-research-web.md, Log 11-05).
 */
import { AgentSay, type AgentViews, LoadFailed, Loading } from "@wren/ui";
import { useContext, useState } from "react";
import { useCall } from "../../load.js";
import { runCard, runOf, sourceRead } from "./card.js";
import { RunCard, SourceCard } from "./run-lazy.js";
import { runsOf, useLive, viewOf } from "./serve.js";

function RunRef({ data }: { data: unknown }) {
  const run = runOf(data);
  const [tick, setTick] = useState(0);
  const rows = useCall(run ? "research:runs" : null, runsOf, { kept: false });
  const got = useCall(run ? `research:view:${run}:${tick}` : null, () => viewOf(run ?? ""), {
    kept: false,
  });
  const say = useContext(AgentSay);
  const row = rows.data?.find((r) => r.run === run) ?? null;
  useLive((changed) => {
    if (changed !== run) return;
    setTick((t) => t + 1);
    if (!row) rows.retry();
  });
  if (!run) return null;
  if (got.error && !got.data) return <LoadFailed error={got.error} onRetry={got.retry} />;
  if (!got.data) return <Loading shape="rows" lines={3} />;
  const one = sourceRead(got.data);
  return one ? (
    <SourceCard read={one} onAsk={say} />
  ) : (
    <RunCard {...runCard(got.data, row)} onAsk={say} />
  );
}

export const RESEARCH_REFS: AgentViews = { "research.run": RunRef };
