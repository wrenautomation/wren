/**
 * Vireo's cards in the agent chat (WA-1262). The CLI names a card (`::view vireo.batch` or
 * `vireo.subject`); the card reads the page's own call, live, so the chat and the page never
 * disagree and blind rules hold. A compact batch: one tile per sample, marks fill in as they land.
 * A compact subject: the page's tree, newest rows at the foot.
 */
import {
  AgentSay,
  type AgentViews,
  cx,
  Icon,
  LoadFailed,
  Loading,
  type NextAsk,
  type OnAsk,
  ProductCard,
  Tag,
} from "@wren/ui";
import { useContext, useMemo, useRef } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import { href, navigate } from "../../route.js";
import { countsOf, Tally, type Whole } from "./batches.js";
import { pct } from "./marks.js";
import type { SubjectView } from "./page.js";
import { VERDICT_ON, ZONE_OF } from "./score.js";
import { TreeCard } from "./tree.js";
import "./chat-card.css";

const OPEN = "Open in Variants";
/** one tile after another as a batch first draws */
const TILE_STAGGER_MS = 50;

const batchRefOf = (data: unknown): string | null => {
  const b = (data as { batch?: unknown } | null)?.batch;
  return typeof b === "string" || typeof b === "number" ? String(b) : null;
};
const subjectIdOf = (data: unknown): number | null => {
  const s = Number((data as { subject?: unknown } | null)?.subject);
  return Number.isSafeInteger(s) && s > 0 ? s : null;
};

function BatchRef({ data }: { data: unknown }) {
  const ref = batchRefOf(data);
  // the page's key: one read for page and card
  const got = useCall(
    ref ? `variants-batch:${ref}` : null,
    () => call<Whole>("variants/batch", { ref }),
    { live: "variants" },
  );
  const say = useContext(AgentSay);
  if (!ref) return null;
  if (got.error && !got.data) return <LoadFailed error={got.error} onRetry={got.retry} />;
  if (!got.data) return <Loading shape="rows" lines={2} />;
  return <BatchCard row={got.data} onAsk={say} />;
}

/** One batch, compact: its head, a tile per sample, the tally and the agent's why once closed. */
export function BatchCard({ row: r, onAsk }: { row: Whole; onAsk?: OnAsk }) {
  const open = r.state === "open";
  const samples = useMemo(() => [...r.samples].sort((a, b) => a.id - b.id), [r.samples]);
  const marked = samples.filter((s) => s.verdict).length;
  // the first draw lands tile by tile; a sample added later lands on its own
  const born = useRef<ReadonlySet<number> | null>(null);
  born.current ??= new Set(samples.map((s) => s.id));
  const asks: NextAsk[] =
    !open && !r.newer
      ? [
          {
            ask: `Make the next batch of ${r.subject.slug} from my calls`,
            why: "reads every call and note on this batch",
          },
        ]
      : [];
  return (
    <ProductCard
      product="Vireo"
      what="Vireo batch"
      name={r.title || `Batch ${r.n}`}
      meta={[
        r.subject.name,
        `Batch ${r.n}`,
        `${samples.length} samples`,
        ...(r.goodRate != null ? [`${pct(r.goodRate)} good or better`] : []),
      ].join(" · ")}
      href={href("/variants/batches", { b: r.ref })}
      open={OPEN}
      status={
        open ? (
          <Tag tone="needs" dot>
            {marked} of {samples.length} marked
          </Tag>
        ) : null
      }
      asks={asks}
      onAsk={onAsk}
    >
      <ul
        aria-label="Samples"
        className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-2 p-0"
      >
        {samples.map((s, i) => {
          const letter = String.fromCharCode(65 + (i % 26));
          const label = s.name ?? `Sample ${letter}`;
          const v = s.verdict;
          return (
            <li
              key={s.id}
              className="ui-rise relative min-w-0"
              style={{
                animationDelay: born.current?.has(s.id) ? `${i * TILE_STAGGER_MS}ms` : "0ms",
              }}
            >
              <span
                role="img"
                aria-label={`${label}${v ? `, ${ZONE_OF[v].label}` : open ? ", not marked" : ""}`}
                title={label}
                className={cx(
                  "vc-tile grid aspect-[8/5] place-items-center overflow-hidden rounded-[6px] border-[1.5px] text-[13px] font-semibold",
                  v ? VERDICT_ON[v] : "border-(--ui-hair) bg-(--ui-fill) text-(--ui-ink-3)",
                )}
              >
                {s.posterUrl ? (
                  <img
                    src={s.posterUrl}
                    alt=""
                    loading="lazy"
                    className="col-start-1 row-start-1 size-full object-cover"
                  />
                ) : null}
                <span
                  className={cx(
                    "col-start-1 row-start-1",
                    s.posterUrl &&
                      "self-start justify-self-start m-1 grid size-5 place-items-center rounded-full bg-(--ui-paper) text-[11px] text-(--ui-ink)",
                  )}
                >
                  {letter}
                </span>
              </span>
              {v ? (
                <span
                  // a new call remounts it: the pop says it just landed
                  key={v}
                  aria-hidden="true"
                  className={cx(
                    "vc-pop absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full border",
                    VERDICT_ON[v],
                  )}
                >
                  <Icon name={ZONE_OF[v].icon} size={11} />
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {!open && <Tally counts={countsOf(samples)} />}
      {r.why ? (
        <p className="m-0 text-[13px]/[1.5] text-(--ui-ink-2)">
          <span className="text-(--ui-ink-3)">Agent: </span>
          {r.why}
        </p>
      ) : null}
      {r.note ? (
        <p className="m-0 text-[13px]/[1.5] text-(--ui-ink)">
          <span className="text-(--ui-ink-3)">You: </span>
          {r.note}
        </p>
      ) : null}
    </ProductCard>
  );
}

function SubjectRef({ data }: { data: unknown }) {
  const id = subjectIdOf(data);
  const got = useCall(
    id ? `variants-subject:${id}` : null,
    () => call<SubjectView>("variants/subject", { id }),
    { live: "variants" },
  );
  const say = useContext(AgentSay);
  if (!id) return null;
  if (got.error && !got.data) return <LoadFailed error={got.error} onRetry={got.retry} />;
  if (!got.data) return <Loading shape="rows" lines={3} />;
  return <SubjectCard v={got.data} onAsk={say} />;
}

/** One subject, compact: its head and the page's tree. A tap on a sample opens the subject. */
export function SubjectCard({ v, onAsk }: { v: SubjectView; onAsk?: OnAsk }) {
  const s = v.subject;
  const waits = v.batches.find((b) => b.state === "open");
  const kept = v.batches.reduce((n, b) => n + b.samples.filter((x) => x.keptAt).length, 0);
  const page = href("/variants/subjects", { subject: s.id });
  return (
    <ProductCard
      product="Vireo"
      what="Vireo subject"
      name={s.name}
      meta={[
        s.kind,
        `${v.batches.length} ${v.batches.length === 1 ? "batch" : "batches"}`,
        ...(kept ? [`${kept} kept`] : []),
      ].join(" · ")}
      href={page}
      open={OPEN}
      status={
        waits ? (
          <Tag tone="needs" dot>
            A batch waits
          </Tag>
        ) : null
      }
      asks={
        waits
          ? []
          : [{ ask: `Make the next batch of ${s.slug}`, why: "from the tree, the calls and tips" }]
      }
      onAsk={onAsk}
    >
      {s.brief ? <p className="m-0 text-[13px]/[1.5] text-(--ui-ink-2)">{s.brief}</p> : null}
      {v.batches.length ? (
        <TreeCard
          subject={s}
          batches={v.batches}
          guides={v.guides}
          pruned={v.pruned}
          onOpen={() => navigate(page)}
        />
      ) : (
        <p className="m-0 flex items-center gap-1.5 text-[13px] text-(--ui-ink-3)">
          <Icon name="split" size={14} />
          No batch yet
        </p>
      )}
    </ProductCard>
  );
}

export const VIREO_REFS: AgentViews = { "vireo.batch": BatchRef, "vireo.subject": SubjectRef };
