/**
 * The Map: every component and what it builds on, left to right, drawn from the manifests'
 * `requires` (the catalog's Needs), so it shows what actually runs. Accounts are the inputs.
 * What this client hasn't installed is faded. The picture for a sales video.
 */
import type { RecordsPage } from "@wren/core/records/serve";
import { Alert, FlowMap, Loading, PageHeader } from "@wren/ui";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { QUIET } from "../work/bits.js";
import { mapOf } from "./boxes.js";

export function ComponentMap({ client, team }: PageProps) {
  const got = useCall(`component-map:${client}:${team}`, () =>
    call<RecordsPage>("console/recordsList", {
      client,
      app: "marketplace",
      asClient: !team,
      record: "console.component",
      where: { type: ["part"] },
      limit: 200,
    }),
  );
  const at = (id: string) =>
    `/marketplace/catalog/${encodeURIComponent(id)}?client=${encodeURIComponent(client)}`;
  if (got.error && !got.data) return <Alert onRetry={got.retry}>{got.error.message}</Alert>;
  if (!got.data) return <Loading lines={6} />;
  const { groups, alone } = mapOf(got.data.rows, at);
  return (
    <>
      <PageHeader
        title="Map"
        lede="Each part and what it builds on. Dashed: an account it uses. Faded: not installed here."
      />
      <div className="grid gap-8">
        {groups.map((g) => (
          <FlowMap key={g[0]?.id} boxes={g} label="Components and what each builds on" />
        ))}
      </div>
      {alone.length ? (
        <p className={`mt-8 text-[13.5px] ${QUIET}`}>
          On their own:{" "}
          {alone.map((b, i) => (
            <span key={b.id}>
              {i ? ", " : ""}
              <a href={b.href}>{b.label}</a>
            </span>
          ))}
        </p>
      ) : null}
    </>
  );
}
