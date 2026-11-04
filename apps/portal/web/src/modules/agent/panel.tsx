/**
 * The agent beside any page (designs/2026-11-04-multi-user-runtime.md, Decision 6): one column in
 * the shell, outside the page's keyed tree, so a chat lives across pages. Closed and idle, it
 * unmounts: the socket closes and frees a relay slot; reopened, the chat reads back by its id.
 * Open and width on the device; the setup and chat per tab.
 */
import { Alert, Button, ButtonLink, Loading, PANEL, Seg, SidePanel, tipProps } from "@wren/ui";
import { useCallback, useEffect, useState } from "react";
import { useCall } from "../../load.js";
import { keep, recall } from "../../local.js";
import { AgentChat, ModelPick } from "./chat.js";
import { relaySetups } from "./connect.js";
import { closeText } from "./thread.js";

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
}: {
  open: boolean;
  width: number;
  onWidth: (w: number) => void;
  onClose: () => void;
  /** The open app's id: its own setup comes first. */
  app: string | null;
  /** The page the next turn names, as `App › Page (/path)`. */
  page: string | undefined;
}) {
  const [busy, setBusy] = useState(false);
  // closed and idle: nothing mounted, no socket
  if (!open && !busy) return null;
  return (
    <SidePanel
      open={open}
      label="Agent"
      width={width}
      onWidth={onWidth}
      onClose={onClose}
      title={<span className="text-[14px] font-semibold text-(--ui-ink)">Agent</span>}
    >
      <PanelChat app={app} page={page} onRunning={setBusy} onClose={onClose} />
    </SidePanel>
  );
}

function PanelChat({
  app,
  page,
  onRunning,
  onClose,
}: {
  app: string | null;
  page: string | undefined;
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
  if (setups.error && !setups.data) {
    const c = closeText(setups.error);
    return (
      <div className="p-4">
        <Alert onRetry={c.retry ? setups.retry : undefined}>{c.text}</Alert>
      </div>
    );
  }
  const list = setups.data ?? [];
  const setup =
    list.find((s) => s.name === tab.setup) ?? list.find((s) => s.app === app) ?? list[0];
  if (!setup)
    return setups.data ? (
      <p className="m-0 p-4 text-[13.5px] text-(--ui-ink-2)">No agent setup on this Mac.</p>
    ) : (
      <div className="p-4">
        <Loading shape="rows" lines={3} />
      </div>
    );
  const chat = tab.setup === setup.name ? (tab.chat ?? null) : null;
  const model = (tab.setup === setup.name && tab.model) || setup.model;
  const full = `/${setup.app}/ask?setup=${encodeURIComponent(setup.name)}${chat ? `&chat=${encodeURIComponent(chat)}` : ""}`;
  return (
    <AgentChat
      key={setup.name}
      setup={setup}
      chat={chat}
      model={model}
      page={page}
      className="min-h-0 flex-1"
      head={() => (
        <div className="flex flex-none flex-wrap items-center gap-2 border-(--ui-hair) border-b px-3 py-2">
          {list.length > 1 ? (
            <Seg
              label="Setup"
              dense
              items={list.map((s) => ({ value: s.name, label: s.title }))}
              value={setup.name}
              onChange={(v) => put({ setup: v, chat: null, model: "" })}
            />
          ) : (
            <span className="text-[13px] text-(--ui-ink-2)">{setup.title}</span>
          )}
          <span className="flex-1" />
          <Button
            tone="quiet"
            size="sm"
            icon="plus"
            onClick={() => put({ setup: setup.name, chat: null })}
          >
            New chat
          </Button>
          <ButtonLink
            tone="quiet"
            size="sm"
            icon="expand"
            href={full}
            onClick={onClose}
            {...tipProps("Open on its own page")}
          >
            Full page
          </ButtonLink>
        </div>
      )}
      tools={
        <ModelPick
          setup={setup}
          value={model}
          onChange={(v) => put({ setup: setup.name, model: v })}
        />
      }
      onSession={(id) => put({ setup: setup.name, chat: id })}
      onRunning={onRunning}
    />
  );
}
