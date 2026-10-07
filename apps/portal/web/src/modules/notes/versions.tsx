/**
 * A note's history, as Docs keeps it: one version per person's sitting, newest first, each with
 * who and how much. Open one to read it, name it, restore it (a new version; nothing is lost), or
 * compare any two with each change colored by its author.
 */
import { Alert, Button, Icon, Input, Loading, say, Tag } from "@wren/ui";
import { useState } from "react";
import { useCall } from "../../load.js";
import { hueOf, type NoteCompare, type NoteVersions, notes } from "./api.js";
import { NoteView } from "./editor.js";

type Version = NoteVersions[number];

const when = (at: string) =>
  new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function Dot({ email }: { email: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-2.5 flex-none rounded-full"
      style={{ background: hueOf(email) }}
    />
  );
}

/** Who, with their color. */
export function Authors({ list }: { list: readonly string[] }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
      {list.map((a) => (
        <span key={a} className="flex min-w-0 items-center gap-1">
          <Dot email={a} />
          <span className="truncate">{a.startsWith("agent:") ? "Claude" : a}</span>
        </span>
      ))}
    </span>
  );
}

/** The timeline beside the doc. */
export function Timeline({
  list,
  open,
  onOpen,
}: {
  list: NoteVersions;
  open: number | null;
  onOpen: (n: number | null) => void;
}) {
  return (
    <ol className="m-0 flex list-none flex-col p-0">
      {list.map((v, i) => (
        <li key={v.number}>
          <button
            type="button"
            aria-current={open === v.number || (open === null && i === 0) ? "true" : undefined}
            onClick={() => onOpen(i === 0 ? null : v.number)}
            className="flex w-full flex-col gap-1 border-0 border-b border-(--ui-hair) bg-transparent px-3 py-2.5 text-left text-[13px] text-(--ui-ink) hover:bg-(--ui-hover) aria-[current=true]:bg-(--ui-accent-wash)"
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className={v.name ? "font-semibold" : "font-medium"}>
                {v.name ?? when(v.at)}
              </span>
              <span className="flex-none text-[12px] text-(--ui-ink-2)">v{v.number}</span>
            </span>
            {v.name ? <span className="text-[12px] text-(--ui-ink-2)">{when(v.at)}</span> : null}
            {i === 0 ? (
              <span className="text-[12px] text-(--ui-ink-2)">Current version</span>
            ) : null}
            <span className="text-[12.5px] text-(--ui-ink-2)">
              <Authors list={v.authors} />
            </span>
            <span className="flex flex-wrap items-center gap-2 text-[12px] text-(--ui-ink-2)">
              {v.added ? <span className="text-(--ui-good-ink)">+{v.added}</span> : null}
              {v.removed ? <span className="text-(--ui-bad)">−{v.removed}</span> : null}
              {v.kind === "restore" ? (
                <Tag tone="accent">Restored v{v.restoredFrom}</Tag>
              ) : v.kind === "import" ? (
                <Tag>Imported</Tag>
              ) : null}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** One version open in place of the doc: read it, name it, restore it, compare it. */
export function VersionOpen({
  client,
  id,
  number,
  list,
  canEdit,
  onBack,
  onRestored,
  onNamed,
}: {
  client: string;
  id: string;
  number: number;
  list: NoteVersions;
  canEdit: boolean;
  onBack: () => void;
  onRestored: () => void;
  onNamed: () => void;
}) {
  const current = list[0]?.number ?? number;
  const v = list.find((x) => x.number === number) as Version | undefined;
  const [against, setAgainst] = useState<number | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(v?.name ?? "");
  const [busy, setBusy] = useState(false);
  const one = useCall(`notes:version:${client}:${id}:${number}`, () =>
    notes(client, "version", { id, number }),
  );
  const restore = () => {
    setBusy(true);
    notes(client, "restore", { id, number })
      .then((r) => {
        say.done(`Restored as v${r.version}.`);
        onRestored();
      })
      .catch(say.failed)
      .finally(() => setBusy(false));
  };
  const saveName = () =>
    notes(client, "nameVersion", { id, number, name: name.trim() || null })
      .then(() => {
        setNaming(false);
        onNamed();
      })
      .catch(say.failed);
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-(--ui-hair) bg-(--ui-tile) px-3 py-2 text-[13px] print:hidden">
        <Button tone="quiet" size="dense" icon="left" onClick={onBack}>
          Back to current
        </Button>
        <span className="font-medium">
          v{number}
          {v?.name ? `, ${v.name}` : ""}
        </span>
        <span className="text-(--ui-ink-2)">{v ? when(v.at) : ""}</span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-(--ui-ink-2)">
            Compare with
            <select
              value={against ?? ""}
              onChange={(e) => setAgainst(e.target.value ? Number(e.target.value) : null)}
              className="h-8 border border-(--ui-hair) bg-(--ui-paper) px-1.5 text-[13px] text-(--ui-ink)"
            >
              <option value="">Nothing</option>
              {list
                .filter((x) => x.number !== number)
                .map((x) => (
                  <option key={x.number} value={x.number}>
                    v{x.number}
                    {x.number === current ? " (current)" : x.name ? ` ${x.name}` : ""}
                  </option>
                ))}
            </select>
          </label>
          {canEdit ? (
            <Button tone="secondary" size="dense" onClick={() => setNaming(!naming)}>
              {v?.name ? "Rename" : "Name this version"}
            </Button>
          ) : null}
          {canEdit && number !== current ? (
            <Button size="dense" busy={busy} onClick={restore}>
              Restore this version
            </Button>
          ) : null}
        </span>
      </div>
      {naming ? (
        <form
          className="flex items-center gap-2 border-b border-(--ui-hair) px-3 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            void saveName();
          }}
        >
          <Input
            value={name}
            autoFocus
            maxLength={200}
            aria-label="Version name"
            placeholder="Sent to Ana"
            className="h-8 w-64 rounded-none"
            onChange={(e) => setName(e.target.value)}
          />
          <Button size="dense" type="submit">
            Save
          </Button>
        </form>
      ) : null}
      {against !== null ? (
        <Compare client={client} id={id} a={against} b={number} />
      ) : one.error && !one.data ? (
        <Alert onRetry={one.retry}>{one.error.message}</Alert>
      ) : !one.data ? (
        <Loading lines={8} />
      ) : (
        <div className="note-paper">
          {one.data.title ? <h1 className="note-title-static">{one.data.title}</h1> : null}
          <NoteView client={client} id={id} json={one.data.body as never} />
        </div>
      )}
    </div>
  );
}

/** Two versions word by word: added in its author's color, removed struck through. */
function Compare({ client, id, a, b }: { client: string; id: string; a: number; b: number }) {
  const got = useCall(`notes:compare:${client}:${id}:${a}:${b}`, () =>
    notes(client, "compare", { id, from: a, to: b }),
  );
  if (got.error && !got.data) return <Alert onRetry={got.retry}>{got.error.message}</Alert>;
  if (!got.data) return <Loading lines={8} />;
  const c: NoteCompare = got.data;
  const authorOf = (by: number | null) => (by === null ? null : (c.authors[by]?.[0] ?? null));
  const everyone = [
    ...new Set(c.pieces.flatMap((p) => (p.op === "same" ? [] : [authorOf(p.by)]))),
  ].filter((x): x is string => !!x);
  return (
    <div className="note-paper">
      <p className="m-0 mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-(--ui-ink-2)">
        <span>
          v{c.from} to v{c.to}: <span className="text-(--ui-good-ink)">+{c.added}</span>{" "}
          <span className="text-(--ui-bad)">−{c.removed}</span> words
        </span>
        <Authors list={everyone} />
      </p>
      {!c.added && !c.removed ? (
        <p className="m-0 text-[14px] text-(--ui-ink-2)">No change in the words.</p>
      ) : (
        <div className="whitespace-pre-wrap break-words text-[15px]/[1.65] text-(--ui-ink)">
          {c.pieces.map((p, i) => {
            const who = authorOf(p.by);
            const by = who ? `v${p.by}, ${who}` : undefined;
            return p.op === "same" ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: pieces have no id and never move.
              <span key={i}>{p.text}</span>
            ) : p.op === "ins" ? (
              <ins
                // biome-ignore lint/suspicious/noArrayIndexKey: as above.
                key={i}
                title={`Added in ${by}`}
                className="no-underline"
                style={{
                  background: `color-mix(in srgb, ${who ? hueOf(who) : "var(--ui-accent)"} 26%, transparent)`,
                }}
              >
                {p.text}
              </ins>
            ) : (
              <del
                // biome-ignore lint/suspicious/noArrayIndexKey: as above.
                key={i}
                title={`Removed in ${by}`}
                className="text-(--ui-ink-2) decoration-(--ui-bad)"
              >
                {p.text}
              </del>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The panel: its list, kept fresh by the doc page. */
export function VersionsPanel({
  list,
  error,
  open,
  onOpen,
  onClose,
}: {
  list: NoteVersions | null;
  error: string | null;
  open: number | null;
  onOpen: (n: number | null) => void;
  onClose: () => void;
}) {
  return (
    <aside
      aria-label="Version history"
      className="flex min-h-0 w-full flex-col border-(--ui-hair) bg-(--ui-paper) max-lg:border-t lg:w-80 lg:flex-none lg:border-l print:hidden"
    >
      <div className="flex h-10 items-center justify-between border-b border-(--ui-hair) pr-1 pl-3">
        <h2 className="m-0 text-[13px] font-semibold">Version history</h2>
        <button
          type="button"
          aria-label="Close history"
          onClick={onClose}
          className="inline-flex size-8 items-center justify-center border-0 bg-transparent text-(--ui-ink-2) hover:bg-(--ui-hover)"
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="min-h-0 overflow-y-auto lg:max-h-[calc(100dvh-180px)]">
        {error && !list ? (
          <p className="m-3 text-[13px] text-(--ui-bad)">{error}</p>
        ) : !list ? (
          <Loading lines={6} />
        ) : (
          <Timeline list={list} open={open} onOpen={onOpen} />
        )}
      </div>
      <p className="m-0 border-t border-(--ui-hair) px-3 py-2 text-[12px] text-(--ui-ink-2)">
        A version is one person's sitting. Restoring adds a new version, so nothing is lost.
      </p>
    </aside>
  );
}
