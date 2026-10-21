/**
 * Learn's Save a link box, search across every transcript, and the phone's share target
 * (/learn/add?url=).
 */
import {
  Alert,
  Button,
  Empty,
  Fieldset,
  FormKept,
  FRAME,
  LoadFailed,
  Loading,
  PageHeader,
  Rows,
  relative,
  Tag,
  TextField,
  useEditForm,
  useNarrow,
} from "@wren/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { href, navigate } from "../../route.js";
import { call, inWorkspace, keyOf } from "./api.js";

interface Saved {
  id: string;
  url: string;
  kind: string;
  fresh: boolean;
  unread: boolean;
}

export const KINDS: Record<string, string> = {
  article: "Article",
  video: "Video",
  reel: "Reel",
  episode: "Episode",
};

const savedLine = (s: Saved) =>
  `${s.fresh ? "Saved" : "Already saved"}. ${KINDS[s.kind] ?? "Item"}${
    s.unread
      ? s.kind === "video" || s.kind === "reel"
        ? ", read soon."
        : ", reading now."
      : ", already read."
  }`;

/** The Save a link box above Saved: paste a link, it's kept and read. */
export function SaveBox({ reload }: { reload?: () => void }) {
  // A link pasted and not saved yet stays put: another page and back gives it again.
  const form = useEditForm({ key: "learn:save-link", defaults: { url: "" } });
  const flying = useRef(false);
  const [said, setSaid] = useState<{ ok: boolean; line: string } | null>(null);
  const submit = form.onSend(
    async (v) => {
      if (!v.url.trim() || flying.current) return false;
      flying.current = true;
      setSaid(null);
      try {
        const s = await call<Saved>("learn/save", { url: v.url.trim() });
        setSaid({ ok: true, line: savedLine(s) });
        reload?.();
      } catch (err) {
        setSaid({ ok: false, line: err instanceof Error ? err.message : String(err) });
        return false;
      } finally {
        flying.current = false;
      }
    },
    { clear: true },
  );
  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="flex w-full min-w-0 flex-1 basis-full flex-col gap-1.5 sm:max-w-xl"
    >
      <div className="flex min-w-0 gap-2">
        <TextField
          form={form}
          name="url"
          type="url"
          box="min-w-0 flex-1"
          placeholder="Paste a link"
          aria-label="Save a link"
        />
        <Button
          tone="primary"
          size="dense"
          type="submit"
          busy={form.formState.isSubmitting}
          disabled={!form.watch("url").trim()}
        >
          Save
        </Button>
      </div>
      <FormKept form={form} what="link" />
      {said ? (
        <span className={`text-[13px] ${said.ok ? "text-(--ui-ink-2)" : "text-(--ui-bad)"}`}>
          {said.line}
        </span>
      ) : null}
    </form>
  );
}

/** The phone's share target: the Shortcut opens /learn/add?url=…, this saves it once. */
export function AddPage({ params, client }: PageProps) {
  inWorkspace(client);
  const url = params.get("url") ?? params.get("text") ?? "";
  const [state, setState] = useState<{ saved?: Saved; error?: string } | null>(null);
  const sent = useRef(false);
  // read-ok: a write (saves the shared link), once on arrival.
  useEffect(() => {
    if (!url || sent.current) return;
    sent.current = true;
    call<Saved>("learn/save", { url, via: "shortcut" })
      .then((saved) => setState({ saved }))
      .catch((err: unknown) =>
        setState({ error: err instanceof Error ? err.message : String(err) }),
      );
  }, [url]);
  return (
    <>
      <PageHeader title="Save a link" />
      {!url ? (
        <Fieldset
          legend="Link"
          note="An article, video, reel or episode. It's kept, then read."
          className="max-w-2xl"
        >
          <SaveBox />
        </Fieldset>
      ) : !state ? (
        <Loading lines={2} />
      ) : state.error ? (
        <Alert>{state.error}</Alert>
      ) : state.saved ? (
        <div className={`flex max-w-2xl flex-col gap-3 p-4 ${FRAME}`}>
          <p className="text-[15px] text-(--ui-ink)">{savedLine(state.saved)}</p>
          <p className="break-all text-[13px] text-(--ui-ink-2)">{state.saved.url}</p>
          <div className="flex gap-3 text-[13px]">
            <a href={`/learn/items/${state.saved.id}?in=saved`}>Open it</a>
            <a href="/learn/items?in=saved">All saved</a>
          </div>
        </div>
      ) : null}
    </>
  );
}

interface Hit {
  id: number;
  title: string;
  url: string;
  kind: string;
  source: string;
  score: number | null;
  at: string;
  snippet: string;
}

/** The snippet's «marks» as highlights. */
function Snippet({ text }: { text: string }): ReactNode {
  return text.split(/(«[^»]*»)/).map((part, i) =>
    part.startsWith("«") ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: parts of one fixed string.
      <mark key={i} className="rounded-sm bg-(--ui-accent-wash) px-0.5 text-(--ui-ink)">
        {part.slice(1, -1)}
      </mark>
    ) : (
      part
    ),
  );
}

/** The hits: a row each, the matching words under the title. */
function HitRows({ hits }: { hits: Hit[] }) {
  const narrow = useNarrow();
  return (
    <Rows<Hit>
      label="search hits"
      noun="hit"
      narrow={narrow}
      scroller="window"
      lines={hits.map((row, index) => ({ kind: "row", key: String(row.id), index, row }))}
      name={{
        label: "Item",
        icon: "text",
        title: (h) => h.title,
        href: (h) => `/learn/items/${h.id}`,
        sub: (h) => (
          <span className="line-clamp-2 text-[12.5px] leading-snug text-(--ui-ink-2)">
            <Snippet text={h.snippet} />
          </span>
        ),
      }}
      columns={[
        {
          key: "kind",
          label: "Kind",
          icon: "tag",
          width: 110,
          cell: (h) => <Tag tone="neutral">{KINDS[h.kind] ?? h.kind}</Tag>,
        },
        { key: "source", label: "Source", icon: "link", cell: (h) => h.source },
        {
          key: "score",
          label: "Score",
          icon: "gauge",
          width: 90,
          phone: true,
          cell: (h) => (h.score !== null ? `${h.score}/10` : null),
        },
        {
          key: "at",
          label: "Found",
          icon: "clock",
          width: 130,
          quiet: true,
          cell: (h) => relative(new Date(h.at)),
        },
      ]}
      open={{ id: null, onOpen: (h) => navigate(`/learn/items/${h.id}`) }}
    />
  );
}

/** Search across every transcript, summary and title. */
export function SearchPage({ params, client }: PageProps) {
  inWorkspace(client);
  return <SearchBody params={params} />;
}

function SearchBody({ params }: { params: URLSearchParams }) {
  const [start] = useState(() => ({ q: params.get("q") ?? "" }));
  const form = useEditForm({ key: null, defaults: start });
  const q = form.watch("q");
  const [asked, setAsked] = useState(start.q);
  const hits = useCall(keyOf(`learn.search:${asked}`), () =>
    asked.trim()
      ? call<{ hits: Hit[] }>("learn/search", { q: asked })
      : Promise.resolve({ hits: [] }),
  );
  const submit = form.onSend((v) => {
    setAsked(v.q.trim());
    navigate(
      href(location.pathname, { q: v.q.trim() }, new URLSearchParams(location.search)),
      true,
    );
  });
  return (
    <>
      <PageHeader
        title="Search"
        lede={'Every transcript, word for word. Use "a phrase" or -word to leave one out.'}
      />
      <form onSubmit={(e) => void submit(e)} className="mb-6 flex max-w-xl gap-2">
        <TextField
          form={form}
          name="q"
          type="search"
          placeholder="warmup schedule"
          aria-label="Search transcripts"
        />
        <Button tone="primary" size="dense" type="submit" disabled={!q.trim()}>
          Search
        </Button>
      </form>
      {!asked ? (
        <Empty>Search finds words in anything saved or followed.</Empty>
      ) : hits.error && !hits.data ? (
        <LoadFailed error={hits.error} onRetry={hits.retry} />
      ) : !hits.data ? (
        <Loading shape="rows" lines={4} />
      ) : !hits.data.hits.length ? (
        <Empty>Nothing says that.</Empty>
      ) : (
        <HitRows hits={hits.data.hits} />
      )}
    </>
  );
}
