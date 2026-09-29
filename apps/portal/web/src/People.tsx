/** Everyone on the list, filtered by what we found; one person opens in a drawer with their brief. */
import { useEffect, useRef, useState } from "react";
import { call, type PeopleFilter, type PeoplePage, type PersonView, type Source } from "./api.js";
import { MARKS } from "./Overview.js";
import { go, href } from "./route.js";
import {
  ago,
  Failed,
  hostOf,
  kindLabel,
  month,
  NowCell,
  num,
  Pager,
  Reasons,
  useCall,
  viaLabel,
} from "./ui.js";

const FILTERS: Record<PeopleFilter, string> = {
  all: "Everyone",
  moved: "Moved",
  hiring: "Company hiring",
  there: "Still there",
  left: "Left",
  unknown: "Not looked up",
};
const PAGE = 50;

const VERDICTS: Record<string, string> = {
  valid: "Works",
  invalid: "Bounces",
  risky: "Risky",
  catch_all: "Can't tell",
  unknown: "Can't tell",
};

export function People({
  client,
  demo,
  params,
}: {
  client: string;
  demo: boolean;
  params: URLSearchParams;
}) {
  const filter = (params.get("filter") as PeopleFilter | null) ?? "all";
  const offset = Number(params.get("offset")) || 0;
  const q = params.get("q") ?? "";
  const person = Number(params.get("person")) || null;
  const list = useCall(`people:${client}:${filter}:${offset}:${q}`, () =>
    call<PeoplePage>("people", { client, filter, offset, ...(q ? { q } : {}) }),
  );
  const set = (p: Record<string, string | number | null>) => go("people", p, params);

  return (
    <div className="page">
      <div className="filters" role="tablist" aria-label="Filter">
        {(Object.keys(FILTERS) as PeopleFilter[]).map((f) => (
          <a
            key={f}
            role="tab"
            aria-selected={f === filter}
            href={href("people", { filter: f === "all" ? null : f, q: q || null })}
          >
            {FILTERS[f]}
            {list.data ? <span className="count">{num(list.data.counts[f])}</span> : null}
          </a>
        ))}
        {demo ? null : <Search value={q} onSearch={(v) => set({ q: v || null, offset: null })} />}
      </div>

      {list.error && !list.data ? <Failed error={list.error} /> : null}
      {list.data ? (
        list.data.rows.length ? (
          <div className={`table-wrap${list.loading ? " stale" : ""}`}>
            <table className="people">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Company on your list</th>
                  <th>Now</th>
                  <th>Hiring</th>
                  <th className="num">Score</th>
                  <th>Last contact</th>
                  <th>Owner</th>
                  <th>Email</th>
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((r) => (
                  <tr
                    key={r.personId}
                    aria-selected={r.personId === person}
                    onClick={() => set({ person: r.personId })}
                  >
                    <td>
                      <a
                        href={href("people", { ...Object.fromEntries(params), person: r.personId })}
                      >
                        {r.name}
                      </a>
                      {r.title ? <div className="quiet small">{r.title}</div> : null}
                    </td>
                    <td>{r.firm}</td>
                    <td>
                      <NowCell now={r.now} />
                    </td>
                    <td>
                      {r.hiring ? (
                        <span className="tag tag-hiring">{r.hiring.count} open</span>
                      ) : (
                        ""
                      )}
                    </td>
                    <td className="num">{r.score ?? ""}</td>
                    <td className="nowrap">{ago(r.lastContactedOn)}</td>
                    <td className="nowrap">{r.owner ?? ""}</td>
                    <td className="nowrap">
                      {r.email ? (
                        <span title={r.email.address}>
                          {r.email.verdict
                            ? (VERDICTS[r.email.verdict] ?? r.email.verdict)
                            : "Not checked"}
                        </span>
                      ) : (
                        <span className="quiet">None</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">{q ? `Nobody matches “${q}”.` : "Nobody here."}</p>
        )
      ) : list.error ? null : (
        <div className="loading">Loading…</div>
      )}
      {list.data ? (
        <Pager
          offset={offset}
          size={PAGE}
          total={list.data.total}
          onPage={(o) => set({ offset: o || null })}
        />
      ) : null}

      {person ? (
        <Drawer client={client} personId={person} onClose={() => set({ person: null })} />
      ) : null}
    </div>
  );
}

function Search({ value, onSearch }: { value: string; onSearch: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <form
      className="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(v.trim());
      }}
    >
      <input
        type="search"
        value={v}
        placeholder="Name or company"
        aria-label="Search people"
        onChange={(e) => setV(e.target.value)}
      />
    </form>
  );
}

function Drawer({
  client,
  personId,
  onClose,
}: {
  client: string;
  personId: number;
  onClose: () => void;
}) {
  const p = useCall(`person:${client}:${personId}`, () =>
    call<PersonView>("person", { client, personId }),
  );
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="drawer-wrap">
      <button
        type="button"
        className="drawer-back"
        tabIndex={-1}
        aria-label="Close"
        onClick={onClose}
      />
      <aside ref={panel} className="drawer" tabIndex={-1} aria-label="Person">
        <button type="button" className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
        {p.error && !p.data ? <Failed error={p.error} /> : null}
        {p.data ? (
          <Person view={p.data} />
        ) : p.error ? null : (
          <div className="loading">Loading…</div>
        )}
      </aside>
    </div>
  );
}

function Person({ view }: { view: PersonView }) {
  const { row } = view;
  const marks = new Map(view.sources.map((s) => [s.mark.toLowerCase(), s]));
  return (
    <div className="person">
      <h2>{row.name}</h2>
      <p className="quiet">
        {[row.title, row.firm].filter(Boolean).join(" · ")}
        {row.domain ? ` · ${row.domain}` : ""}
      </p>
      <dl className="facts">
        <dt>Now</dt>
        <dd>
          <NowCell now={row.now} />
        </dd>
        <dt>Company hiring</dt>
        <dd>{row.hiring ? `${row.hiring.count} open roles` : "Nothing found"}</dd>
        <dt>Last contact</dt>
        <dd>
          {row.lastContactedOn
            ? `${month(row.lastContactedOn)} (${ago(row.lastContactedOn)})`
            : "Never"}
        </dd>
        <dt>Last placement</dt>
        <dd>{row.lastPlacementOn ? month(row.lastPlacementOn) : "None"}</dd>
        <dt>Owner</dt>
        <dd>{row.owner ?? "None"}</dd>
      </dl>

      <h3>Why call now</h3>
      {view.brief ? (
        <p className="brief">
          <Cited text={view.brief.text} marks={marks} />
        </p>
      ) : (
        <p className="empty">No brief yet. One is written once there's something worth saying.</p>
      )}
      {row.score !== null ? (
        <div className="score-line">
          <span className="score">{row.score}</span>
          <Reasons reasons={row.reasons} />
        </div>
      ) : null}

      <h3>Sources</h3>
      {view.sources.length ? (
        <ol className="sources">
          {view.sources.map((s) => (
            <SourceItem key={s.mark} source={s} />
          ))}
        </ol>
      ) : (
        <p className="empty">Nothing found yet.</p>
      )}
    </div>
  );
}

/** The brief with its marks as links down to the sources they cite. */
function Cited({ text, marks }: { text: string; marks: Map<string, Source> }) {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MARKS)) {
    out.push(text.slice(last, m.index).replace(/\s+$/, ""));
    const ids = (m[1] ?? "").split(/\s*[,;]\s*/);
    out.push(
      <sup key={m.index} className="marks">
        {ids.map((id) => {
          const n = [...marks.keys()].indexOf(id.toLowerCase()) + 1;
          return n ? (
            <a key={id} href={`#src-${id.toLowerCase()}`} onClick={(e) => jump(e, id)}>
              {n}
            </a>
          ) : null;
        })}
      </sup>,
    );
    last = (m.index ?? 0) + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

/** Scroll to the source inside the drawer without touching the page's route. */
function jump(e: React.MouseEvent, id: string) {
  e.preventDefault();
  document
    .getElementById(`src-${id.toLowerCase()}`)
    ?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function SourceItem({ source: s }: { source: Source }) {
  const host = hostOf(s.url);
  return (
    <li id={`src-${s.mark.toLowerCase()}`}>
      <div>
        <b>{kindLabel(s.kind)}</b>
        <span className="quiet">
          {" "}
          · {viaLabel(s.via)}
          {s.observedAt ? ` · ${month(s.observedAt.slice(0, 10))}` : ""}
        </span>
      </div>
      {s.title ? <div className="small">{s.title}</div> : null}
      {s.url && host ? (
        // The demo hides profile names, so its profile links lead nowhere: shown, not linked.
        s.url.includes("•••") ? (
          <span className="small quiet">{host}</span>
        ) : (
          <a className="small" href={s.url} target="_blank" rel="noopener noreferrer">
            {host}
          </a>
        )
      ) : null}
    </li>
  );
}
