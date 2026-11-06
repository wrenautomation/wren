/** `History` from the CLI's own session store, through the Agent SDK's session readers. */
import { getSessionInfo, getSessionMessages, renameSession } from "@anthropic-ai/claude-agent-sdk";
import type { History } from "./relay.js";
import { readCompacted } from "./transcript.js";

export const sdkHistory: History = {
  info: async (session, dir) => {
    const i = await getSessionInfo(session, { dir });
    // the first ask names a chat; the CLI's `summary` moves to the latest prompt
    if (!i) return undefined;
    return {
      title: i.customTitle ?? i.firstPrompt ?? i.summary,
      at: new Date(i.lastModified).toISOString(),
    };
  },
  // a compacted chat keeps its turns before the boundary, and the boundary itself
  messages: async (session, dir) => readCompacted(session) ?? getSessionMessages(session, { dir }),
  rename: (session, dir, title) => renameSession(session, title, { dir }),
};
