/**
 * Find someone to follow by name or topic, on YouTube, Reddit, LinkedIn, X, Instagram and TikTok
 * at once (`ReachDesk.findCreators`): no address needed. Follow puts a feed in Learn's sources;
 * a LinkedIn page or person joins the comments' follows instead (`ReachDesk.paste`), read first
 * each day. Wren's own workspace only: the search reads as Wren's accounts.
 */
import { Button, clipProps, cx, Input, say } from "@wren/ui";
import { type FormEvent, useState } from "react";
import { call } from "../../api.js";
import { changed, learn } from "./api.js";
import { Avatar } from "./kinds.js";

type Site = "youtube" | "reddit" | "linkedin" | "x" | "instagram" | "tiktok";
interface Hit {
  site: Site;
  handle: string;
  name: string;
  url: string;
  follow: string;
  about: string | null;
  followers: number | null;
  avatar: string | null;
  followed: boolean;
}
interface Found {
  hits: Hit[];
  failed: { site: Site; why: string }[];
}

const SITES: readonly [Site, string][] = [
  ["youtube", "YouTube"],
  ["reddit", "Reddit"],
  ["linkedin", "LinkedIn"],
  ["x", "X"],
  ["instagram", "Instagram"],
  ["tiktok", "TikTok"],
];
const NAME = Object.fromEntries(SITES) as Record<Site, string>;
const reach = <T,>(handler: string, input: Record<string, unknown>) =>
  call<T>("console/call", { service: "ReachDesk", handler, input });
const count = new Intl.NumberFormat(undefined, { notation: "compact" });

export function FindCreators() {
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<Site[]>([]);
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<Found | null>(null);
  const [following, setFollowing] = useState<Record<string, "busy" | "done">>({});

  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim() || busy) return;
    setBusy(true);
    try {
      setFound(
        await reach<Found>("findCreators", { q: q.trim(), ...(only.length ? { only } : {}) }),
      );
      setFollowing({});
    } catch (err) {
      say.failed(err);
    } finally {
      setBusy(false);
    }
  };

  const follow = async (h: Hit) => {
    setFollowing((f) => ({ ...f, [h.follow]: "busy" }));
    try {
      if (h.site === "linkedin") {
        const r = await reach<{ said: string }>("paste", { url: h.follow });
        say.done(r.said);
      } else {
        const f = await learn.follow(h.follow, "top");
        say.done(`Following ${f.name}. Its next posts land in your Inbox.`);
        changed();
      }
      setFollowing((f) => ({ ...f, [h.follow]: "done" }));
    } catch (err) {
      setFollowing(({ [h.follow]: _, ...f }) => f);
      say.failed(err);
    }
  };

  const toggle = (s: Site) =>
    setOnly((o) => (o.includes(s) ? o.filter((x) => x !== s) : [...o, s]));

  return (
    <div className="flex max-w-4xl flex-col gap-3">
      <form onSubmit={search} className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find people to follow: a name, a handle or a topic"
          aria-label="Find people to follow"
          className="min-w-0 flex-1"
        />
        <Button
          tone="primary"
          size="dense"
          type="submit"
          busy={busy}
          disabled={!q.trim()}
          className="h-9"
        >
          Search
        </Button>
      </form>
      <fieldset className="m-0 flex flex-wrap items-center gap-1.5 border-0 p-0">
        <legend className="sr-only">Sites to search</legend>
        {SITES.map(([s, label]) => (
          <Button
            key={s}
            size="dense"
            tone={only.includes(s) ? "primary" : "secondary"}
            aria-pressed={only.includes(s)}
            onClick={() => toggle(s)}
          >
            {label}
          </Button>
        ))}
        <span className="ml-1 text-[12.5px] text-(--ui-ink-2)">
          {only.length ? "Only these" : "All sites"}
        </span>
      </fieldset>
      {found ? (
        <div className="flex flex-col gap-5">
          {!found.hits.length ? (
            <p className="m-0 text-[14px] text-(--ui-ink-2)">Nothing found. Try other words.</p>
          ) : null}
          {SITES.map(([s]) => {
            const hits = found.hits.filter((h) => h.site === s);
            if (!hits.length) return null;
            return (
              <section key={s} className="flex flex-col gap-2">
                <h3 className="m-0 font-medium text-[14px]">
                  {NAME[s]}{" "}
                  <span className="font-normal text-(--ui-ink-2) tabular-nums">{hits.length}</span>
                </h3>
                <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2 p-0">
                  {hits.map((h) => (
                    <HitCard
                      key={`${h.site}:${h.handle}`}
                      h={h}
                      state={h.followed ? "done" : following[h.follow]}
                      onFollow={() => void follow(h)}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
          {found.failed.length ? (
            <ul className="m-0 list-none p-0 text-[12.5px] text-(--ui-ink-2)">
              {found.failed.map((f) => (
                <li key={f.site}>
                  {NAME[f.site]} didn't answer: {f.why}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function HitCard(props: { h: Hit; state: "busy" | "done" | undefined; onFollow: () => void }) {
  const { h } = props;
  return (
    <li className="flex gap-3 border border-(--ui-hair) bg-(--ui-paper) p-3">
      <Avatar url={h.avatar} name={h.name.replace(/^r\//, "")} size={40} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <a
            href={h.url}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 truncate font-medium text-[14px]"
            {...clipProps()}
          >
            {h.name}
          </a>
          <Button
            size="dense"
            tone={props.state === "done" ? "secondary" : "primary"}
            busy={props.state === "busy"}
            disabled={!!props.state}
            onClick={props.onFollow}
          >
            {props.state === "done" ? "Following" : "Follow"}
          </Button>
        </div>
        <span className={cx("truncate text-[12.5px] text-(--ui-ink-2)")}>
          {h.handle}
          {h.followers !== null ? ` · ${count.format(h.followers)} followers` : ""}
        </span>
        {h.about ? (
          <p className="m-0 line-clamp-2 text-[13px] text-(--ui-ink-2)">{h.about}</p>
        ) : null}
      </div>
    </li>
  );
}
