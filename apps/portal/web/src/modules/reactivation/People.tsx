/** Everyone on the list, filtered by what we found; one person opens in a drawer with their brief. */
import {
  Alert,
  ago,
  Drawer,
  Empty,
  Facts,
  Loading,
  month,
  PageHeader,
  Pager,
  SearchField,
  Table,
  Tabs,
  Tag,
} from "@wren/ui";
import { call, type PeopleFilter, type PeoplePage, type PersonView } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { Cited, NowCell, Reasons, SourceCards, useSourcePick } from "./bits.js";
import { at, goto } from "./nav.js";

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

export function People({ client, demo, params }: PageProps) {
  const filter = (params.get("filter") as PeopleFilter | null) ?? "all";
  const offset = Number(params.get("offset")) || 0;
  const q = params.get("q") ?? "";
  const person = Number(params.get("person")) || null;
  const list = useCall(`people:${client}:${filter}:${offset}:${q}`, () =>
    call<PeoplePage>("people", { client, filter, offset, ...(q ? { q } : {}) }),
  );
  const set = (p: Record<string, string | number | null>) => goto("people", p, params);
  const d = list.data;

  return (
    <>
      <PageHeader
        title="People"
        lede="Everyone on your list and what we found. Pick someone for their brief and its sources."
      />
      <Tabs
        label="Filter"
        current={filter}
        items={(Object.keys(FILTERS) as PeopleFilter[]).map((f) => ({
          id: f,
          label: FILTERS[f],
          href: at("people", { filter: f === "all" ? null : f, q: q || null }),
          count: d?.counts[f],
        }))}
      >
        {demo ? null : (
          <SearchField
            value={q}
            label="Search people"
            placeholder="Name or company"
            onSearch={(v) => set({ q: v || null, offset: null })}
          />
        )}
      </Tabs>

      {list.error && !d ? <Alert onRetry={list.retry}>{list.error.message}</Alert> : null}
      {d ? (
        d.rows.length ? (
          <Table stale={list.loading} stack className="rx-people">
            <thead>
              <tr>
                <th>Name</th>
                <th>Company on your list</th>
                <th>Now</th>
                <th>Hiring</th>
                <th className="ui-num">Score</th>
                <th>Last contact</th>
                <th>Owner</th>
                <th>Email</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr
                  key={r.personId}
                  aria-selected={r.personId === person}
                  onClick={() => set({ person: r.personId })}
                >
                  <td>
                    <a href={at("people", { ...Object.fromEntries(params), person: r.personId })}>
                      <b>{r.name}</b>
                    </a>
                    {r.title ? <div className="rx-sub">{r.title}</div> : null}
                  </td>
                  <td data-label="Company on your list">{r.firm}</td>
                  <td data-label="Now" data-wide>
                    <NowCell now={r.now} />
                  </td>
                  <td data-label="Hiring">
                    {r.hiring ? <Tag tone="green">{r.hiring.count} open</Tag> : null}
                  </td>
                  <td data-label="Score" className="ui-num">
                    {r.score}
                  </td>
                  <td data-label="Last contact" className="ui-nowrap">
                    {ago(r.lastContactedOn)}
                  </td>
                  <td data-label="Owner" className="ui-nowrap">
                    {r.owner}
                  </td>
                  <td data-label="Email" className="ui-nowrap">
                    {r.email ? (
                      <span title={r.email.address}>
                        {r.email.verdict
                          ? (VERDICTS[r.email.verdict] ?? r.email.verdict)
                          : "Not checked"}
                      </span>
                    ) : (
                      <span className="rx-quiet">None</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>{q ? `Nobody matches “${q}”.` : "Nobody here."}</Empty>
        )
      ) : list.error ? null : (
        <Loading lines={10} shape="rows" />
      )}
      {d ? (
        <Pager
          offset={offset}
          size={PAGE}
          total={d.total}
          onPage={(o) => set({ offset: o || null })}
        />
      ) : null}

      {person ? (
        <Drawer label="Person" onClose={() => set({ person: null })}>
          <PersonPanel client={client} personId={person} />
        </Drawer>
      ) : null}
    </>
  );
}

function PersonPanel({ client, personId }: { client: string; personId: number }) {
  const p = useCall(`person:${client}:${personId}`, () =>
    call<PersonView>("person", { client, personId }),
  );
  if (p.error && !p.data) return <Alert onRetry={p.retry}>{p.error.message}</Alert>;
  if (!p.data) return <Loading lines={9} label="Loading their brief" />;
  return <Person view={p.data} />;
}

function Person({ view }: { view: PersonView }) {
  const { row } = view;
  const order = view.sources.map((s) => s.mark.toLowerCase());
  const [lit, pick] = useSourcePick();
  return (
    <article className="rx-person">
      <header>
        <h2>{row.name}</h2>
        <p className="rx-quiet">
          {[row.title, row.firm].filter(Boolean).join(" · ")}
          {row.domain ? ` · ${row.domain}` : ""}
        </p>
      </header>
      <Facts
        items={[
          ["Now", <NowCell key="now" now={row.now} />],
          ["Company hiring", row.hiring ? `${row.hiring.count} open roles` : "Nothing found"],
          [
            "Last contact",
            row.lastContactedOn
              ? `${month(row.lastContactedOn)} (${ago(row.lastContactedOn)})`
              : "Never",
          ],
          ["Last placement", row.lastPlacementOn ? month(row.lastPlacementOn) : "None"],
          ["Owner", row.owner ?? "None"],
        ]}
      />

      <h3>Why call now</h3>
      {view.brief ? (
        <p className="rx-brief">
          <Cited text={view.brief.text} order={order} lit={lit} onPick={pick} />
        </p>
      ) : (
        <Empty>No brief yet. One is written once there's something worth saying.</Empty>
      )}
      {row.score !== null ? (
        <div className="rx-score-line">
          <span className="rx-score" title="Score">
            {row.score}
          </span>
          <Reasons reasons={row.reasons} />
        </div>
      ) : null}

      <h3>Sources</h3>
      {view.sources.length ? (
        <SourceCards sources={view.sources} lit={lit} />
      ) : (
        <Empty>Nothing found yet.</Empty>
      )}
    </article>
  );
}
