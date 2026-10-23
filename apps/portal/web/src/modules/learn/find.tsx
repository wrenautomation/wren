/**
 * Find someone to follow by name or topic, on YouTube, Reddit, LinkedIn, X, Instagram and TikTok
 * at once (`ReachDesk.findCreators`): no address needed. Follow puts a feed in Learn's sources;
 * a LinkedIn page or person joins the comments' follows instead (`ReachDesk.paste`), read first
 * each day. Wren's own workspace only: the search reads as Wren's accounts.
 */
import { Button, Rows, type RowsLine, say, TextField, useEditForm, useNarrow } from "@wren/ui";
import { useRef, useState } from "react";
import { call } from "../../api.js";
import { useFolds } from "../../use-folds.js";
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

/** The hits by site: a fold for each site that answered, its people under it. */
function linesOf(hits: Hit[]): RowsLine<Hit>[] {
  const out: RowsLine<Hit>[] = [];
  for (const [s, label] of SITES) {
    const here = hits.filter((h) => h.site === s);
    if (!here.length) continue;
    out.push({ kind: "group", key: s, label });
    for (const h of here)
      out.push({ kind: "row", key: `${h.site}:${h.handle}`, index: out.length, row: h });
  }
  return out;
}

export function FindCreators() {
  const form = useEditForm({ key: null, defaults: { q: "", only: [] as Site[] } });
  const only = form.watch("only");
  const [found, setFound] = useState<Found | null>(null);
  /**
   * Follows pressed this visit, by address: they outlive a new search, so a follow still out (or
   * one a search read before it landed) never shows Follow again.
   */
  const [following, setFollowing] = useState<Record<string, "busy" | "done">>({});
  const pressed = useRef(new Set<string>());
  const searching = useRef(false);
  const narrow = useNarrow();
  const folds = useFolds();

  const search = form.onSend(async (v) => {
    if (!v.q.trim() || searching.current) return false;
    searching.current = true;
    try {
      setFound(
        await reach<Found>("findCreators", {
          q: v.q.trim(),
          ...(v.only.length ? { only: v.only } : {}),
        }),
      );
    } catch (err) {
      say.failed(err);
      return false;
    } finally {
      searching.current = false;
    }
  });

  const follow = async (h: Hit) => {
    // Once per press: a second click while it's out, or after it worked, does nothing.
    if (pressed.current.has(h.follow)) return;
    pressed.current.add(h.follow);
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
      pressed.current.delete(h.follow);
      setFollowing(({ [h.follow]: _, ...f }) => f);
      say.failed(err);
    }
  };

  const toggle = (s: Site) =>
    form.setValue("only", only.includes(s) ? only.filter((x) => x !== s) : [...only, s]);

  return (
    <div className="flex max-w-4xl flex-col gap-3">
      <form onSubmit={(e) => void search(e)} className="flex flex-col gap-2 sm:flex-row">
        <TextField
          form={form}
          name="q"
          placeholder="Find people to follow: a name, a handle or a topic"
          aria-label="Find people to follow"
          box="min-w-0 flex-1"
        />
        <Button
          tone="primary"
          size="dense"
          type="submit"
          busy={form.formState.isSubmitting}
          disabled={!form.watch("q").trim()}
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
          ) : (
            <Rows<Hit>
              label="people to follow"
              noun="person"
              narrow={narrow}
              scroller="window"
              lines={linesOf(found.hits)}
              group={folds}
              name={{
                label: "Name",
                icon: "user",
                title: (h) => h.name,
                mark: (h) => <Avatar url={h.avatar} name={h.name.replace(/^r\//, "")} size={24} />,
                // A phone has no About column: the handle goes under the name.
                sub: narrow
                  ? (h) => (
                      <span className="wrap-anywhere whitespace-normal text-[12.5px] text-(--ui-ink-3)">
                        {h.handle}
                      </span>
                    )
                  : undefined,
              }}
              columns={[
                {
                  key: "handle",
                  label: "Profile",
                  icon: "link",
                  cell: (h) => (
                    <a href={h.url} target="_blank" rel="noreferrer">
                      {h.handle}
                    </a>
                  ),
                },
                {
                  key: "followers",
                  label: "Followers",
                  icon: "hash",
                  align: "end",
                  width: 110,
                  cell: (h) => (h.followers !== null ? count.format(h.followers) : null),
                },
                {
                  key: "about",
                  label: "About",
                  icon: "text",
                  min: 220,
                  cell: (h) => h.about,
                },
                {
                  key: "follow",
                  label: "Follow",
                  icon: "selected",
                  width: 130,
                  phone: true,
                  cell: (h) => {
                    const state = h.followed ? "done" : following[h.follow];
                    return (
                      <Button
                        size="dense"
                        tone={state === "done" ? "secondary" : "primary"}
                        busy={state === "busy"}
                        disabled={!!state}
                        aria-label={`${state === "done" ? "Following" : "Follow"} ${h.name}`}
                        onClick={() => void follow(h)}
                      >
                        {state === "done" ? "Following" : "Follow"}
                      </Button>
                    );
                  },
                },
              ]}
            />
          )}
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
