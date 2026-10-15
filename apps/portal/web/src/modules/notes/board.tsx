/**
 * Notes → Board (designs/2026-10-14-boards.md): a column per stage, a card per task. A card is a
 * note, so it opens as the note's page. Drag a card to move or reorder it, or pick its column on a
 * phone; each move is kept in the card's Timeline by the server. The List toggle shows the same
 * cards as a record list, with saved views and CSV export.
 */
import { ownerName } from "@wren/notes/types";
import {
  Button,
  clipProps,
  cx,
  Empty,
  Icon,
  Input,
  LoadFailed,
  Loading,
  num,
  PageHeader,
  say,
  Tag,
} from "@wren/ui";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useCall } from "../../load.js";
import { type ListPage, type PageProps, WREN } from "../../module.js";
import { TemplatePage } from "../../records.js";
import { href, navigate } from "../../route.js";
import { type BoardInfo, type Card, docPath, notes } from "./api.js";
import { exportBoard, ImportDialog } from "./board-file.js";
import { BoardDialog, NewBoard } from "./board-settings.js";
import { Avatar, isLate, SELECT } from "./card.js";

type Column = BoardInfo["columns"][number];

/** A card moved but not yet re-read: its column, and what it sits before or after. */
type Moved = Record<string, { columnId: string; before: string | null; after: string | null }>;

/** The page as a list of cards (Notes → Board → List): the `notes.task` record. */
const LIST: ListPage = {
  id: "board",
  label: "Cards",
  template: "list",
  record: "notes.task",
  columns: ["title", "column", "owner", "due", "state"],
  empty: "No cards yet.",
};

/** The Board tab's number: cards that wait on you (due, or held up by yours). */
export const waitingCards = (client: string) => notes(client, "needsYou").then((r) => r.n);

export function BoardPage(props: PageProps) {
  const id = location.pathname.split("/")[3];
  // A row of the List opens as its record page, with a link on to the card's note.
  if (id)
    return (
      <TemplatePage
        {...props}
        app="Notes"
        page={{
          ...LIST,
          extras: (_d, { row }) => ({
            lead: (
              <a href={docPath(String(row.id))} className="text-[13.5px]">
                Open the card
              </a>
            ),
          }),
        }}
        path="/notes/board"
        id={id}
      />
    );
  return <Boards {...props} />;
}

function Boards(props: PageProps) {
  const { client, params } = props;
  const list = useCall(`notes:boards:${client}`, () => notes(client, "boards"));
  const [making, setMaking] = useState(false);
  if (list.error && !list.data) return <LoadFailed error={list.error} onRetry={list.retry} />;
  if (!list.data) return <Loading lines={6} />;
  const { boards, canWrite } = list.data;
  const want = params.get("b");
  const board = boards.find((b) => b.id === want) ?? boards.find((b) => b.isDefault) ?? boards[0];
  const switchTo = (id: string) =>
    navigate(href("/notes/board", { b: id, show: params.get("show") }));
  return (
    <>
      {board ? (
        <BoardView
          key={board.id}
          {...props}
          board={board}
          boards={boards}
          canWrite={canWrite && !props.demo}
          switchTo={switchTo}
          reloadBoards={list.retry}
          newBoard={() => setMaking(true)}
        />
      ) : (
        <>
          <PageHeader
            title="Board"
            lede="Cards in columns. Drag a card to the column it's in now."
          />
          <Empty
            action={
              canWrite && !props.demo ? (
                <Button size="dense" tone="primary" onClick={() => setMaking(true)}>
                  New board
                </Button>
              ) : undefined
            }
          >
            No board is shared with you yet.
          </Empty>
        </>
      )}
      <NewBoard
        client={client}
        open={making}
        onOpenChange={setMaking}
        onMade={(id) => {
          list.retry();
          switchTo(id);
        }}
      />
    </>
  );
}

function BoardView({
  client,
  demo,
  params,
  board,
  boards,
  canWrite,
  switchTo,
  reloadBoards,
  newBoard,
  ...props
}: PageProps & {
  board: BoardInfo;
  boards: BoardInfo[];
  canWrite: boolean;
  switchTo: (id: string) => void;
  reloadBoards: () => void;
  newBoard: () => void;
}) {
  const got = useCall(`notes:board:${client}:${board.id}`, () =>
    notes(client, "board", { id: board.id }),
  );
  const [moved, setMoved] = useState<Moved>({});
  // The next read replaces what a move showed at once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a fresh read clears it.
  useEffect(() => setMoved({}), [got.data]);
  const [owner, setOwner] = useState("");
  const [about, setAbout] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [settings, setSettings] = useState(false);
  const [importing, setImporting] = useState(false);
  const asList = params.get("show") === "list";

  if (got.error && !got.data) return <LoadFailed error={got.error} onRetry={got.retry} />;
  if (!got.data) return <Loading lines={6} />;
  const data = got.data;
  const write = canWrite && data.canWrite;
  const columns = data.board.columns;

  const move = async (
    id: string,
    columnId: string,
    at: { before?: string; after?: string } = {},
  ) => {
    if (id === at.before || id === at.after) return;
    setMoved((m) => ({
      ...m,
      [id]: { columnId, before: at.before ?? null, after: at.after ?? null },
    }));
    try {
      const out = await notes(client, "taskMove", { id, column: columnId, ...at });
      if (out.redirected)
        say.done(`A person owns that card, so it went to ${out.redirected} instead of closing.`);
      got.retry();
    } catch (err) {
      setMoved((m) => {
        const { [id]: _, ...rest } = m;
        return rest;
      });
      say.failed(err);
    }
  };

  const people = [...new Set(data.cards.map((c) => c.assignee).filter((x): x is string => !!x))];
  const chips = new Map(data.cards.flatMap((c) => c.clients.map((x) => [x.id, x.name] as const)));
  const keep = (c: Card) =>
    (!owner ||
      (owner === "me"
        ? c.assignee === data.me
        : owner === "none"
          ? !c.assignee
          : c.assignee === owner)) &&
    (!about || c.clients.some((x) => x.id === about)) &&
    (!blocked || (c.blocked > 0 && !c.closed));
  const shown = data.cards.filter(keep);
  const filtering = !!(owner || about || blocked);

  return (
    <>
      <PageHeader
        title="Board"
        lede="Drag a card to the column it's in now. Open a card to discuss it."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Board"
              className={SELECT}
              value={board.id}
              onChange={(e) => switchTo(e.target.value)}
            >
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.home !== board.home ? " (shared)" : ""}
                </option>
              ))}
            </select>
            {canWrite ? (
              <Button tone="secondary" size="sm" icon="board" onClick={newBoard}>
                New board
              </Button>
            ) : null}
            {write ? (
              <Button tone="secondary" size="sm" icon="sliders" onClick={() => setSettings(true)}>
                Board settings
              </Button>
            ) : null}
            <Button
              tone="secondary"
              size="sm"
              icon="download"
              onClick={() => void exportBoard(client, board.id)}
            >
              Export CSV
            </Button>
            {write ? (
              <Button tone="secondary" size="sm" onClick={() => setImporting(true)}>
                Import
              </Button>
            ) : null}
          </div>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <fieldset aria-label="View" className="m-0 flex border-0 p-0">
          <Button
            tone="secondary"
            size="dense"
            icon="board"
            aria-pressed={!asList}
            onClick={() => navigate(href("/notes/board", { show: null, b: board.id }))}
          >
            Board
          </Button>
          <Button
            tone="secondary"
            size="dense"
            icon="list"
            aria-pressed={asList}
            onClick={() => navigate(href("/notes/board", { show: "list", b: board.id }))}
          >
            List
          </Button>
        </fieldset>
        {asList ? null : (
          <>
            <select
              aria-label="Owner"
              className={SELECT}
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
            >
              <option value="">Anyone</option>
              <option value="me">Mine</option>
              <option value="none">No owner</option>
              {people
                .filter((p) => p !== data.me)
                .map((p) => (
                  <option key={p} value={p}>
                    {ownerName(p)}
                  </option>
                ))}
            </select>
            {chips.size ? (
              <select
                aria-label="Client"
                className={SELECT}
                value={about}
                onChange={(e) => setAbout(e.target.value)}
              >
                <option value="">Any client</option>
                {[...chips].map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            ) : null}
            <label className="flex items-center gap-1.5 text-[13px]">
              <input
                type="checkbox"
                checked={blocked}
                onChange={(e) => setBlocked(e.target.checked)}
              />
              Blocked
            </label>
            {filtering ? (
              <button
                type="button"
                className="border-0 bg-transparent p-0 text-[13px] text-(--ui-ink-2) underline"
                onClick={() => {
                  setOwner("");
                  setAbout("");
                  setBlocked(false);
                }}
              >
                Clear
              </button>
            ) : null}
          </>
        )}
        <span className="ml-auto flex items-center gap-2">
          {board.home === WREN.id && client !== WREN.id ? <Tag>From Wren</Tag> : null}
        </span>
      </div>
      {asList ? (
        <TemplatePage
          {...props}
          client={client}
          demo={demo}
          params={params}
          app="Notes"
          page={LIST}
          path="/notes/board"
          id={undefined}
        />
      ) : (
        <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-4">
          {columns.map((c) => (
            <ColumnView
              key={c.id}
              client={client}
              board={board}
              column={c}
              columns={columns}
              cards={arrange(shown, moved, c.id, columns)}
              write={write}
              move={move}
              added={got.retry}
              filtering={filtering}
            />
          ))}
        </div>
      )}
      {importing ? (
        <ImportDialog
          client={client}
          board={board.id}
          open={importing}
          onOpenChange={setImporting}
          onDone={() => got.retry()}
        />
      ) : null}
      {settings ? (
        <BoardDialog
          client={client}
          board={board}
          open={settings}
          onOpenChange={setSettings}
          onChanged={() => {
            reloadBoards();
            got.retry();
          }}
          onGone={() => {
            reloadBoards();
            navigate("/notes/board");
          }}
        />
      ) : null}
    </>
  );
}

/** A column's cards in order, with the cards just moved placed where they were dropped. */
function arrange(cards: Card[], moved: Moved, columnId: string, columns: Column[]): Card[] {
  const closes = new Map(columns.map((c) => [c.id, c.done]));
  const here = (c: Card) => (moved[c.id]?.columnId ?? c.columnId) === columnId;
  const out = cards.filter((c) => here(c) && !moved[c.id]);
  for (const c of cards.filter((x) => moved[x.id] && here(x))) {
    const m = moved[c.id] as Moved[string];
    const card = { ...c, columnId, closed: closes.get(columnId) ?? c.closed };
    const before = m.before ? out.findIndex((x) => x.id === m.before) : -1;
    const after = m.after ? out.findIndex((x) => x.id === m.after) : -1;
    if (before >= 0) out.splice(before, 0, card);
    else if (after >= 0) out.splice(after + 1, 0, card);
    else out.push(card);
  }
  return out;
}

function ColumnView({
  client,
  board,
  column,
  columns,
  cards,
  write,
  move,
  added,
  filtering,
}: {
  client: string;
  board: BoardInfo;
  column: Column;
  columns: Column[];
  cards: Card[];
  write: boolean;
  move: (id: string, columnId: string, at?: { before?: string; after?: string }) => void;
  added: () => void;
  filtering: boolean;
}) {
  const [over, setOver] = useState(false);
  return (
    <section
      aria-label={column.name}
      className={cx(
        "grid w-[264px] shrink-0 content-start gap-2 border border-(--ui-hair) bg-(--ui-wash) p-2",
        over && "border-(--ui-active)",
      )}
      onDragOver={(e) => {
        if (!write) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = e.dataTransfer.getData("text/card");
        if (id) move(id, column.id);
      }}
    >
      <header className="flex items-baseline justify-between gap-2 px-1">
        <h2 className={cx("m-0 text-[13.5px] font-semibold", column.done && "text-(--ui-good)")}>
          {column.name}
          <span className="ml-1.5 font-normal text-(--ui-ink-3)">{num(cards.length)}</span>
        </h2>
      </header>
      {cards.map((c) => (
        <CardFace key={c.id} c={c} columns={columns} write={write} move={move} />
      ))}
      {cards.length ? null : (
        <p className="m-0 px-1 py-3 text-[12.5px] text-(--ui-ink-3)">
          {filtering ? "No match." : write ? "Drop a card here." : "None."}
        </p>
      )}
      {write ? <Adder client={client} board={board.id} column={column} done={added} /> : null}
    </section>
  );
}

function CardFace({
  c,
  columns,
  write,
  move,
}: {
  c: Card;
  columns: Column[];
  write: boolean;
  move: (id: string, columnId: string, at?: { before?: string; after?: string }) => void;
}) {
  const late = isLate(c);
  return (
    <article
      draggable={write}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/card", c.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      // Dropped on a card: above it in the top half, below it in the bottom.
      onDragOver={(e) => {
        if (write) e.preventDefault();
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData("text/card");
        if (!id) return;
        e.preventDefault();
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        move(id, c.columnId, e.clientY < r.top + r.height / 2 ? { before: c.id } : { after: c.id });
      }}
      className={cx(
        "grid gap-1.5 border border-(--ui-hair) bg-(--ui-paper) p-2.5 text-[13px]",
        write && "cursor-grab active:cursor-grabbing",
        c.closed && "opacity-70",
      )}
    >
      <a
        className={cx(
          "min-w-0 font-medium text-(--ui-ink) no-underline hover:underline",
          c.closed && "line-through",
        )}
        href={docPath(c.id)}
        draggable={false}
        {...clipProps()}
      >
        {c.name}
      </a>
      {c.clients.length ? (
        <span className="flex flex-wrap gap-1">
          {c.clients.map((x) => (
            <Tag key={x.id}>{x.name}</Tag>
          ))}
        </span>
      ) : null}
      <div className="flex items-center gap-2.5 text-[12px] text-(--ui-ink-3)">
        <Avatar who={c.assignee} size={20} />
        {c.due ? (
          <span className={cx(late && "font-medium text-(--ui-bad)")}>
            {late ? "Due " : ""}
            {c.due}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-2.5">
          {c.blocked > 0 && !c.closed ? (
            <span
              role="img"
              aria-label="Blocked"
              title="Waiting on another card"
              className="inline-block size-2 rounded-full bg-(--ui-bad)"
            />
          ) : null}
          {c.comments ? (
            <span className="inline-flex items-center gap-1" title="Comments">
              <Icon name="chat" size={13} />
              {c.comments}
            </span>
          ) : null}
        </span>
      </div>
      {write ? (
        <select
          aria-label={`Column of ${c.name}`}
          className={cx(SELECT, "mt-1 sm:hidden")}
          value={c.columnId}
          onChange={(e) => move(c.id, e.target.value)}
        >
          {columns.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      ) : null}
    </article>
  );
}

/** The "+" at a column's foot: a title, Enter adds it and waits for the next, Escape stops. */
function Adder({
  client,
  board,
  column,
  done,
}: {
  client: string;
  board: string;
  column: Column;
  done: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLInputElement>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await notes(client, "taskAdd", { board, column: column.id, title });
      setTitle("");
      done();
      box.current?.focus();
    } catch (err) {
      say.failed(err);
    } finally {
      setBusy(false);
    }
  };
  if (!open)
    return (
      <button
        type="button"
        aria-label={`Add a card to ${column.name}`}
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 border-0 bg-transparent px-1 py-1 text-left text-[13px] text-(--ui-ink-2) hover:text-(--ui-ink)"
      >
        <span aria-hidden="true">+</span> Add a card
      </button>
    );
  return (
    <form onSubmit={submit}>
      <Input
        ref={box}
        autoFocus
        value={title}
        maxLength={300}
        aria-label={`New card in ${column.name}`}
        placeholder="Title, then Enter"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            setTitle("");
          }
        }}
        onBlur={() => {
          if (!title.trim()) setOpen(false);
        }}
      />
    </form>
  );
}
