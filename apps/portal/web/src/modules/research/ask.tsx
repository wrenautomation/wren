/**
 * Ask birdwatch (designs/2026-11-04-multi-user-runtime.md, WA-1053): a Claude agent with the
 * birdwatch skill, on this Mac's relay. The page fills the window: past chats on the left (only
 * the asker's own), the chat on the right with the setup at its head and the model in the box.
 */
import { Alert, Button, cx, Empty, Loading, relative, Seg } from "@wren/ui";
import { useState } from "react";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { href, navigate, useRoute } from "../../route.js";
import { AgentChat, ModelPick } from "../agent/chat.js";
import { relaySessions, relaySetups, type SessionRow } from "../agent/connect.js";
import { closeText } from "../agent/thread.js";
import { pageToken } from "../agent/use-agent.js";

export function AskPage({ params }: PageProps) {
  const here = `/${useRoute().path.join("/")}`;
  const setups = useCall("agent:setups", () => relaySetups(), { kept: false });
  const mine = (setups.data ?? []).filter((s) => s.app === "research");
  const setup = mine.find((s) => s.name === params.get("setup")) ?? mine[0];
  const chat = params.get("chat");
  // kept on the device: the list paints at once, and reads again behind itself
  const sessions = useCall(setup ? `agent:sessions:${setup.name}` : null, async () =>
    relaySessions(setup?.name ?? "", await pageToken()),
  );
  const go = (p: Record<string, string | null>, replace = false) =>
    navigate(href(here, p, params), replace);
  // narrow windows: the list folds so the chat keeps the screen
  const [list, setList] = useState(false);

  if (setups.error && !setups.data) {
    const c = closeText(setups.error);
    return (
      <Alert onRetry={c.retry ? setups.retry : undefined} className="max-w-xl">
        {c.text}
      </Alert>
    );
  }
  if (!setup)
    return setups.data ? (
      <Empty>No research setup on this Mac's agent.</Empty>
    ) : (
      <Loading shape="rows" lines={4} />
    );

  const rows = sessions.data ?? [];
  const model = params.get("model") ?? setup.model;
  const stored = chat ? rows.find((r) => r.session === chat)?.title : undefined;
  return (
    <div className="grid min-h-0 flex-1 gap-5 min-[1000px]:grid-cols-[248px_minmax(0,1fr)]">
      <nav aria-label="Chats" className="flex min-h-0 flex-col gap-3 max-[999px]:max-h-[40dvh]">
        <div className="flex gap-2">
          <Button tone="secondary" icon="plus" onClick={() => go({ chat: null })}>
            New chat
          </Button>
          <Button
            tone="quiet"
            icon="list"
            aria-expanded={list}
            className="min-[1000px]:hidden"
            onClick={() => setList(!list)}
          >
            {list ? "Hide chats" : `Chats${rows.length ? ` (${rows.length})` : ""}`}
          </Button>
        </div>
        <div className={cx("flex min-h-0 flex-col", !list && "max-[999px]:hidden")}>
          {sessions.error && !sessions.data ? (
            <Alert onRetry={sessions.retry}>{closeText(sessions.error).text}</Alert>
          ) : sessions.pending ? (
            <Loading shape="rows" lines={4} />
          ) : rows.length ? (
            <ChatList
              rows={rows}
              open={chat}
              hrefOf={(r) => href(here, { chat: r.session }, params)}
            />
          ) : (
            <p className="m-0 px-2 text-[13px] text-(--ui-ink-3)">No chats yet.</p>
          )}
        </div>
      </nav>
      <section className="flex min-h-0 min-w-0 flex-col max-[999px]:h-[calc(100dvh-220px)] max-[999px]:min-h-[420px]">
        <AgentChat
          key={setup.name}
          setup={setup}
          chat={chat}
          model={model}
          head={(first) => (
            <header className="flex min-h-9 flex-wrap items-center gap-3 border-(--ui-hair) border-b pb-3">
              <h1 className="m-0 min-w-0 flex-1 text-[15px] font-semibold text-(--ui-ink) wrap-anywhere">
                {stored ?? first ?? (chat ? "Chat" : "New chat")}
              </h1>
              {mine.length > 1 ? (
                <Seg
                  label="Setup"
                  dense
                  items={mine.map((s) => ({ value: s.name, label: s.title }))}
                  value={setup.name}
                  onChange={(v) => go({ setup: v, chat: null, model: null })}
                />
              ) : null}
            </header>
          )}
          tools={
            <ModelPick
              setup={setup}
              value={model}
              onChange={(v) => go({ model: v === setup.model ? null : v }, true)}
            />
          }
          onSession={(id) => {
            if (id !== chat) go({ chat: id }, true);
            sessions.retry();
          }}
          onIdle={sessions.retry}
        />
      </section>
    </div>
  );
}

/** The asker's chats, newest first; the open one marked. */
function ChatList({
  rows,
  open,
  hrefOf,
}: {
  rows: readonly SessionRow[];
  open: string | null;
  hrefOf: (r: SessionRow) => string;
}) {
  return (
    <ul className="m-0 grid min-h-0 list-none content-start gap-px overflow-y-auto p-0 [scrollbar-width:thin]">
      {rows.map((r) => (
        <li key={r.session}>
          <a
            href={hrefOf(r)}
            aria-current={r.session === open ? "page" : undefined}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              navigate(hrefOf(r));
            }}
            className={cx(
              "grid gap-0.5 rounded-(--ui-radius) px-2.5 py-2 no-underline transition-colors duration-150",
              r.session === open
                ? "bg-(--ui-wash) text-(--ui-ink)"
                : "text-(--ui-ink-2) hover:bg-(--ui-fill) hover:text-(--ui-ink)",
            )}
          >
            <span className="text-[13.5px]/[1.35] wrap-anywhere">{r.title || "Untitled chat"}</span>
            <span className="text-[12px] text-(--ui-ink-3)">{relative(new Date(r.at))}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
