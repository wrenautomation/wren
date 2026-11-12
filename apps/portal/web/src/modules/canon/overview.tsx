/**
 * Canon › Overview: the whole brain at a glance. Every topic (guide, rule sets, skill, notes), the
 * records by type, the direction docs, open conflicts, and records whose evidence changed.
 */
import type { Home } from "@wren/research/canon-library";
import { Empty, LoadFailed, Loading, num, Tag, useSeen } from "@wren/ui";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { href, navigate } from "../../route.js";
import { Search, Section, typeName } from "./parts.js";
import { fileHref, OpenedHere, recordHref } from "./record.js";

const HERE = "/canon/overview";
const WHY: Record<string, string> = {
  missing: "cites a record not in Canon",
  retired: "cites a retired record",
  changed: "its evidence changed since",
};

export function OverviewPage({ params }: PageProps) {
  const got = useCall("canon-home", () => call<Home>("canon/home", {}));
  useSeen(
    "list",
    got.data
      ? {
          label: "Canon",
          icon: "book",
          text: `Canon topics: ${got.data.topics.map((t) => t.name).join(", ")}`,
        }
      : null,
  );
  if (got.error && !got.data) return <LoadFailed error={got.error} onRetry={got.retry} />;
  if (!got.data) return <Loading shape="rows" lines={6} />;
  const h = got.data;
  if (!h.indexed)
    return (
      <Empty title="No index here yet" waits>
        Canon reaches this page after the first sync: `wren canon sync`.
      </Empty>
    );
  const byRecord = new Map<string, Home["stale"]>();
  for (const s of h.stale) byRecord.set(s.id, [...(byRecord.get(s.id) ?? []), s]);
  const stale = [...byRecord.values()];
  const titles = new Map(h.topics.map((t) => [t.name, t.title]));
  const topicTitle = (name: string) => titles.get(name) ?? name;
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3 @min-[720px]/main:flex-row @min-[720px]/main:items-center">
        <Search
          value=""
          label="Search Canon"
          placeholder="Search every record and file"
          onChange={(q) => q && navigate(href("/canon/library", { q }))}
        />
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {h.types.map((t) => (
            <li key={t.value}>
              <a href={href("/canon/library", { type: t.value })} className="no-underline">
                <Tag>
                  {typeName(t.value, t.n !== 1)} <b className="tabular-nums">{num(t.n)}</b>
                </Tag>
              </a>
            </li>
          ))}
        </ul>
      </div>

      <Section title={`Topics (${h.topics.length})`}>
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 @min-[720px]/main:grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
          {h.topics.map((t) => (
            <li key={t.name} className="min-w-0">
              <a
                href={href("/canon/topic", { t: t.name })}
                className="flex h-full flex-col gap-1.5 bg-(--ui-band) p-3 text-(--ui-ink) no-underline hover:bg-(--ui-hover) [border-radius:4px_10px_4px_10px]"
              >
                <span className="text-[15px] leading-snug font-semibold wrap-anywhere">
                  {t.title}
                </span>
                {t.description && (
                  <span className="text-[13px] leading-normal text-pretty text-(--ui-ink-2)">
                    {t.description}
                  </span>
                )}
                <span className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-[12.5px] text-(--ui-ink-3)">
                  <span>
                    {t.sets} {t.sets === 1 ? "rule set" : "rule sets"}, {num(t.lines)} lines
                  </span>
                  {!t.guide && <span>no guide</span>}
                  {t.skill && <span>skill</span>}
                  {t.notes && <span>his notes</span>}
                  {t.conflicts > 0 && (
                    <Tag tone="warn">
                      {t.conflicts} open {t.conflicts === 1 ? "conflict" : "conflicts"}
                    </Tag>
                  )}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </Section>

      {h.shared.length > 0 && (
        <Section
          title={`Shared rule sets (${h.shared.length})`}
          about="Sets one topic owns and other topics load. A change here reaches each of them."
        >
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {h.shared.map((s) => (
              <li key={s.id} className="flex flex-col text-[14px] leading-snug">
                <a
                  href={
                    s.owner
                      ? `${href("/canon/topic", { t: s.owner })}#set-${s.id}`
                      : recordHref(HERE, s.id, params)
                  }
                  className="wrap-anywhere"
                >
                  {s.title}
                </a>
                <span className="text-[12.5px] text-(--ui-ink-3)">
                  {s.owner ? `${topicTitle(s.owner)}'s, loaded by ` : "Loaded by "}
                  {s.users.map((u, i) => (
                    <span key={u}>
                      {i > 0 && ", "}
                      <a href={href("/canon/topic", { t: u })}>{topicTitle(u)}</a>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div className="grid grid-cols-1 gap-8 @min-[960px]/main:grid-cols-2">
        <Section title="Direction">
          {h.direction.length ? (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {h.direction.map((d) => (
                <li key={d.path} className="flex flex-col text-[14px] leading-snug">
                  <a href={fileHref(HERE, d.path, params)} className="wrap-anywhere">
                    {d.title}
                  </a>
                  <span className="text-[12px] text-(--ui-ink-3)">
                    {/^direction\/(\d{4}-\d{2}-\d{2})/.exec(d.path)?.[1] ?? d.path}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-[13.5px] text-(--ui-ink-3)">No direction docs.</p>
          )}
        </Section>

        <Section title="Open conflicts">
          {h.conflicts.length ? (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {h.conflicts.map((c) => (
                <li key={c.id} className="text-[14px] leading-snug">
                  <a href={recordHref(HERE, c.id, params)} className="wrap-anywhere">
                    {c.title}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-[13.5px] text-(--ui-ink-3)">None open.</p>
          )}
        </Section>
      </div>

      <Section title={`Needs a look (${stale.length})`}>
        {stale.length ? (
          <details>
            <summary className="cursor-pointer text-[13.5px] text-(--ui-ink-2)">
              {stale.length} live {stale.length === 1 ? "record rests" : "records rest"} on evidence
              that changed, went away or was retired. Show them
            </summary>
            <ul className="mt-2 mb-0 flex list-none flex-col gap-2 p-0">
              {stale.map((group) => {
                const first = group[0];
                if (!first) return null;
                return (
                  <li key={first.id} className="flex flex-col text-[13.5px] leading-snug">
                    <a href={recordHref(HERE, first.id, params)} className="wrap-anywhere">
                      {first.title}
                    </a>
                    <span className="text-[12px] text-(--ui-ink-3) wrap-anywhere">
                      {typeName(first.type)}:{" "}
                      {group.map((s) => `${WHY[s.why] ?? s.why} (${s.cites})`).join("; ")}
                    </span>
                  </li>
                );
              })}
            </ul>
          </details>
        ) : (
          <p className="m-0 text-[13.5px] text-(--ui-ink-3)">Every record is current.</p>
        )}
      </Section>

      {h.other.length > 0 && (
        <Section title="Other files">
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[13.5px]">
            {h.other.map((f) => (
              <li key={f.path}>
                <a href={fileHref(HERE, f.path, params)} className="wrap-anywhere">
                  {f.path}
                </a>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {h.head && (
        <p className="m-0 text-[12px] text-(--ui-ink-3)">
          Indexed at Canon commit <code>{h.head.slice(0, 8)}</code>
        </p>
      )}
      <OpenedHere here={HERE} params={params} />
    </div>
  );
}
