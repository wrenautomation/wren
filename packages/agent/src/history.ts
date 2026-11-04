/** `History` from the CLI's own session store, through the Agent SDK's session readers. */
import { getSessionInfo, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import type { History } from "./relay.js";

export const sdkHistory: History = {
  info: async (session, dir) => {
    const i = await getSessionInfo(session, { dir });
    return i && { title: i.summary, at: new Date(i.lastModified).toISOString() };
  },
  messages: (session, dir) => getSessionMessages(session, { dir }),
};
