/**
 * The agent beside any page (designs/2026-11-04-multi-user-runtime.md, Decision 6): one column in
 * the shell, outside the page's keyed tree, so a chat lives across pages. Closed and idle, it
 * unmounts: the socket closes and frees a relay slot; reopened, the chat reads back by its id.
 * Open and width on the device; the setup and chat per tab.
 */
import {
  AgentChatsMenu,
  Alert,
  Loading,
  PANEL,
  PanelAct,
  PanelClose,
  ProductMark,
  Seg,
  SidePanel,
} from "@wren/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCall } from "../../load.js";
import { keep, recall } from "../../local.js";
import { AgentChat, ChatTitle } from "./chat.js";
import { relaySessions, relaySetups } from "./connect.js";
import type { Hand } from "./drive.js";
import { closeText } from "./thread.js";
import { pageToken } from "./use-agent.js";

const KEPT = "wren.agent.panel";
const TAB = "wren.agent.chat";

interface Kept {
  open: boolean;
  width: number;
}

const read = (): Kept => {
  try {
    const k = JSON.parse(recall(KEPT) ?? "{}") as Partial<Kept>;
    const w = Number(k.width);
    return {
      open: k.open === true,
      width: w >= PANEL.min && w <= PANEL.max ? w : PANEL.width,
    };
  } catch {
    return { open: false, width: PANEL.width };
  }
};

/** Open state and width, kept; ⌘J (Ctrl+J) toggles. */
export function useAgentPanel(on: boolean) {
  const [k, setK] = useState(read);
  const set = useCallback((p: Partial<Kept>) => {
    setK((o) => {
      const n = { ...o, ...p };
      keep(KEPT, JSON.stringify(n));
      return n;
    });
  }, []);
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "j" || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey)
        return;
      e.preventDefault();
      setK((o) => {
        const n = { ...o, open: !o.open };
        keep(KEPT, JSON.stringify(n));
        return n;
      });
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [on]);
  return { ...k, set };
}

interface Tab {
  /** The setup picked, and the product it was picked under (`""` = a page with none). */
  setup?: string;
  for?: string;
  /** Per setup: its chat and model, so each product keeps its own thread. */
  chats?: Record<string, string | null>;
  models?: Record<string, string>;
}
const tabRead = (): Tab => {
  try {
    return JSON.parse(sessionStorage.getItem(TAB) ?? "{}") as Tab;
  } catch {
    return {};
  }
};
const tabKeep = (t: Tab) => {
  try {
    sessionStorage.setItem(TAB, JSON.stringify(t));
  } catch {}
};

export function AgentPanel({
  open,
  width,
  onWidth,
  onClose,
  product,
  hand,
  page,
  owner,
}: {
  open: boolean;
  width: number;
  onWidth: (w: number) => void;
  onClose: () => void;
  /** The open page's product (`Module.product`): the setup of that title comes first. */
  product: string | undefined;
  /** A turn a page hands the chat (`drive.ts`). */
  hand: Hand | null;
  /** The page the next turn names, as `App › Page (/path)`. */
  page: string | undefined;
  /** The Mac's owner (`ownerOf`). */
  owner: boolean;
}) {
  const [busy, setBusy] = useState(false);
  // closed and idle: nothing mounted, no socket
  if (!open && !busy) return null;
  return (
    <SidePanel open={open} label="Agent" width={width} onWidth={onWidth} onClose={onClose}>
      <PanelChat
        product={product}
        hand={hand}
        page={page}
        owner={owner}
        onRunning={setBusy}
        onClose={onClose}
      />
    </SidePanel>
  );
}

function PanelChat({
  product,
  hand,
  page,
  owner,
  onRunning,
  onClose,
}: {
  product: string | undefined;
  hand: Hand | null;
  page: string | undefined;
  owner: boolean;
  onRunning: (r: boolean) => void;
  onClose: () => void;
}) {
  const setups = useCall("agent:setups", () => relaySetups(), { kept: false });
  const [tab, setTab] = useState(tabRead);
  const put = (p: Tab) =>
    setTab((o) => {
      const n = { ...o, ...p };
      tabKeep(n);
      return n;
    });
  const [running, setRunning] = useState(false);
  // the relay refuses an owner setup to anyone else: not offered either
  const list = (setups.data ?? []).filter((s) => owner || !s.owner);
  const named = (n: string | undefined) => list.find((s) => s.name === n);
  const under = product ?? "";
  // a pick holds for the product it was made under; another product brings its own setup;
  // a page with none keeps the last one
  const wanted =
    (tab.for === under ? named(tab.setup) : undefined) ??
    list.find((s) => s.title === product) ??
    named(tab.setup) ??
    list[0];
  // a running chat stays through a page change: unmounting it would drop its stream
  const held = useRef<string | undefined>(undefined);
  const setup = (running ? named(held.current) : undefined) ?? wanted;
  held.current = setup?.name;
  // a hand-off opens its own setup's chat, once this one is idle
  const lost = !!hand && !!setups.data && !named(hand.setup);
  useEffect(() => {
    if (!hand || running || lost || !setups.data || setup?.name === hand.setup) return;
    put({ setup: hand.setup, for: under });
  });
  // the same list the Ask page reads: a name given in one shows in the other
  const sessions = useCall(setup ? `agent:sessions:${setup.name}` : null, async () =>
    relaySessions(setup?.name ?? "", await pageToken()),
  );
  if (setups.error && !setups.data) {
    const c = closeText(setups.error);
    return (
      <div className="p-4">
        <Alert onRetry={c.retry ? setups.retry : undefined}>{c.text}</Alert>
      </div>
    );
  }
  if (lost && hand)
    return (
      <div className="p-4">
        <Alert onRetry={setups.retry}>
          The relay on this Mac has no {hand.setup} setup. Restart wren agent serve, then retry.
        </Alert>
      </div>
    );
  if (!setup)
    return setups.data ? (
      <p className="m-0 p-4 text-[13.5px] text-(--ui-ink-2)">No agent setup on this Mac.</p>
    ) : (
      <div className="p-4">
        <Loading shape="rows" lines={3} />
      </div>
    );
  const chat = tab.chats?.[setup.name] ?? null;
  const pick = { setup: setup.name, for: under };
  const putChat = (id: string | null) =>
    put({ ...pick, chats: { ...tabRead().chats, [setup.name]: id } });
  const stored = sessions.data?.find((r) => r.session === chat)?.title;
  const model = tab.models?.[setup.name] || setup.model;
  // only Research has the chat as a page of its own
  const pageOf = (id: string | null) =>
    setup.app === "research"
      ? `/research/ask?setup=${encodeURIComponent(setup.name)}${id ? `&chat=${encodeURIComponent(id)}` : ""}`
      : null;
  const full = pageOf(chat);
  return (
    <AgentChat
      key={setup.name}
      setup={setup}
      chat={chat}
      model={model}
      onModel={(v) => put({ ...pick, models: { ...tabRead().models, [setup.name]: v } })}
      hand={hand?.setup === setup.name ? hand : null}
      owner={owner}
      page={page}
      className="min-h-0 flex-1"
      head={(first) => (
        <div className="flex min-h-[54px] flex-none flex-wrap items-center gap-1 border-(--ui-hair) border-b py-2 pr-2 pl-4">
          {list.length > 1 ? (
            <Seg
              label="Setup"
              dense
              items={list.map((s) => ({ value: s.name, label: s.title }))}
              value={setup.name}
              onChange={(v) => put({ setup: v, for: under })}
            />
          ) : (
            <ProductMark name={setup.title} />
          )}
          <ChatTitle
            setup={setup.name}
            chat={chat}
            title={stored ?? first ?? (chat ? "Chat" : "New chat")}
            onRenamed={sessions.retry}
            className="ml-1.5 flex-1 text-[13.5px]"
          />
          <AgentChatsMenu
            rows={sessions.data ?? undefined}
            open={chat}
            hrefOf={(r) => pageOf(r.session) ?? "#"}
            onOpen={(r) => putChat(r.session)}
          />
          <PanelAct icon="plus" label="New chat" onClick={() => putChat(null)} />
          {full ? (
            <PanelAct icon="expand" label="Open on its own page" href={full} onClick={onClose} />
          ) : null}
          <PanelClose label="Agent" onClose={onClose} />
        </div>
      )}
      onSession={putChat}
      onRunning={(r) => {
        setRunning(r);
        onRunning(r);
      }}
    />
  );
}
