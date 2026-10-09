/**
 * Sites → Funnel map (designs/2026-10-07-sites.md, Phase 3): where visits came from, the pages
 * they landed on, the forms sent and the calls booked, on the graph kit. Wires carry counts and
 * rates; a page opens its row. The Funnel list stays the place for the numbers.
 */
import type { RecordsPage } from "@wren/core/records/serve";
import { Graph, LoadFailed, Loading, PageHeader } from "@wren/ui";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { funnelGraph } from "./funnel-map.js";

export function FunnelGraph(_: PageProps) {
  const got = useCall("sites-funnel-graph", () =>
    call<RecordsPage>("console/recordsList", { record: "sites.funnel", view: "all", limit: 200 }),
  );
  if (got.error && !got.data) return <LoadFailed error={got.error} onRetry={got.retry} />;
  if (!got.data) return <Loading lines={6} />;
  const g = funnelGraph(got.data.rows);
  return (
    <>
      <PageHeader
        title="Funnel map"
        lede="Where visits came from, the page they landed on, then forms and bookings. Each wire carries its count and rate."
      />
      {g.nodes.length > 2 ? (
        <Graph {...g} label="Funnel" direction="auto" tools={g.nodes.length > 8} name="funnel" />
      ) : (
        <p className="text-[14px] text-(--ui-ink-2)">
          No visits counted yet. Each page's tracker fills this.
        </p>
      )}
    </>
  );
}
