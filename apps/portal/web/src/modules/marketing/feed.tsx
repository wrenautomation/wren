/**
 * Marketing → Feed. Following: the newest posts from everyone followed (Learn's sources, one set
 * for both apps). Explore (`marketing.explore`, its own list page): what the topic searches found
 * that no one follows yet. Sources: who's followed, and the search to find more by name or topic.
 * Reply drafts on a post now (`ReachDesk.paste`, it waits in Engage); Use as idea opens Write with
 * it; Mute stops following its source.
 */
import {
  Button,
  ButtonLink,
  cx,
  Empty,
  LoadFailed,
  Loading,
  PAGE_TITLE,
  relative,
  say,
  TabBar,
} from "@wren/ui";
import { useEffect, useRef, useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { type Card, changed, inWorkspace, keyOf, learn, onChanged } from "../learn/api.js";
import { Avatar } from "../learn/kinds.js";
import { SourcesBody } from "../learn/sources.js";

const TABS = [
  ["following", "Following", "/marketing/feed"],
  ["explore", "Explore", "/marketing/explore"],
  ["sources", "Sources", "/marketing/feed?tab=sources"],
] as const;
type Tab = (typeof TABS)[number][0];

/** The three views, as links: Explore is a list page of its own. */
export function FeedTabs({ on }: { on: Tab }) {
  const row = useRef<HTMLElement>(null);
  return (
    <nav ref={row} aria-label="Feed" className="relative flex gap-1 border-(--ui-hair) border-b">
      <TabBar nav={row} on={on} row="feed" />
      {TABS.map(([id, label, href]) => (
        <a
          key={id}
          href={href}
          aria-current={id === on ? "page" : undefined}
          className={cx(
            "-mb-px border-transparent border-b-2 px-3 py-2 font-medium text-[14px] text-(--ui-ink-2) no-underline hover:text-(--ui-ink)",
            "aria-[current=page]:text-(--ui-ink)",
          )}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}

export function FeedPage({ client, params }: PageProps) {
  inWorkspace(client);
  if (params.get("tab") === "sources")
    return <SourcesBody title="Feed" tabs={<FeedTabs on="sources" />} />;
  return <Following />;
}

/** Sites a reply can go on: the paste box takes their posts. */
const REPLIES = /(^|\.)(x\.com|twitter\.com|instagram\.com|linkedin\.com|reddit\.com)$/;
const replyable = (url: string) => {
  try {
    return REPLIES.test(new URL(url).hostname.replace(/^www\./, ""));
  } catch {
    return false;
  }
};

function Following() {
  const sources = useCall(keyOf("learn.sources"), learn.sources);
  const ids = sources.data?.kinds.flatMap((k) => k.sources.map((s) => String(s.id))) ?? [];
  const [items, setItems] = useState<Card[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [again, setAgain] = useState(0);
  const key = ids.join(",");
  const { retry } = sources;
  useEffect(() => onChanged(retry), [retry]);

  useEffect(() => {
    void again;
    if (!sources.data) return;
    if (!key) {
      setItems([]);
      return;
    }
    learn
      .browse({
        place: "all",
        types: [],
        sources: key.split(","),
        tag: "",
        q: "",
        sort: "newest",
        limit: 40,
      })
      .then(
        (b) => setItems(b.items),
        (err: unknown) => setError(err),
      );
  }, [sources.data, key, again]);

  return (
    <div className="flex flex-col gap-6 pb-16">
      <header className="flex flex-col gap-4">
        <h1 className={PAGE_TITLE}>Feed</h1>
        <FeedTabs on="following" />
      </header>
      {error || (sources.error && !sources.data) ? (
        <LoadFailed
          error={error ?? sources.error}
          onRetry={() => {
            setError(null);
            sources.retry();
            setAgain((n) => n + 1);
          }}
        />
      ) : items === null ? (
        <Loading lines={5} shape="cards" />
      ) : !items.length ? (
        <Empty>
          {key ? (
            "Nothing new from the people you follow yet."
          ) : (
            <>
              You don't follow anyone yet. Find people by name or topic under{" "}
              <a href="/marketing/feed?tab=sources">Sources</a>.
            </>
          )}
        </Empty>
      ) : (
        <ul className="m-0 flex max-w-3xl list-none flex-col gap-3 p-0">
          {items.map((c) => (
            <FeedItem key={c.id} c={c} onMuted={() => changed()} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FeedItem({ c, onMuted }: { c: Card; onMuted: () => void }) {
  const [busy, setBusy] = useState<"reply" | "mute" | null>(null);
  const reply = async () => {
    setBusy("reply");
    try {
      const r = await call<{ said: string }>("console/call", {
        service: "ReachDesk",
        handler: "paste",
        input: { url: c.url },
      });
      say.done(r.said);
    } catch (err) {
      say.failed(err);
    } finally {
      setBusy(null);
    }
  };
  const mute = async () => {
    const s = c.source;
    if (!s) return;
    setBusy("mute");
    try {
      await learn.unfollow(s.id);
      say.done(`Muted ${s.name}. Nothing new from them shows here.`);
      onMuted();
    } catch (err) {
      say.failed(err);
      setBusy(null);
    }
  };
  const idea = `/marketing/studio?idea=${encodeURIComponent(`${c.title}\n${c.url}\n\n`)}`;
  return (
    <li className="flex gap-3 border border-(--ui-hair) bg-(--ui-paper) p-4">
      <Avatar url={c.source?.avatar ?? null} name={c.source?.name ?? c.title} size={32} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-[12.5px] text-(--ui-ink-2)">
          {c.source?.name ?? c.creator ?? "Saved"} · {relative(new Date(c.at))}
          {c.score !== null ? ` · ${c.score}/10` : ""}
        </span>
        <a
          href={c.url}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-(--ui-ink) text-[15px]"
        >
          {c.title}
        </a>
        {c.summary ? (
          <p className="m-0 line-clamp-3 text-[13.5px] text-(--ui-ink-2)">{c.summary}</p>
        ) : null}
        <div className="mt-1 flex flex-wrap gap-2">
          {replyable(c.url) ? (
            <Button
              tone="primary"
              size="dense"
              busy={busy === "reply"}
              onClick={() => void reply()}
            >
              Reply
            </Button>
          ) : null}
          <ButtonLink size="dense" tone="secondary" href={idea}>
            Use as idea
          </ButtonLink>
          <ButtonLink size="dense" tone="secondary" href={`/learn/items/${c.id}`}>
            Read
          </ButtonLink>
          {c.source ? (
            <Button
              size="dense"
              tone="secondary"
              busy={busy === "mute"}
              onClick={() => void mute()}
            >
              Mute
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
