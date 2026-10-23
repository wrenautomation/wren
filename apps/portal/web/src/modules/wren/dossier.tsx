/**
 * A firm's dossier on its page: what the sheet holds on it, each fact with its source and day,
 * its newest posts, and its people. Read only. A client sees it once Company dossier is installed;
 * until then the section points to the Shop.
 */
import { Empty, LoadFailed, Loading, tipProps, useNarrow } from "@wren/ui";
import { ApiError, call } from "../../api.js";
import { useCall } from "../../load.js";
import { dayLabel, QUIET } from "../work/bits.js";
import { RowsPanel } from "../work/rows-panel.js";

/** `@wren/research/dossier`'s `DossierBrief`, as `email/dossier` answers it. */
interface BriefFact {
  what: string;
  text: string;
  source: string | null;
  via: string;
  seen: string;
}
interface DossierBrief {
  facts: BriefFact[];
  posts: {
    site: string;
    kind: string;
    text: string;
    url: string | null;
    published: string | null;
  }[];
  people: { name: string; title: string | null; origin: string; facts: BriefFact[] }[];
}

const PART = "research.dossier";

/** A fact as a row: what it is, what the sheet holds, how it came, and the day. */
function FactRows({ facts, label }: { facts: BriefFact[]; label: string }) {
  const narrow = useNarrow();
  return (
    <RowsPanel<BriefFact>
      rows={facts}
      rowKey={(f) => `${f.what}:${f.seen}:${f.text}`}
      label={label}
      noun="fact"
      name={{
        label: "Fact",
        icon: "text",
        min: 140,
        width: 160,
        title: (f) => f.what,
        weight: () => "font-medium capitalize text-(--ui-ink)",
        // A phone's row has no text column: what the sheet holds goes under the name.
        sub: narrow
          ? (f) => <span className="text-[13px] text-(--ui-ink-2)">{f.text}</span>
          : undefined,
      }}
      columns={[
        {
          key: "text",
          label: "What the sheet holds",
          icon: "lines",
          min: 260,
          cell: (f) => (
            <span className="block wrap-anywhere whitespace-normal" {...tipProps(f.text)}>
              {f.text}
            </span>
          ),
        },
        {
          key: "via",
          label: "Via",
          icon: "link",
          width: 200,
          cell: (f) => (
            <span className="flex min-w-0 items-center gap-2">
              <span className="wrap-anywhere whitespace-normal">{f.via}</span>
              {f.source ? (
                <a href={f.source} target="_blank" rel="noreferrer" className="flex-none">
                  Source
                </a>
              ) : null}
            </span>
          ),
        },
        {
          key: "seen",
          label: "Seen",
          icon: "clock",
          width: 110,
          quiet: true,
          phone: true,
          cell: (f) => dayLabel(f.seen),
        },
      ]}
    />
  );
}

export function FirmDossier({ client, id }: { client: string; id: string }) {
  const got = useCall(`dossier:${client}:${id}`, () =>
    call<DossierBrief>("email/dossier", { client, id: Number(id) }),
  );
  if (got.error && !got.data) {
    if (
      got.error instanceof ApiError &&
      got.error.status === 404 &&
      /not installed/.test(got.error.message)
    )
      return (
        <p className={QUIET}>
          Company dossier isn't installed.{" "}
          <a href={`/marketplace/catalog/${PART}?client=${encodeURIComponent(client)}`}>
            See it in the Shop
          </a>
          .
        </p>
      );
    return <LoadFailed error={got.error} onRetry={got.retry} />;
  }
  if (!got.data) return <Loading shape="rows" lines={3} />;
  const d = got.data;
  if (!d.facts.length && !d.posts.length && !d.people.length)
    return <Empty>Nothing on this company yet. Facts show here as the sheet reads them.</Empty>;
  return (
    <div className="grid gap-6">
      {d.facts.length ? <FactRows facts={d.facts} label="Facts" /> : null}
      {d.posts.length ? (
        <div className="grid gap-2">
          <h3 className="text-[13.5px] font-medium">Recent posts</h3>
          <RowsPanel<DossierBrief["posts"][number]>
            rows={d.posts}
            rowKey={(p) => `${p.site}:${p.url ?? p.text}`}
            label="Recent posts"
            noun="post"
            name={{ label: "Post", icon: "text", min: 260, title: (p) => p.text || "No text" }}
            columns={[
              {
                key: "site",
                label: "Where",
                icon: "link",
                width: 160,
                cell: (p) => `${p.site} ${p.kind}`,
              },
              {
                key: "published",
                label: "Published",
                icon: "clock",
                width: 110,
                quiet: true,
                phone: true,
                cell: (p) => dayLabel(p.published),
              },
              {
                key: "open",
                label: "Link",
                icon: "link",
                width: 80,
                cell: (p) =>
                  p.url ? (
                    <a href={p.url} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  ) : null,
              },
            ]}
          />
        </div>
      ) : null}
      {d.people.map((p) => (
        <div key={`${p.name}:${p.origin}`} className="grid gap-2">
          <h3 className="text-[13.5px] font-medium">
            {p.name}
            {p.title ? <span className={QUIET}>, {p.title}</span> : null}
          </h3>
          {p.facts.length ? (
            <FactRows facts={p.facts} label={`Facts on ${p.name}`} />
          ) : (
            <p className={QUIET}>No facts on them yet.</p>
          )}
        </div>
      ))}
    </div>
  );
}
