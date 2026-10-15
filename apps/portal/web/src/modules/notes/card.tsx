/**
 * A card is a note (designs/2026-10-14-boards.md): this is what the doc page adds for one. The
 * task strip above the title (column, owner, due, board, what it waits on and holds up) and the
 * Timeline beside Comments and History. Also the owner's mark, shared with the Board.
 */
import { isAgent, ownerName } from "@wren/notes/types";
import { Icon, relative, say } from "@wren/ui";
import { useCallback, useEffect, useState } from "react";
import { useCall } from "../../load.js";
import {
  type Card,
  type CardMoves,
  type CardOpen,
  docPath,
  hueOf,
  type NotePeople,
  notes,
} from "./api.js";

export const SELECT =
  "min-h-[32px] max-w-full border border-(--ui-hair) bg-(--ui-paper) px-2 py-1 text-[13px] text-(--ui-ink) focus:border-(--ui-focus) focus:outline-none disabled:bg-(--ui-wash) disabled:text-(--ui-ink-2)";

/** Who owns a card: their initial in their hue, the wren mark for an agent, an empty ring for nobody. */
export function Avatar({ who, size = 22 }: { who: string | null; size?: number }) {
  if (!who)
    return (
      <span
        role="img"
        aria-label="No owner"
        className="inline-block flex-none rounded-full border border-dashed border-(--ui-ink-3)"
        style={{ width: size, height: size }}
      />
    );
  if (isAgent(who))
    return (
      <img
        src="/wren-icon.png"
        alt={ownerName(who)}
        title={ownerName(who)}
        width={size}
        height={size}
        className="flex-none rounded-full"
      />
    );
  return (
    <span
      role="img"
      aria-label={who}
      title={who}
      className="inline-flex flex-none items-center justify-center rounded-full text-[11px] font-semibold text-(--ui-paper) uppercase"
      style={{ width: size, height: size, background: hueOf(who) }}
    >
      {who[0]}
    </span>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

/** A due day is late once it is before today and the card is open. */
export const isLate = (c: { due: string | null; closed: boolean }) =>
  !c.closed && !!c.due && c.due < today();

/** The strip above a card's title. `changed` runs after any edit, so the Timeline reads again. */
export function CardStrip({
  client,
  id,
  me,
  people,
  changed,
}: {
  client: string;
  id: string;
  me: string;
  people: () => Promise<NotePeople | null>;
  changed: () => void;
}) {
  const got = useCall(`notes:task:${client}:${id}`, () => notes(client, "task", { id }));
  const [team, setTeam] = useState<NotePeople["people"]>([]);
  const [mates, setMates] = useState<Card[]>([]);
  const t = got.data;
  useEffect(() => void people().then((p) => setTeam(p?.people ?? [])), [people]);
  const boardId = t?.board.id;
  useEffect(() => {
    if (boardId)
      void notes(client, "board", { id: boardId })
        .then((b) => setMates(b.cards))
        .catch(() => {});
  }, [client, boardId]);
  if (!t) return null;

  const done = async <T,>(run: () => Promise<T>) => {
    try {
      const out = await run();
      got.retry();
      changed();
      return out;
    } catch (err) {
      say.failed(err);
      got.retry();
      return null;
    }
  };
  const move = (column: string) =>
    done(() => notes(client, "taskMove", { id, column })).then((out) => {
      if (out?.redirected) say.done(`A person owns this card, so it went to ${out.redirected}.`);
    });
  const edit = (body: Record<string, unknown>) =>
    done(() => notes(client, "taskEdit", { id, ...body }));
  const block = (blockedBy: string, on: boolean, whose = id) =>
    done(() => notes(client, "taskBlock", { id: whose, blockedBy, on }));

  const w = t.canEdit;
  const owners = [...new Set([t.assignee, ...team.map((p) => p.email), "agent:claude"])].filter(
    (x): x is string => !!x,
  );
  const column = t.board.columns.find((c) => c.id === t.columnId);
  const waits = new Set([...t.blockedBy, ...t.blocking].map((r) => r.id));
  const options = mates.filter((c) => c.id !== id && !c.closed && !waits.has(c.id));

  return (
    <section
      aria-label="Card"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-(--ui-hair) bg-(--ui-wash) px-4 py-2 text-[13px] print:hidden"
    >
      <label className="flex items-center gap-1.5">
        <span className="text-(--ui-ink-2)">Column</span>
        <select
          aria-label="Column"
          className={SELECT}
          disabled={!w}
          value={t.columnId}
          onChange={(e) => void move(e.target.value)}
        >
          {t.board.columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5">
        <Avatar who={t.assignee} />
        <select
          aria-label="Owner"
          className={SELECT}
          disabled={!w}
          value={t.assignee ?? ""}
          onChange={(e) => void edit({ assignee: e.target.value || null })}
        >
          <option value="">No owner</option>
          {owners.map((o) => (
            <option key={o} value={o}>
              {o === me ? `${o} (you)` : ownerName(o)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5">
        <span className="text-(--ui-ink-2)">Due</span>
        <input
          type="date"
          aria-label="Due"
          disabled={!w}
          value={t.due ?? ""}
          onChange={(e) => void edit({ due: e.target.value || null })}
          className={`${SELECT} ${isLate(t) ? "text-(--ui-bad)" : ""}`}
        />
      </label>
      {t.boards.length > 1 ? (
        <label className="flex items-center gap-1.5">
          <span className="text-(--ui-ink-2)">Board</span>
          <select
            aria-label="Board"
            className={SELECT}
            disabled={!w}
            value={t.board.id}
            onChange={(e) => void edit({ board: e.target.value })}
          >
            {t.boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <span className="text-(--ui-ink-2)">
          <Icon name="board" className="mr-1 inline align-[-2px]" />
          <a href="/notes/board" className="text-(--ui-ink-2)">
            {t.board.name}
          </a>
          {column ? ` · ${column.name}` : ""}
        </span>
      )}
      <Links
        label="Blocked by"
        refs={t.blockedBy}
        options={options}
        writable={w}
        add={(other) => block(other, true)}
        drop={(other) => block(other, false)}
      />
      <Links
        label="Blocks"
        refs={t.blocking}
        options={options}
        writable={w}
        add={(other) => block(id, true, other)}
        drop={(other) => block(id, false, other)}
      />
    </section>
  );
}

/** One of the strip's lists of cards: links with a remove, and a picker to add. */
function Links({
  label,
  refs,
  options,
  writable,
  add,
  drop,
}: {
  label: string;
  refs: CardOpen["blockedBy"];
  options: Card[];
  writable: boolean;
  add: (id: string) => unknown;
  drop: (id: string) => unknown;
}) {
  if (!refs.length && !(writable && options.length)) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-(--ui-ink-2)">{label}</span>
      {refs.map((r) => (
        <span
          key={r.id}
          className="inline-flex items-center gap-1 border border-(--ui-hair) bg-(--ui-paper) px-1.5 py-0.5"
        >
          <a
            href={docPath(r.id)}
            className={r.open ? "text-(--ui-ink)" : "text-(--ui-ink-3) line-through"}
          >
            {r.name}
          </a>
          {r.column ? <span className="text-[12px] text-(--ui-ink-3)">{r.column}</span> : null}
          {writable ? (
            <button
              type="button"
              aria-label={`Remove ${r.name}`}
              onClick={() => void drop(r.id)}
              className="inline-flex border-0 bg-transparent p-0 text-(--ui-ink-3) hover:text-(--ui-ink)"
            >
              <Icon name="close" size={12} />
            </button>
          ) : null}
        </span>
      ))}
      {writable && options.length ? (
        <select
          aria-label={`Add to ${label}`}
          className={SELECT}
          value=""
          onChange={(e) => e.target.value && void add(e.target.value)}
        >
          <option value="">Add…</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}

/** The Timeline: every move, give, close and reopen, newest first. Beside Comments and History. */
export function TimelinePanel({
  client,
  id,
  tick,
  onClose,
}: {
  client: string;
  id: string;
  tick: number;
  onClose: () => void;
}) {
  const [moves, setMoves] = useState<CardMoves | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const read = useCallback(
    () =>
      notes(client, "taskMoves", { id })
        .then((r) => {
          setMoves(r.moves);
          setFailed(null);
        })
        .catch((e: Error) => setFailed(e.message)),
    [client, id],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: an edit bumps `tick`, and the list reads again.
  useEffect(() => void read(), [read, tick]);
  return (
    <aside
      aria-label="Timeline"
      className="flex min-h-0 w-full flex-col border-(--ui-hair) bg-(--ui-tile) max-lg:order-first max-lg:border-b lg:w-80 lg:flex-none lg:border-l print:hidden"
    >
      <div className="flex h-10 items-center justify-between border-b border-(--ui-hair) bg-(--ui-paper) pr-1 pl-3">
        <h2 className="m-0 text-[13px] font-semibold">Timeline</h2>
        <button
          type="button"
          aria-label="Close timeline"
          onClick={onClose}
          className="inline-flex size-8 items-center justify-center border-0 bg-transparent text-(--ui-ink-2) hover:bg-(--ui-hover)"
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="overflow-y-auto p-3 max-lg:max-h-96 lg:max-h-[calc(100dvh-180px)]">
        {failed ? (
          <p className="m-0 text-[13px] text-(--ui-bad)">{failed}</p>
        ) : !moves ? (
          <p className="m-0 text-[13px] text-(--ui-ink-2)">Loading…</p>
        ) : !moves.length ? (
          <p className="m-0 text-[13px] text-(--ui-ink-2)">Nothing yet.</p>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {moves.map((m) => (
              <li key={m.id} className="flex items-start gap-2 text-[13px]">
                <Avatar who={m.by} size={20} />
                <span className="min-w-0">
                  <span className="font-medium">{m.who}</span> {m.words}
                  <span className="block text-[12px] text-(--ui-ink-2)">
                    {relative(new Date(m.at))}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}
