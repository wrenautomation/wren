/**
 * The chat column of Research › Runs (designs/2026-11-04-multi-user-runtime.md, WA-1053;
 * merged 11-10, WA-1106): a Claude agent with the weaver skill, on this Mac's relay. Past chats
 * (only the asker's own) sit in a menu in the head; the model is in the box.
 */
import { AgentChatsMenu, Alert, Empty, Loading, PanelAct, Seg } from "@wren/ui";
import { useFolders } from "../../folders.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { href, navigate } from "../../route.js";
import { AgentChat, ChatTitle, ownerOf } from "../agent/chat.js";
import { relaySessions, relaySetups } from "../agent/connect.js";
import { closeText } from "../agent/thread.js";
import { pageToken } from "../agent/use-agent.js";

export function ChatColumn({
  params,
  who,
  team,
  here,
}: Pick<PageProps, "params" | "team"> & { who: PageProps["who"] | undefined; here: string }) {
  const setups = useCall("agent:setups", () => relaySetups(), { kept: false });
  const mine = (setups.data ?? []).filter((s) => s.app === "research");
  const setup = mine.find((s) => s.name === params.get("setup")) ?? mine[0];
  const chat = params.get("chat");
  // kept on the device: the list paints at once, and reads again behind itself
  const sessions = useCall(setup ? `agent:sessions:${setup.name}` : null, async () =>
    relaySessions(setup?.name ?? "", await pageToken()),
  );
  const filed = useFolders("chat", team);
  const go = (p: Record<string, string | null>, replace = false) =>
    navigate(href(here, p, params), replace);

  if (setups.error && !setups.data) {
    const c = closeText(setups.error);
    return <Alert onRetry={c.retry ? setups.retry : undefined}>{c.text}</Alert>;
  }
  if (!setup)
    return setups.data ? (
      <Empty>No research setup on this Mac's agent.</Empty>
    ) : (
      <Loading shape="rows" lines={4} />
    );

  const rows = sessions.data;
  const model = params.get("model") ?? setup.model;
  const stored = chat ? rows?.find((r) => r.session === chat)?.title : undefined;
  return (
    <AgentChat
      key={setup.name}
      setup={setup}
      chat={chat}
      model={model}
      onModel={(v) => go({ model: v === setup.model ? null : v }, true)}
      owner={ownerOf(who)}
      className="min-h-0 flex-1"
      head={(first) => (
        // the side panel's head: one chat, one set of controls
        <header className="flex min-h-[54px] flex-none flex-wrap items-center gap-1 border-(--ui-hair) border-b py-2 pr-2 pl-4">
          {mine.length > 1 ? (
            <Seg
              label="Setup"
              dense
              items={mine.map((s) => ({ value: s.name, label: s.title }))}
              value={setup.name}
              onChange={(v) => go({ setup: v, chat: null, model: null })}
            />
          ) : null}
          <ChatTitle
            setup={setup.name}
            chat={chat}
            title={stored ?? first ?? (chat ? "Chat" : "New chat")}
            onRenamed={sessions.retry}
            className="flex-1 text-[13.5px]"
          />
          <AgentChatsMenu
            rows={sessions.error && !rows ? [] : (rows ?? undefined)}
            open={chat}
            hrefOf={(r) => href(here, { chat: r.session }, params)}
            onOpen={(r) => navigate(href(here, { chat: r.session }, params))}
            folders={
              filed.folders
                ? { id: `chats:${setup.name}`, ...filed, folders: filed.folders }
                : undefined
            }
          />
          <PanelAct icon="plus" label="New chat" onClick={() => go({ chat: null })} />
        </header>
      )}
      onSession={(id) => {
        if (id !== chat) go({ chat: id }, true);
        sessions.retry();
      }}
      onIdle={sessions.retry}
    />
  );
}
