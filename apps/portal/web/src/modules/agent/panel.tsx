/**
 * The agent beside any page (designs/2026-11-04-multi-user-runtime.md, Decision 6): one column in
 * the shell, outside the page's keyed tree, so a chat lives across pages. Closed and idle, it
 * unmounts: the socket closes and frees a relay slot; reopened, the chat reads back by its id.
 * Open and width on the device; the setup and chat per tab.
 */
import { Alert, Loading, PANEL, PanelAct, PanelClose, ProductMark, Seg, SidePanel } from "@wren/ui";
import { useCallback, useEffect, useState } from "react";
import { useCall } from "../../load.js";
import { keep, recall } from "../../local.js";
import { AgentChat, ChatTitle } from "./chat.js";
import { relaySessions, relaySetups } from "./connect.js";
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
  setup?: string;
  chat?: string | null;
  model?: string;
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
  app,
  page,
  owner,
}: {
  open: boolean;
  width: number;
  onWidth: (w: number) => void;
  onClose: () => void;
  /** The open app's id: its own setup comes first. */
  app: string | null;
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
      <PanelChat app={app} page={page} owner={owner} onRunning={setBusy} onClose={onClose} />
    </SidePanel>
  );
}

function PanelChat({
  app,
  page,
  owner,
  onRunning,
  onClose,
}: {
  app: string | null;
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
  const list = setups.data ?? [];
  const setup =
    list.find((s) => s.name === tab.setup) ?? list.find((s) => s.app === app) ?? list[0];
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
  if (!setup)
    return setups.data ? (
      <p className="m-0 p-4 text-[13.5px] text-(--ui-ink-2)">No agent setup on this Mac.</p>
    ) : (
      <div className="p-4">
        <Loading shape="rows" lines={3} />
      </div>
    );
  const chat = tab.setup === setup.name ? (tab.chat ?? null) : null;
  const stored = sessions.data?.find((r) => r.session === chat)?.title;
  const model = (tab.setup === setup.name && tab.model) || setup.model;
  const full = `/${setup.app}/ask?setup=${encodeURIComponent(setup.name)}${chat ? `&chat=${encodeURIComponent(chat)}` : ""}`;
  return (
    <AgentChat
      key={setup.name}
      setup={setup}
      chat={chat}
      model={model}
      onModel={(v) => put({ setup: setup.name, model: v })}
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
              onChange={(v) => put({ setup: v, chat: null, model: "" })}
            />
          ) : (
            <ProductMark name={setup.title} className="mr-1.5" />
          )}
          <ChatTitle
            setup={setup.name}
            chat={chat}
            title={stored ?? first ?? (chat ? "Chat" : "New chat")}
            onRenamed={sessions.retry}
            className="flex-1 text-[13.5px]"
          />
          <PanelAct
            icon="plus"
            label="New chat"
            onClick={() => put({ setup: setup.name, chat: null })}
          />
          <PanelAct icon="expand" label="Open on its own page" href={full} onClick={onClose} />
          <PanelClose label="Agent" onClose={onClose} />
        </div>
      )}
      onSession={(id) => put({ setup: setup.name, chat: id })}
      onRunning={onRunning}
    />
  );
}
