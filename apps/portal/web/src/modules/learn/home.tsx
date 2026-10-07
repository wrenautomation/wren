/**
 * Learn's home: what you were watching, this week's best, then new from your sources, one shelf
 * per type, and the SOPs items went into lately.
 */
import { Alert, ButtonLink, cx, Loading, relative, StateMark } from "@wren/ui";
import { ChevronLeft, ChevronRight, Link, Rss, Smartphone } from "@wren/ui/lib/lucide";
import { type ReactNode, useEffect, useRef } from "react";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { type Card, type Home, learn, onChanged } from "./api.js";
import { LearnFrame, useRail } from "./frame.js";
import { Avatar, lengthOf, ScoreBadge, Thumb, TYPES, TypeMark } from "./kinds.js";

const SOP_STATES = {
  asked: { label: "Waits for the Mac", tone: "warn" },
  added: { label: "Added", tone: "good" },
  failed: { label: "Failed", tone: "bad" },
} as const;

export function HomePage(_: PageProps) {
  return (
    <LearnFrame here="home">
      <HomeBody />
    </LearnFrame>
  );
}

function HomeBody() {
  const load = useCall("learn.home", learn.home);
  const { retry } = load;
  useEffect(() => onChanged(retry), [retry]);
  const { rail } = useRail();
  const home = load.data;
  const p = rail.places;
  const lede = [
    p.inbox ? `${p.inbox} new in your Inbox` : "Your Inbox is clear",
    p.later ? `${p.later} in Watch later` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex flex-col gap-10 pb-16">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="m-0 font-semibold text-[22px] leading-8 tracking-[-0.01em]">Learn</h1>
          <p className="m-0 mt-0.5 text-[14px] text-(--ui-ink-2)">{lede}</p>
        </div>
        <div className="flex gap-2">
          <ButtonLink href="/learn/items" size="dense" tone="secondary">
            Open Inbox
          </ButtonLink>
          <ButtonLink href="/learn/add" size="dense">
            Save a link
          </ButtonLink>
        </div>
      </header>
      {load.error && !home ? (
        <Alert onRetry={load.retry}>{load.error.message}</Alert>
      ) : !home ? (
        <Loading lines={4} shape="cards" />
      ) : !home.shelves.length && !home.continue.length && !home.top.length && !home.sops.length ? (
        <Welcome />
      ) : (
        <Shelves home={home} />
      )}
    </div>
  );
}

function Shelves({ home }: { home: Home }) {
  return (
    <>
      {home.continue.length ? <Shelf title="Continue watching" items={home.continue} /> : null}
      {home.top.length ? (
        <Shelf
          title="Top this week"
          lede="Scored highest against Wren's SOPs"
          items={home.top}
          more={{ href: "/learn/items?in=all&sort=score", label: "All by score" }}
        />
      ) : null}
      {home.shelves.length ? (
        <div className="flex flex-col gap-8">
          <h2 className="m-0 border-(--ui-hair) border-t pt-6 font-semibold text-[17px]">
            New from your sources
          </h2>
          {home.shelves.map((s) => (
            <Shelf
              key={s.type}
              title={TYPES[s.type]?.many ?? s.type}
              mark={<TypeMark type={s.type} size={18} />}
              items={s.items}
              tall={s.type === "shorts" || s.type === "tiktok" || s.type === "instagram"}
              more={
                s.total > s.items.length
                  ? { href: `/learn/items?type=${s.type}`, label: `See all ${s.total}` }
                  : { href: `/learn/items?type=${s.type}`, label: "Open" }
              }
              small
            />
          ))}
        </div>
      ) : (
        <p className="m-0 border-(--ui-hair) border-t pt-6 text-[14px] text-(--ui-ink-2)">
          Nothing new from your sources. <a href="/learn/sources">Follow another</a> and its next
          posts land here.
        </p>
      )}
      {home.sops.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="m-0 font-semibold text-[17px]">SOP changes lately</h2>
          <ul className="m-0 list-none border-(--ui-hair) border-t p-0">
            {home.sops.map((s) => (
              <li
                key={s.id}
                className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-(--ui-hair) border-b py-2.5 text-[13.5px]"
              >
                <TypeMark type={s.type} size={14} />
                <a
                  href={`/learn/items/${s.itemId}`}
                  className="min-w-0 flex-1 truncate text-(--ui-ink) no-underline hover:underline"
                >
                  {s.title}
                </a>
                <span className="inline-flex items-center gap-2 text-(--ui-ink-2)">
                  into <span className="font-medium text-(--ui-ink)">{s.sop}</span>
                  <StateMark state={SOP_STATES[s.state]} />
                </span>
                <span className="w-24 text-right text-[12.5px] text-(--ui-ink-2)">
                  {relative(new Date(s.at))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function Shelf({
  title,
  lede,
  mark,
  items,
  more,
  tall = false,
  small = false,
}: {
  title: string;
  lede?: string;
  mark?: ReactNode;
  items: Card[];
  more?: { href: string; label: string };
  tall?: boolean;
  small?: boolean;
}) {
  const row = useRef<HTMLDivElement>(null);
  const by = (dir: 1 | -1) =>
    row.current?.scrollBy({ left: dir * row.current.clientWidth * 0.8, behavior: "smooth" });
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2
            className={cx(
              "m-0 flex items-center gap-2 font-semibold",
              small ? "text-[15px]" : "text-[17px]",
            )}
          >
            {mark}
            {title}
          </h2>
          {lede ? <p className="m-0 mt-0.5 text-[13px] text-(--ui-ink-2)">{lede}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {more ? (
            <a
              href={more.href}
              className="mr-1 text-[13px] text-(--ui-ink-2) no-underline hover:text-(--ui-ink)"
            >
              {more.label}
            </a>
          ) : null}
          <button
            type="button"
            aria-label="Back"
            onClick={() => by(-1)}
            className="hidden size-8 items-center justify-center border border-(--ui-hair) bg-(--ui-paper) text-(--ui-ink-2) hover:text-(--ui-ink) sm:inline-flex"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            aria-label="More"
            onClick={() => by(1)}
            className="hidden size-8 items-center justify-center border border-(--ui-hair) bg-(--ui-paper) text-(--ui-ink-2) hover:text-(--ui-ink) sm:inline-flex"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div
        ref={row}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain pb-2"
      >
        {items.map((c) => (
          <ShelfCard key={c.id} c={c} tall={tall} />
        ))}
      </div>
    </section>
  );
}

function ShelfCard({ c, tall }: { c: Card; tall: boolean }) {
  const len = lengthOf(c);
  const name = c.source?.name ?? c.creator ?? (c.saved ? "Saved by you" : "Link");
  return (
    <a
      href={`/learn/items/${c.id}`}
      className={cx(
        "group flex shrink-0 snap-start flex-col gap-2 text-(--ui-ink) no-underline",
        tall ? "w-40" : "w-[260px]",
      )}
    >
      <div className="relative">
        <Thumb card={c} tall={tall} />
        <span className="absolute bottom-1.5 left-1.5">
          <ScoreBadge score={c.score} />
        </span>
      </div>
      <span className="flex gap-1.5">
        {c.status === "unread" ? (
          <span className="mt-[0.45em] size-2 shrink-0 rounded-full bg-(--ui-accent)" title="New" />
        ) : null}
        <span className="line-clamp-2 font-semibold text-[14px] leading-snug group-hover:underline">
          {c.title}
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-(--ui-ink-2)">
        <Avatar url={c.source?.avatar ?? null} name={name} size={16} />
        <span className="truncate">{name}</span>
        {len && !tall ? <span className="shrink-0">· {len}</span> : null}
      </span>
      {c.summary && !tall ? (
        <span className="line-clamp-2 text-[12.5px] text-(--ui-ink-2) leading-relaxed">
          {c.summary}
        </span>
      ) : null}
    </a>
  );
}

/** Nothing in Learn at all: the three ways in. */
function Welcome() {
  const steps: { Icon: typeof Rss; title: string; body: string; href: string; cta: string }[] = [
    {
      Icon: Rss,
      title: "Follow a source",
      body: "A YouTube channel, podcast, newsletter or blog. Each new post is read, summed up and scored against Wren's SOPs.",
      href: "/learn/sources",
      cta: "Follow one",
    },
    {
      Icon: Smartphone,
      title: "Save from your phone",
      body: "Share any reel, video or article to the Learn shortcut. It lands in Saved by you and gets read the same way.",
      href: "/learn/add",
      cta: "Save a link",
    },
    {
      Icon: Link,
      title: "Organize like a drive",
      body: "Star, queue for later, and drag items into collections that nest like folders. Press ? on any list for the keys.",
      href: "/learn/items?in=all",
      cta: "Open items",
    },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {steps.map((s) => (
        <div
          key={s.title}
          className="flex flex-col gap-3 border border-(--ui-hair) bg-(--ui-paper) p-5"
        >
          <s.Icon size={20} className="text-(--ui-accent)" />
          <h2 className="m-0 font-semibold text-[15px]">{s.title}</h2>
          <p className="m-0 flex-1 text-[13.5px] text-(--ui-ink-2) leading-relaxed">{s.body}</p>
          <div>
            <ButtonLink href={s.href} size="dense" tone="secondary">
              {s.cta}
            </ButtonLink>
          </div>
        </div>
      ))}
    </div>
  );
}
