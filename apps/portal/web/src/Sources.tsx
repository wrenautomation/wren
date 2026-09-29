/** Every finding, by where it came from: the raw record behind every brief. */
import { call, type RawPage } from "./api.js";
import { go, href } from "./route.js";
import { Failed, hostOf, kindLabel, month, num, Pager, useCall, viaLabel } from "./ui.js";

const PAGE = 50;

export function Sources({ client, params }: { client: string; params: URLSearchParams }) {
  const via = params.get("via") ?? "";
  const offset = Number(params.get("offset")) || 0;
  const raw = useCall(`raw:${client}:${via}:${offset}`, () =>
    call<RawPage>("raw", { client, offset, ...(via ? { via } : {}) }),
  );
  if (raw.error && !raw.data) return <Failed error={raw.error} />;
  if (!raw.data) return <div className="loading">Loading…</div>;
  const d = raw.data;
  const all = d.vias.reduce((a, v) => a + v.count, 0);

  return (
    <div className="page">
      <div className="filters" role="tablist" aria-label="Source">
        <a role="tab" aria-selected={!via} href={href("sources")}>
          All<span className="count">{num(all)}</span>
        </a>
        {d.vias.map((v) => (
          <a
            key={v.via}
            role="tab"
            aria-selected={v.via === via}
            href={href("sources", { via: v.via })}
          >
            {viaLabel(v.via)}
            <span className="count">{num(v.count)}</span>
          </a>
        ))}
      </div>
      {d.rows.length ? (
        <div className={`table-wrap${raw.loading ? " stale" : ""}`}>
          <table className="people">
            <thead>
              <tr>
                <th>About</th>
                <th>Found</th>
                <th>Where</th>
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
                        <a href={href("people", { person: f.personId })}>{f.subject}</a>
                      ) : (
                        f.subject
                      )}
                    </td>
                    <td>
                      <b>{kindLabel(f.kind)}</b>
                      {f.title ? <div className="quiet small">{f.title}</div> : null}
                    </td>
                    <td className="nowrap">
                      {viaLabel(f.via)}
                      {f.url && host && !f.url.includes("•••") ? (
                        <div className="small">
                          <a href={f.url} target="_blank" rel="noopener noreferrer">
                            {host}
                          </a>
                        </div>
                      ) : null}
                    </td>
                    <td className="nowrap">{month(f.observedAt.slice(0, 10))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">Nothing found yet.</p>
      )}
      <Pager
        offset={offset}
        size={PAGE}
        total={d.total}
        onPage={(o) => go("sources", { offset: o || null }, params)}
      />
    </div>
  );
}
