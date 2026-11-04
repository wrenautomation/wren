/**
 * Ask birdwatch (designs/2026-11-04-multi-user-runtime.md, WA-1053): a Claude agent with the
 * birdwatch skill, on this Mac's relay. Past chats on the left (only the asker's own), the chat on
 * the right. Setup and model pick at the top; the read-only setup asks nothing and changes nothing.
 */
import { AgentThread, Alert, Button, cx, Empty, Loading, relative, Seg } from "@wren/ui";
import { useEffect, useRef } from "react";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { href, navigate, useRoute } from "../../route.js";
import { relaySessions, relaySetups, type SessionRow } from "../agent/connect.js";
import { closeText } from "../agent/thread.js";
import { pageToken, useAgent } from "../agent/use-agent.js";
import { QUIET } from "../work/bits.js";
import { RowsPanel } from "../work/rows-panel.js";

const MODEL: Record<string, string> = { haiku: "Haiku", sonnet: "Sonnet", opus: "Opus" };

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
  return (
    <div className="grid items-start gap-5 min-[1100px]:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
      <div className="grid gap-3">
        <Button
          tone="secondary"
          icon="plus"
          className="justify-self-start"
          onClick={() => go({ chat: null })}
        >
          New chat
        </Button>
        {sessions.error && !sessions.data ? (
          <Alert onRetry={sessions.retry}>{closeText(sessions.error).text}</Alert>
        ) : sessions.pending ? (
          <Loading shape="rows" lines={4} />
        ) : rows.length ? (
          <RowsPanel<SessionRow>
            rows={rows}
            rowKey={(r) => r.session}
            narrow
            label="chats"
            noun="chat"
            open={{ id: chat, onOpen: (r) => go({ chat: r.session }) }}
            name={{
              label: "Chat",
              icon: "chat",
              title: (r) => r.title || "Untitled chat",
              href: (r) => href(here, { chat: r.session }, params),
              sub: (r) => (
                <span className={cx("text-[12px]", QUIET)}>{relative(new Date(r.at))}</span>
              ),
            }}
            columns={[]}
          />
        ) : (
          <Empty>No chats yet. Ask something to start one.</Empty>
        )}
      </div>
      <Chat
        key={setup.name}
        setup={setup.name}
        chat={chat}
        model={params.get("model") ?? setup.model}
        header={
          <div className="flex flex-wrap items-center gap-3">
            {mine.length > 1 ? (
              <Seg
                label="Setup"
                dense
                items={mine.map((s) => ({ value: s.name, label: s.title }))}
                value={setup.name}
                onChange={(v) => go({ setup: v, chat: null, model: null })}
              />
            ) : null}
            <Seg
              label="Model"
              dense
              items={setup.models.map((m) => ({ value: m, label: MODEL[m] ?? m }))}
              value={params.get("model") ?? setup.model}
              onChange={(v) => go({ model: v === setup.model ? null : v }, true)}
            />
            <span className="text-[12.5px] text-(--ui-ink-3)">Tools: {setup.tools.join(", ")}</span>
          </div>
        }
        onSession={(id) => {
          if (id !== chat) go({ chat: id }, true);
          sessions.retry();
        }}
        onIdle={sessions.retry}
      />
    </div>
  );
}

function Chat({
  setup,
  chat,
  model,
  header,
  onSession,
  onIdle,
}: {
  setup: string;
  chat: string | null;
  model: string;
  header: React.ReactNode;
  onSession: (id: string) => void;
  /** A turn ended: the chat's title and time change in the list. */
  onIdle: () => void;
}) {
  const a = useAgent({ setup, session: chat, model, onSession });
  const was = useRef(a.running);
  const idle = useRef(onIdle);
  idle.current = onIdle;
  useEffect(() => {
    if (was.current && !a.running) idle.current();
    was.current = a.running;
  }, [a.running]);
  return (
    <section className="grid h-[calc(100dvh-180px)] min-h-[420px] min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-3 rounded-(--ui-leaf-panel) bg-(--ui-paper) px-5 py-[18px] shadow-(--ui-raise)">
      {header}
      {a.loading ? (
        <Loading shape="rows" lines={3} />
      ) : (
        <AgentThread
          className="[animation:ui-fade_.2s_both]"
          stale={a.stale}
          messages={a.messages}
          running={a.running}
          starting={a.starting}
          error={a.error}
          onSend={a.send}
          onStop={a.stop}
          onAnswer={a.answer}
          placeholder="Ask a research question"
          empty={
            <p className="m-0 max-w-prose text-[14px] text-(--ui-ink-2)">
              Ask a question. The agent plans the research with birdwatch, runs it, and answers with
              sources. Each step shows here as it runs.
            </p>
          }
        />
      )}
    </section>
  );
}
