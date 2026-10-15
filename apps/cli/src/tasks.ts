/**
 * `wren [--client <id>] tasks …`: the board's cards from the terminal (designs/2026-10-14-boards.md,
 * Agents). A card is a note, so these write as `agent:claude` (or `--agent <name>`) and every
 * move lands in the card's Timeline. An agent that closes a card a person owns is sent to Review
 * instead, and told so. `--json` everywhere.
 */

import type { Db } from "@wren/db";
import {
  AGENT,
  addComment,
  assignTask,
  blockersOf,
  blockingOf,
  blockTask,
  boardById,
  closeTask,
  columnOf,
  createTask,
  defaultBoard,
  fromMarkdown,
  isNoteId,
  listBoards,
  listTasks,
  movesOf,
  moveTask,
  moveWords,
  noteById,
  readyTasks,
  reopenTask,
  setDue,
  type TaskRow,
  taskById,
  toMarkdown,
  unblockTask,
} from "@wren/notes";
import type { Board } from "@wren/notes/schema";
import { type Command, InvalidArgumentError } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const agentOf = (name: string | undefined) => {
  const n = (name ?? "claude").trim().toLowerCase();
  if (!/^[a-z0-9][\w.-]{0,40}$/.test(n))
    throw new InvalidArgumentError("an agent's name: letters, digits, . _ -");
  return `${AGENT}${n}`;
};

/** An owner as typed: an email, `agent:<name>`, a bare agent name, or `none`. */
const whoOf = (v: string): string | null => {
  const w = v.trim();
  if (/^(none|nobody|-)$/i.test(w)) return null;
  if (w.includes("@") || w.startsWith(AGENT)) return w.toLowerCase();
  return agentOf(w);
};

const limitOf = (v: string) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1 || n > 500) throw new InvalidArgumentError("1 to 500");
  return n;
};

const dayOf = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");

interface Common {
  agent?: string;
  json?: boolean;
}

export function registerTasks(
  program: Command,
  dbs: { withDb: WithDb; client: () => string | undefined },
): void {
  const { withDb } = dbs;
  const cmd = program
    .command("tasks")
    .description(
      "Board cards: ready, ls, show, add, move, assign, close, reopen, comment, block (agents write as agent:<name>)",
    );

  /** A board by id or name; the workspace's Work board when none is named. */
  const boardOf = async (db: Db, ref: string | undefined, by: string): Promise<Board> => {
    if (!ref) return defaultBoard(db, by);
    const byId = await boardById(db, ref);
    if (byId) return byId;
    const all = await listBoards(
      db,
      { email: "", team: false, inWorkspace: false, client: null },
      {
        everything: true,
      },
    );
    const r = ref.trim().toLowerCase();
    const found = all.find((b) => b.name.toLowerCase() === r);
    if (!found) throw new Error(`no board "${ref}"`);
    return found;
  };

  const need = async (db: Db, id: string): Promise<TaskRow> => {
    if (!isNoteId(id)) throw new Error(`not a card id: ${id}`);
    const t = await taskById(db, id);
    if (!t) throw new Error("no such card");
    return t;
  };

  /** One card, its column named from its board's columns. */
  const line = (t: TaskRow, board: Board | undefined) => {
    const col = board?.columns.find((c) => c.id === t.columnId)?.name ?? t.columnId;
    const bits = [
      col,
      t.assignee ?? "no owner",
      t.due ? `due ${t.due}` : "",
      t.blocked ? `blocked by ${t.blocked}` : "",
    ].filter(Boolean);
    return `${t.id}  ${t.title}  (${bits.join("; ")})`;
  };

  const show = async (db: Db, rows: TaskRow[]) => {
    const seen = new Map<string, Board | undefined>();
    const out: { row: TaskRow; board: Board | undefined }[] = [];
    for (const row of rows) {
      if (!seen.has(row.boardId))
        seen.set(row.boardId, (await boardById(db, row.boardId)) ?? undefined);
      out.push({ row, board: seen.get(row.boardId) });
    }
    return out;
  };

  const printList = async (rows: TaskRow[], o: Common, empty: string) => {
    const full = await withDb((db) => show(db, rows));
    if (o.json)
      return console.log(
        JSON.stringify(
          full.map(({ row, board }) => ({
            ...row,
            column: board?.columns.find((c) => c.id === row.columnId)?.name ?? row.columnId,
            board: board?.name ?? null,
          })),
          null,
          2,
        ),
      );
    if (!full.length) return console.log(empty);
    for (const { row, board } of full) console.log(line(row, board));
  };

  cmd
    .command("ready")
    .description("What to pick up next: open, nothing open blocking it, yours or nobody's")
    .option("--board <board>", "a board's id or name")
    .option("--agent <name>", "ready for agent:<name> (default claude)")
    .option("--limit <n>", "at most this many (default 50)", limitOf)
    .option("--json", "rows as JSON")
    .action(async (o: Common & { board?: string; limit?: number }) => {
      const me = agentOf(o.agent);
      const rows = await withDb(async (db) =>
        readyTasks(db, me, {
          ...(o.board ? { board: (await boardOf(db, o.board, me)).id } : {}),
          ...(o.limit ? { limit: o.limit } : {}),
        }),
      );
      await printList(rows, o, "nothing is ready");
    });

  cmd
    .command("ls")
    .description("Cards in column order")
    .option("--board <board>", "a board's id or name (default: every board)")
    .option("--column <column>", "a column's id or name")
    .option("--owner <who>", "an email, agent name, or none")
    .option("--all", "closed cards too")
    .option("--limit <n>", "at most this many (default 100)", limitOf)
    .option("--json", "rows as JSON")
    .action(
      async (
        o: Common & {
          board?: string;
          column?: string;
          owner?: string;
          all?: boolean;
          limit?: number;
        },
      ) => {
        const rows = await withDb(async (db) => {
          const board = o.board ? await boardOf(db, o.board, agentOf(undefined)) : null;
          const column = board && o.column ? columnOf(board, o.column) : null;
          if (o.column && board && !column)
            throw new Error(`no column "${o.column}" on ${board.name}`);
          return listTasks(db, {
            ...(board ? { board: board.id } : {}),
            ...(column ? { column: column.id } : {}),
            ...(o.owner !== undefined ? { assignee: whoOf(o.owner) } : {}),
            ...(o.all ? {} : { open: true }),
            limit: o.limit ?? 100,
          });
        });
        await printList(rows, o, "no cards");
      },
    );

  cmd
    .command("show")
    .description("A card: where it is, what it waits on, its words, its Timeline")
    .argument("<id>")
    .option("--json", "the card, its blockers and its moves as JSON")
    .action(async (id: string, o: Common) => {
      const out = await withDb(async (db) => {
        const t = await need(db, id);
        const board = await boardById(db, t.boardId);
        const note = await noteById(db, id);
        return {
          t,
          board,
          body: note ? toMarkdown(note.body as never).trim() : "",
          blockedBy: await blockersOf(db, id),
          blocking: await blockingOf(db, id),
          moves: await movesOf(db, id),
        };
      });
      const col = (cid: string | null) =>
        cid ? (out.board?.columns.find((c) => c.id === cid)?.name ?? cid) : null;
      if (o.json)
        return console.log(
          JSON.stringify(
            {
              ...out.t,
              column: col(out.t.columnId),
              board: out.board?.name ?? null,
              body: out.body,
              blockedBy: out.blockedBy,
              blocking: out.blocking,
              moves: out.moves.map((m) => ({
                ...m,
                from: col(m.from),
                to: col(m.to),
              })),
            },
            null,
            2,
          ),
        );
      console.log(`# ${out.t.title}\n`);
      console.log(line(out.t, out.board ?? undefined));
      if (out.board) console.log(`board: ${out.board.name}`);
      for (const b of out.blockedBy) console.log(`blocked by ${b.id}  ${b.title ?? ""}`.trimEnd());
      for (const b of out.blocking) console.log(`blocks ${b.id}  ${b.title ?? ""}`.trimEnd());
      if (out.body) console.log(`\n${out.body}`);
      console.log("\nTimeline");
      for (const m of [...out.moves].reverse())
        console.log(
          `${dayOf(m.at)}  ${m.by} ${moveWords({ ...m, to: col(m.to) }, (w) => w)}${m.why ? `  "${m.why}"` : ""}`,
        );
    });

  cmd
    .command("add")
    .description("A new card at the end of a column; prints its id")
    .argument("<title...>")
    .option("--board <board>", "a board's id or name (default: the Work board)")
    .option("--column <column>", "a column's id or name (default: the first)")
    .option("--owner <who>", "an email, agent name, or none")
    .option("--due <date>", "YYYY-MM-DD")
    .option("--blocked-by <id...>", "cards it waits on")
    .option("--body <markdown>", "its words, as Markdown")
    .option("--agent <name>", "write as agent:<name> (default claude)")
    .option("--json", "the new card as JSON")
    .action(
      async (
        title: string[],
        o: Common & {
          board?: string;
          column?: string;
          owner?: string;
          due?: string;
          blockedBy?: string[];
          body?: string;
        },
      ) => {
        const by = agentOf(o.agent);
        const t = await withDb(async (db) => {
          const board = await boardOf(db, o.board, by);
          const note = await createTask(db, {
            board,
            title: title.join(" "),
            by,
            via: "agent",
            ...(o.column ? { column: o.column } : {}),
            ...(o.owner !== undefined ? { assignee: whoOf(o.owner) } : {}),
            ...(o.due ? { due: o.due } : {}),
            ...(o.body ? { body: fromMarkdown(o.body) } : {}),
            ...(o.blockedBy?.length ? { blockedBy: o.blockedBy } : {}),
          });
          return (await taskById(db, note.id)) as TaskRow;
        });
        if (o.json) return console.log(JSON.stringify(t, null, 2));
        console.log(t.id);
        process.stderr.write(`/notes/doc/${t.id} in ${dbs.client() ?? "wren"}\n`);
      },
    );

  cmd
    .command("move")
    .description("Move a card to a column (an agent can't close a card a person owns)")
    .argument("<id>")
    .argument("<column>")
    .option("--why <words>", "a line for the Timeline")
    .option("--agent <name>", "move as agent:<name> (default claude)")
    .option("--json", "the result as JSON")
    .action(async (id: string, column: string, o: Common & { why?: string }) => {
      const by = agentOf(o.agent);
      const out = await withDb(async (db) => {
        await need(db, id);
        return moveTask(db, id, { column, by, why: o.why ?? null });
      });
      await reportMove(out, o, id);
    });

  /** What a move did: where the card is now, and a note when it went to Review instead. */
  const reportMove = async (
    out: { task: TaskRow; moved: boolean; redirected: { name: string } | null },
    o: Common,
    id: string,
  ) => {
    const where = await withDb(async (db) => {
      const t = await taskById(db, id);
      const board = t ? await boardById(db, t.boardId) : null;
      return board?.columns.find((c) => c.id === t?.columnId)?.name ?? "";
    });
    if (o.json)
      return console.log(
        JSON.stringify({
          id,
          column: where,
          moved: out.moved,
          redirected: out.redirected?.name ?? null,
        }),
      );
    console.log(`${id}  ${where}${out.moved ? "" : " (no change)"}`);
    if (out.redirected)
      process.stderr.write(
        `a person owns this card, so it went to ${out.redirected.name}; comment and let them close it\n`,
      );
  };

  cmd
    .command("assign")
    .description("Give a card to someone: an email, an agent name, or none")
    .argument("<id>")
    .argument("<who>")
    .option("--agent <name>", "act as agent:<name> (default claude)")
    .option("--json", "the card as JSON")
    .action(async (id: string, who: string, o: Common) => {
      const by = agentOf(o.agent);
      const t = await withDb(async (db) => {
        await need(db, id);
        return assignTask(db, id, whoOf(who), { by });
      });
      if (o.json) return console.log(JSON.stringify(t, null, 2));
      console.log(`${id}  ${t.assignee ?? "no owner"}`);
    });

  cmd
    .command("due")
    .description("Set a card's due day (YYYY-MM-DD), or none")
    .argument("<id>")
    .argument("<date>")
    .action(async (id: string, date: string) => {
      await withDb(async (db) => {
        await need(db, id);
        await setDue(db, id, /^(none|-)$/i.test(date) ? null : date);
      });
      console.log(`${id}  ${/^(none|-)$/i.test(date) ? "no due day" : date}`);
    });

  cmd
    .command("close")
    .description("Move a card to its done column, with a reason")
    .argument("<id>")
    .requiredOption("--why <words>", "what finished it, in a line")
    .option("--agent <name>", "close as agent:<name> (default claude)")
    .option("--json", "the result as JSON")
    .action(async (id: string, o: Common & { why: string }) => {
      const by = agentOf(o.agent);
      const out = await withDb(async (db) => {
        await need(db, id);
        return closeTask(db, id, { by, why: o.why });
      });
      await reportMove(out, o, id);
    });

  cmd
    .command("reopen")
    .description("Put a closed card back in a column that isn't done")
    .argument("<id>")
    .option("--column <column>", "which column (default: the first)")
    .option("--why <words>", "a line for the Timeline")
    .option("--agent <name>", "act as agent:<name> (default claude)")
    .option("--json", "the result as JSON")
    .action(async (id: string, o: Common & { column?: string; why?: string }) => {
      const by = agentOf(o.agent);
      const out = await withDb(async (db) => {
        await need(db, id);
        return reopenTask(db, id, {
          by,
          why: o.why ?? null,
          ...(o.column ? { column: o.column } : {}),
        });
      });
      await reportMove(out, o, id);
    });

  cmd
    .command("comment")
    .description("A comment on a card, under its title")
    .argument("<id>")
    .argument("<text...>")
    .option("--agent <name>", "write as agent:<name> (default claude)")
    .option("--json", "the comment as JSON")
    .action(async (id: string, text: string[], o: Common) => {
      const by = agentOf(o.agent);
      const body = text.join(" ").trim();
      if (!body) throw new Error("nothing to write");
      const c = await withDb(async (db) => {
        await need(db, id);
        return addComment(db, { noteId: id, by, body });
      });
      if (o.json) return console.log(JSON.stringify(c, null, 2));
      console.log(`commented on ${id}`);
    });

  cmd
    .command("block")
    .description("Say a card waits on another (or, with --off, no longer does)")
    .argument("<id>")
    .argument("<blocked-by>")
    .option("--off", "remove the wait")
    .option("--agent <name>", "act as agent:<name> (default claude)")
    .action(async (id: string, other: string, o: Common & { off?: boolean }) => {
      const by = agentOf(o.agent);
      await withDb(async (db) => {
        await need(db, id);
        await need(db, other);
        if (o.off) await unblockTask(db, id, other);
        else await blockTask(db, id, other, by);
      });
      console.log(o.off ? `${id} no longer waits on ${other}` : `${id} waits on ${other}`);
    });
}
