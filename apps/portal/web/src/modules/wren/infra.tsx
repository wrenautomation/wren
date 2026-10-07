/** Where Wren runs: every host and what calls what, each with its health (`hosts.ts`). */
import type { RecordsPage } from "@wren/core/records/serve";
import { Alert, Graph, PageHeader } from "@wren/ui";
import { useMemo } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { infraOf, type LoopRow } from "./hosts.js";

const asLoop = (r: Record<string, unknown>): LoopRow => ({
  service: String(r.service ?? ""),
  state: String(r.state ?? ""),
  health: String(r.health ?? ""),
  lastAt: typeof r.lastAt === "string" ? r.lastAt : null,
});

export function Infra(_: PageProps) {
  const loops = useCall("infra:loops", () =>
    call<RecordsPage>("console/recordsList", { record: "console.loop", view: "all", limit: 500 }),
  );
  const graph = useMemo(
    () =>
      infraOf(
        loops.data
          ? loops.data.rows.map((r) => asLoop(r as Record<string, unknown>))
          : loops.error
            ? loops.error
            : null,
      ),
    [loops.data, loops.error],
  );
  return (
    <>
      <PageHeader
        title="Infra"
        lede="Every host and what calls what. Health comes from each host's loops and from this page loading. The rest says where it's checked."
      />
      {loops.error ? <Alert onRetry={loops.retry}>{loops.error.message}</Alert> : null}
      <Graph {...graph} label="Where Wren runs" name="wren-infra" />
    </>
  );
}
