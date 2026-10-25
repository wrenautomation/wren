/**
 * A comment's whole conversation (designs/2026-10-15-engage-threads.md): the post, our comment
 * and every reply under it, nested, each with its own Reply from Wren and a link to it on the
 * site. It comes with the record's detail, read when the row opens and kept by the data layer;
 * Refresh reads the thread on the site again. On a phone it opens as its own full sheet.
 */
import type { AccountPick } from "@wren/core/record-accounts";
import type { ContextNode, ThreadContext } from "@wren/outreach";
import {
  AccountPicker,
  BottomSheet,
  Button,
  ButtonLink,
  cx,
  exact,
  PlatformMark,
  type RecordAct,
  type RecordExtras,
  relative,
  SendStatus,
  say,
  Textarea,
  useEdit,
  useLastWrite,
  usePhone,
} from "@wren/ui";
import { useState } from "react";

export const THREAD_REPLY = "marketing.threadReply";
export const THREAD_READ = "marketing.threadRead";

const contextOf = (detail: unknown): ThreadContext | null =>
  (detail as { context?: ThreadContext | null } | null)?.context ?? null;
const accountsOf = (detail: unknown): AccountPick | null =>
  (detail as { accounts?: AccountPick | null } | null)?.accounts ?? null;

/** Deeper than this, replies stop stepping in and say who they answer instead. */
const MAX_DEPTH = 5;
const DELETED = new Set(["[deleted]", "[removed]"]);

interface Tree {
  node: ContextNode;
  kids: Tree[];
}

/** The nodes nested by parent; one whose parent the read didn't see starts a branch of its own. */
export function treeOf(nodes: readonly ContextNode[]): Tree[] {
  const by = new Map(nodes.map((n) => [n.ref, { node: n, kids: [] as Tree[] }]));
  const roots: Tree[] = [];
  for (const n of nodes) {
    const t = by.get(n.ref);
    if (!t) continue;
    const up = n.parent && n.parent !== n.ref ? by.get(n.parent) : undefined;
    (up ? up.kids : roots).push(t);
  }
  return roots;
}

const when = (at: string) => {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : d;
};

function Time({ at }: { at: string | null }) {
  const d = at ? when(at) : null;
  return d ? (
    <time dateTime={d.toISOString()} title={exact(d)}>
      {relative(d)}
    </time>
  ) : null;
}

/** Their kept row's state, said plainly; null for ours or one not kept. */
const stateWords = (n: ContextNode) =>
  n.ours
    ? null
    : !n.row
      ? null
      : n.row.state === "answered"
        ? "Answered"
        : n.row.state === "dropped"
          ? "Skipped"
          : "Waiting";

/** The pick a reply goes out as: untouched, the record's own; else the one picked here. */
function usePick(accounts: AccountPick | null) {
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  const pick: AccountPick | null =
    accounts && chosen !== undefined
      ? { ...accounts, current: chosen ?? accounts.fallback, picked: chosen !== null }
      : accounts;
  const account =
    chosen !== undefined ? chosen : accounts?.picked ? (accounts.current ?? null) : null;
  return { pick, account, choose: setChosen };
}

function NodeReply({
  node,
  act,
  accounts,
  onDone,
}: {
  node: ContextNode;
  act: RecordAct;
  accounts: AccountPick | null;
  onDone: () => void;
}) {
  // The words stay on the device until the server took them (the edits store).
  const edit = useEdit(act.record ? `thread:${act.record}:${node.ref}` : null, "");
  const { pick, account, choose } = usePick(accounts);
  const last = useLastWrite(act.record, [THREAD_REPLY]);
  const mine = last?.input?.ref === node.ref ? last : null;
  const going = !!mine && (mine.status === "sending" || mine.status === "unsure");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const body = edit.value.trim();
    if (!body || busy || going) return;
    setBusy(true);
    try {
      await act(THREAD_REPLY, { ref: node.ref, body, account });
      edit.saved(edit.value);
      say.done("Sent");
      onDone();
    } catch (err) {
      say.failed(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-2 pt-1" data-thread-reply={node.ref}>
      {pick ? <AccountPicker pick={pick} onPick={(k) => choose(k)} busy={busy} /> : null}
      <Textarea
        {...edit.field}
        aria-label={`Reply to ${node.handle}`}
        placeholder={`Reply to ${node.handle}`}
        rows={3}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void send();
          }
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          tone="primary"
          size="dense"
          onClick={() => void send()}
          disabled={!edit.value.trim() || busy || going}
        >
          {busy || going ? "Sending" : "Send"}
        </Button>
        <Button tone="quiet" size="dense" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        {edit.restored ? (
          <span className="text-[12.5px] text-(--ui-ink-3)">Kept from before, not sent</span>
        ) : null}
      </div>
      <SendStatus write={mine} />
    </div>
  );
}

function Node({
  t,
  depth,
  focus,
  parentOf,
  act,
  accounts,
  replying,
  setReplying,
  readOnly,
}: {
  t: Tree;
  depth: number;
  focus: string;
  parentOf: (ref: string) => ContextNode | undefined;
  act: RecordAct;
  accounts: AccountPick | null;
  replying: string | null;
  setReplying: (ref: string | null) => void;
  readOnly: boolean;
}) {
  const n = t.node;
  const gone = DELETED.has(n.handle) || DELETED.has(n.text.trim());
  const state = stateWords(n);
  const up = depth >= MAX_DEPTH ? parentOf(n.parent) : undefined;
  return (
    <li
      data-node={n.ref}
      data-focus={n.ref === focus ? "" : undefined}
      className={cx(
        "grid gap-2",
        depth > 0 && depth <= MAX_DEPTH && "border-l border-(--ui-hair) pl-3",
      )}
    >
      <div
        className={cx(
          "grid gap-1 rounded-lg px-2.5 py-2",
          n.ref === focus
            ? "bg-(--ui-band) ring-1 ring-(--ui-edge)"
            : n.ours
              ? "bg-(--ui-fill)"
              : "",
        )}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-(--ui-ink-2)">
          <span className="font-medium text-(--ui-ink)">{n.handle}</span>
          {n.ours ? <span className="text-(--ui-ink-3)">Us</span> : null}
          {up ? <span className="text-(--ui-ink-3)">replying to {up.handle}</span> : null}
          <Time at={n.at} />
          {state ? (
            <span className={state === "Waiting" ? "text-(--ui-warn-ink)" : "text-(--ui-ink-3)"}>
              {state}
            </span>
          ) : null}
        </div>
        <p className="text-[14px] leading-[1.6] whitespace-pre-line text-pretty">
          {gone ? <span className="text-(--ui-ink-3)">Deleted</span> : n.text}
        </p>
        <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
          {!n.ours && !gone && !readOnly ? (
            <button
              type="button"
              className="border-0 bg-transparent p-0 text-(--ui-ink-2) underline-offset-2 hover:text-(--ui-ink) hover:underline"
              aria-expanded={replying === n.ref}
              onClick={() => setReplying(replying === n.ref ? null : n.ref)}
            >
              Reply from Wren
            </button>
          ) : null}
          {n.url ? (
            <a
              href={n.url}
              target="_blank"
              rel="noreferrer"
              className="border-0 bg-transparent p-0 text-(--ui-ink-2) underline-offset-2 hover:text-(--ui-ink) hover:underline"
            >
              Open on site
            </a>
          ) : null}
        </div>
        {replying === n.ref && !readOnly ? (
          <NodeReply node={n} act={act} accounts={accounts} onDone={() => setReplying(null)} />
        ) : null}
      </div>
      {t.kids.length ? (
        <ol className="grid gap-2">
          {t.kids.map((k) => (
            <Node
              key={k.node.ref}
              t={k}
              depth={depth + 1}
              focus={focus}
              parentOf={parentOf}
              act={act}
              accounts={accounts}
              replying={replying}
              setReplying={setReplying}
              readOnly={readOnly}
            />
          ))}
        </ol>
      ) : null}
    </li>
  );
}

/** The post the thread sits under: where, who, its words and picture, and its link. */
function PostHead({ c }: { c: ThreadContext }) {
  const p = c.post;
  const [long, setLong] = useState(false);
  const media = p.media && /^https?:\/\//.test(p.media) ? p.media : null;
  return (
    <header className="grid gap-1.5" data-thread-post="">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-(--ui-ink-2)">
        <PlatformMark mark={c.platform} />
        {p.place ? <span>{p.place}</span> : null}
        {p.author ? <span>{p.author}</span> : null}
        <Time at={p.at} />
      </div>
      <div className="flex items-start gap-3">
        <div className="grid min-w-0 flex-1 gap-1">
          {p.title ? (
            <h3 className="text-[15px] font-medium leading-snug text-pretty">{p.title}</h3>
          ) : null}
          {p.text ? (
            <p
              className={cx(
                "text-[14px] leading-[1.6] whitespace-pre-line text-pretty text-(--ui-ink-2)",
                !long && "line-clamp-4",
              )}
            >
              {p.text}
            </p>
          ) : null}
          {p.text && p.text.length > 280 ? (
            <button
              type="button"
              className="justify-self-start border-0 bg-transparent p-0 text-[12.5px] text-(--ui-ink-2) hover:text-(--ui-ink) hover:underline"
              onClick={() => setLong(!long)}
            >
              {long ? "Show less" : "Show the whole post"}
            </button>
          ) : null}
        </div>
        {media ? (
          <img
            src={media}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="size-16 shrink-0 rounded-md object-cover"
          />
        ) : null}
      </div>
      {p.url ? (
        <ButtonLink
          href={p.url}
          target="_blank"
          rel="noreferrer"
          tone="quiet"
          size="dense"
          className="justify-self-start"
        >
          Open on site
        </ButtonLink>
      ) : null}
    </header>
  );
}

/** When it was read, what the site held back, and Refresh. */
function ReadLine({ c, act, readOnly }: { c: ThreadContext; act: RecordAct; readOnly: boolean }) {
  const [busy, setBusy] = useState(false);
  // Our own post's read keeps no thread snapshot: a Refresh here says when it ran.
  const [checked, setChecked] = useState<string | null>(null);
  const at = c.readAt ?? checked;
  const read = at ? when(at) : null;
  const refresh = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await act(THREAD_READ, {});
      setChecked(new Date().toISOString());
    } catch (err) {
      say.failed(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-(--ui-ink-3)">
      <span>
        {read ? (
          <>
            Checked on the site <Time at={at} />
          </>
        ) : (
          "Showing what we saved from the site."
        )}
      </span>
      {c.more > 0 ? (
        <span>
          The site hid {c.more === 1 ? "1 more reply" : `${c.more} more replies`}. Open on site to
          see them.
        </span>
      ) : null}
      {c.refresh && !readOnly ? (
        <Button tone="quiet" size="dense" onClick={() => void refresh()} disabled={busy}>
          {busy ? "Checking" : "Refresh"}
        </Button>
      ) : null}
    </div>
  );
}

/** The whole view: the post, the read line, and the nested replies. */
export function ThreadView({
  c,
  act,
  accounts,
  readOnly = false,
}: {
  c: ThreadContext;
  act: RecordAct;
  accounts: AccountPick | null;
  /** No Reply from Wren and no Refresh: a client's Inbox, whose replies go out from its own row. */
  readOnly?: boolean;
}) {
  const [replying, setReplying] = useState<string | null>(null);
  const roots = treeOf(c.nodes);
  const by = new Map(c.nodes.map((n) => [n.ref, n]));
  return (
    <section className="grid gap-3" data-thread-view="">
      <PostHead c={c} />
      <ReadLine c={c} act={act} readOnly={readOnly} />
      {roots.length ? (
        <ol className="grid gap-2">
          {roots.map((t) => (
            <Node
              key={t.node.ref}
              t={t}
              depth={0}
              focus={c.focus}
              parentOf={(ref) => by.get(ref)}
              act={act}
              accounts={accounts}
              replying={replying}
              setReplying={setReplying}
              readOnly={readOnly}
            />
          ))}
        </ol>
      ) : (
        <p className="text-[13px] text-(--ui-ink-3)">No replies yet.</p>
      )}
    </section>
  );
}

/** In a record's detail: inline on a wide screen; on a phone, a button that opens a full sheet. */
function ThreadPanel({
  c,
  act,
  accounts,
  readOnly,
}: {
  c: ThreadContext;
  act: RecordAct;
  accounts: AccountPick | null;
  readOnly: boolean;
}) {
  const phone = usePhone();
  const [open, setOpen] = useState(false);
  const replies = c.nodes.filter((n) => !n.ours).length;
  if (!phone) return <ThreadView c={c} act={act} accounts={accounts} readOnly={readOnly} />;
  return (
    <>
      <Button
        tone="quiet"
        size="dense"
        onClick={() => setOpen(true)}
        className="justify-self-start"
      >
        See the whole thread ({replies === 1 ? "1 reply" : `${replies} replies`})
      </Button>
      {open ? (
        <BottomSheet
          label="The whole thread"
          stops={["large"]}
          start="large"
          onClose={() => setOpen(false)}
        >
          <div className="px-4 pb-[calc(16px+env(safe-area-inset-bottom))]">
            <ThreadView c={c} act={act} accounts={accounts} readOnly={readOnly} />
          </div>
        </BottomSheet>
      ) : null}
    </>
  );
}

/**
 * Adds a comment row's whole thread to a page's extras: it leads the detail, or follows what
 * already leads it (the Inbox's conversation). It draws their messages itself, so the row's own
 * list of them is left out. `readOnly` (a client's Inbox) draws the thread with no Reply from Wren
 * or Refresh: both run on Wren's own desk, and the client's reply box answers the comment.
 */
export const withThread =
  <A extends { act: RecordAct }>(
    extras: (detail: unknown, at: A) => RecordExtras,
    { readOnly = false }: { readOnly?: boolean } = {},
  ) =>
  (detail: unknown, at: A): RecordExtras => {
    const base = extras(detail, at);
    const c = contextOf(detail);
    if (!c) return base;
    const panel = (
      <ThreadPanel
        key="thread"
        c={c}
        act={at.act}
        accounts={accountsOf(detail)}
        readOnly={readOnly}
      />
    );
    const drawn = [...(base.drawn ?? []), "messages"];
    return base.lead
      ? { ...base, drawn, sections: [["The whole thread", panel], ...(base.sections ?? [])] }
      : { ...base, drawn, lead: panel };
  };
