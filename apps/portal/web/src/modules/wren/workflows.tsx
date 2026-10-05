/**
 * Workflows: Wren's business drawn as its workflows, read only. `wren` first; a stacked card
 * opens what runs inside it in place, with a trail back. Each number is the last 30 days of the
 * record view its port names, and a card with one opens those records.
 */
import type { RecordAnswer, RecordsStat } from "@wren/core/records/serve";
import { Alert, FlowMap, Loading, PageHeader } from "@wren/ui";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { type CountRef, countKey, countsIn, type Drawn, flowBoxes } from "../marketplace/boxes.js";
import { WREN_APPS } from "./index.js";

const ROOT = "wren";
const DAYS = 30;
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

const canvasAt = (path: readonly string[]) => `/workflows/canvas?path=${path.join("/")}`;

/** The first of Wren's lists over `c`'s record, on its view. */
const recordsAt = (c: CountRef) => {
  for (const m of WREN_APPS)
    for (const p of m.pages)
      if ("record" in p && p.record === c.record && p.template === "list")
        return `/${m.id}/${p.id}?view=${encodeURIComponent(c.view)}`;
  return undefined;
};

export function Workflows({ params }: PageProps) {
  const path = (params.get("path") ?? ROOT).split("/").filter(Boolean);
  const trail = useCall(`workflows:${path.join("/")}`, () =>
    Promise.all(
      path.map((id) =>
        call<RecordAnswer>("console/recordsGet", { record: "console.component", id }).then(
          (a) => (a.detail as { workflow?: Drawn } | null)?.workflow ?? null,
        ),
      ),
    ),
  );
  const w = trail.data?.at(-1) ?? null;
  const refs = w ? countsIn(w) : [];
  // A number that fails stays off its card; the drawing never waits on one.
  const counts = useCall(
    `workflow-counts:${refs.map(countKey).join(",")}`,
    async () =>
      new Map(
        (
          await Promise.all(
            refs.map((r) =>
              call<RecordsStat>("console/recordsStats", { ...r, period: DAYS, zone: ZONE }).then(
                (s) => [countKey(r), s.value ?? 0] as const,
                () => null,
              ),
            ),
          )
        ).filter((x) => x !== null),
      ),
  );
  if (trail.error && !trail.data) return <Alert onRetry={trail.retry}>{trail.error.message}</Alert>;
  if (!trail.data) return <Loading lines={6} />;
  if (!w) return <Alert>No workflow called {path.at(-1)}.</Alert>;
  const boxes = flowBoxes(
    w,
    (n) => (n.opens ? canvasAt([...path, n.opens]) : n.count ? recordsAt(n.count) : undefined),
    counts.data ?? undefined,
  );
  return (
    <>
      {path.length > 1 ? (
        <nav aria-label="Workflows open" className="mb-2 text-[13px] text-(--ui-ink-2)">
          {trail.data.slice(0, -1).map((t, i) => (
            <span key={path[i]}>
              <a href={canvasAt(path.slice(0, i + 1))} className="hover:text-(--ui-ink)">
                {t?.name ?? path[i]}
              </a>
              {" / "}
            </span>
          ))}
        </nav>
      ) : null}
      <PageHeader
        title={w.name}
        lede={`Numbers are the last ${DAYS} days. A stacked card opens what runs inside it. Faded: not built yet.`}
      />
      <FlowMap boxes={boxes} label={`What runs in ${w.name}`} />
    </>
  );
}
