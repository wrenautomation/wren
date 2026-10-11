/**
 * Agents (designs/2026-10-11-agents.md): every part that runs for Wren as a card, by department,
 * with its state, its last pass and what it made over the last 30 days and today. A card opens
 * its part; a failing one opens its loops. Numbers that fail to read stay off their card.
 */
import type { AgentLine, LoopRow } from "@wren/core/console";
import type { RecordsStat } from "@wren/core/records/serve";
import {
  AppCard,
  AppGlance,
  AppGrid,
  type GlanceFigure,
  type IconName,
  LoadFailed,
  Loading,
  PageHeader,
  Tag,
  type TagTone,
} from "@wren/ui";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import { QUIET } from "../work/bits.js";
import {
  type Agent,
  type AgentState,
  agentsOf,
  type Count,
  countKey,
  departments,
  since,
  tally,
} from "./agent-model.js";

const DAYS = 30;
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

const STATE: Record<AgentState, { label: string; tone: TagTone }> = {
  failing: { label: "Failing", tone: "warn" },
  running: { label: "Running", tone: "green" },
  off: { label: "Off", tone: "neutral" },
  call: { label: "When called", tone: "accent" },
  unknown: { label: "Not read", tone: "neutral" },
};

async function countsOf(lines: readonly AgentLine[]): Promise<Map<string, Count>> {
  const refs = [...new Map(lines.flatMap((l) => l.counts).map((c) => [countKey(c), c])).values()];
  const got = await Promise.all(
    refs.map((r) =>
      call<RecordsStat>("console/recordsStats", {
        record: r.record,
        view: r.view,
        period: DAYS,
        zone: ZONE,
      }).then(
        (s): [string, Count] => [
          countKey(r),
          { value: s.value ?? 0, today: s.series.at(-1)?.value ?? 0 },
        ],
        () => null,
      ),
    ),
  );
  return new Map(got.filter((x) => x !== null));
}

function figuresOf(a: Agent, counts: ReadonlyMap<string, Count> | null): GlanceFigure[] | null {
  if (!a.counts.length) return [];
  if (!counts) return null;
  return a.counts.flatMap((c) => {
    const n = counts.get(countKey(c));
    return n
      ? [
          { label: `${c.label}, ${DAYS} days`, value: n.value },
          { label: "today", value: n.today },
        ]
      : [];
  });
}

function AgentCard({ a, counts }: { a: Agent; counts: ReadonlyMap<string, Count> | null }) {
  const s = STATE[a.state];
  const href =
    a.state === "failing"
      ? "/loops/all?view=failing"
      : `/marketplace/catalog/${encodeURIComponent(a.id)}`;
  return (
    <AppCard
      name={a.name}
      icon={a.icon as IconName}
      href={href}
      blurb={a.blurb}
      note={a.loops.length ? `Last pass ${since(a.lastAt)}` : null}
    >
      <AppGlance
        figures={figuresOf(a, counts)}
        note={
          <span className="flex flex-wrap items-center gap-2">
            <Tag tone={s.tone} dot>
              {s.label}
            </Tag>
            {a.error ? (
              <span className="text-[12.5px] text-(--ui-bad) line-clamp-2">{a.error}</span>
            ) : null}
          </span>
        }
      />
    </AppCard>
  );
}

export function Agents() {
  const lines = useCall("agents", () => call<AgentLine[]>("console/agents", {}));
  // A failed read of the loops leaves every state "Not read"; the cards still draw.
  const loops = useCall("agents:loops", () =>
    call<LoopRow[]>("console/loops", {}).catch(() => null),
  );
  const counts = useCall(`agents:counts:${lines.data?.length ?? 0}`, () =>
    lines.data ? countsOf(lines.data) : Promise.resolve(null),
  );
  if (lines.error && !lines.data) return <LoadFailed error={lines.error} onRetry={lines.retry} />;
  if (!lines.data || loops.loading) return <Loading lines={6} />;
  const agents = agentsOf(lines.data, loops.data ?? null);
  const head = tally(agents, counts.data ?? new Map());
  return (
    <>
      <PageHeader
        title="Agents"
        lede={`Everything that runs for Wren, by department. Numbers are the last ${DAYS} days.`}
      />
      <div className="mb-10 max-w-xl">
        <AppGlance
          figures={[
            { label: "Running", value: head.running },
            { label: "Failing", value: head.failing },
            { label: "Off", value: head.off },
            { label: "Made today", value: counts.data ? head.today : "…" },
          ]}
        />
      </div>
      {agents.length ? null : <p className={QUIET}>Nothing runs for Wren yet.</p>}
      {departments(agents).map((d) => (
        <AppGrid key={d.name} label={d.name}>
          {d.agents.map((a) => (
            <AgentCard key={a.id} a={a} counts={counts.data ?? null} />
          ))}
        </AppGrid>
      ))}
    </>
  );
}
