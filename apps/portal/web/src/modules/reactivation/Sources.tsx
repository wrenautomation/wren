/** Every finding, by where it came from: the raw record behind every brief. */
import {
  Alert,
  Empty,
  hostOf,
  Loading,
  month,
  PageHeader,
  Pager,
  Sure,
  Table,
  Tabs,
} from "@wren/ui";
import { call, type RawPage } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { kindLabel, viaLabel } from "./bits.js";
import { at, goto } from "./nav.js";

const PAGE = 50;

export function Sources({ client, params }: PageProps) {
  const via = params.get("via") ?? "";
  const offset = Number(params.get("offset")) || 0;
  const raw = useCall(`raw:${client}:${via}:${offset}`, () =>
    call<RawPage>("raw", { client, offset, ...(via ? { via } : {}) }),
  );
  const d = raw.data;
  return (
    <>
      <PageHeader title="Sources" lede="Every finding behind every brief, by where it came from." />
      {d ? (
        <Tabs
          label="Where it came from"
          current={via || "all"}
          items={[
            {
              id: "all",
              label: "All",
              href: at("sources"),
              count: d.vias.reduce((a, v) => a + v.count, 0),
            },
            ...d.vias.map((v) => ({
              id: v.via,
              label: viaLabel(v.via),
              href: at("sources", { via: v.via }),
              count: v.count,
            })),
          ]}
        />
      ) : null}
      {raw.error && !d ? <Alert onRetry={raw.retry}>{raw.error.message}</Alert> : null}
      {d ? (
        d.rows.length ? (
          <Table stale={raw.loading} stack>
            <thead>
              <tr>
                <th>About</th>
                <th>Found</th>
                <th>Where</th>
                <th>How sure</th>
                <th>Seen</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((f) => {
                const host = hostOf(f.url);
                return (
                  <tr key={f.id}>
                    <td>
                      {f.personId ? (
                        <a href={at("people", { person: f.personId })}>{f.subject}</a>
                      ) : (
                        f.subject
                      )}
                    </td>
                    <td data-label="Found" data-wide>
                      <b>{kindLabel(f.kind)}</b>
                      {f.title ? <div className="rx-sub">{f.title}</div> : null}
                    </td>
                    <td data-label="Where" className="ui-nowrap">
                      {viaLabel(f.via)}
                      {f.url && host && !f.url.includes("•••") ? (
                        <div className="rx-sub">
                          <a href={f.url} target="_blank" rel="noopener noreferrer">
                            {host}
                          </a>
                        </div>
                      ) : null}
                    </td>
                    <td data-label="How sure">
                      <Sure value={f.confidence} />
                    </td>
                    <td data-label="Seen" className="ui-nowrap">
                      {month(f.observedAt.slice(0, 10))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <Empty>Nothing found yet.</Empty>
        )
      ) : raw.error ? null : (
        <Loading lines={10} shape="rows" />
      )}
      {d ? (
        <Pager
          offset={offset}
          size={PAGE}
          total={d.total}
          onPage={(o) => goto("sources", { offset: o || null }, params)}
        />
      ) : null}
    </>
  );
}
