/**
 * The judge agent's line to the Mac: the desk's `claude/ask` (autobrowse `src/claude/service.ts`)
 * through Restate's ingress, so a pass already inside one `ctx.run` can call it. Claude Code on
 * William's plan: $0 a call. While the Mac is off the call waits in Restate under its idempotency
 * key; this side gives up after `timeoutMs` and the next pass, asking the same key, gets the answer.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import { CLAUDE, type ClaudeService } from "../ask.js";
import type { AgentAsk } from "./backends.js";

/** Under the pass's 5 minute budget: a Mac that is off costs a pass at most a few of these. */
const JUDGE_CALL_MS = 90_000;

export function deskJudge(
  ingress: { url: string; headers?: Record<string, string> },
  o: { timeoutMs?: number } = {},
): AgentAsk {
  const claude = clients.connect(ingress).serviceClient<ClaudeService>(CLAUDE);
  return async (req, key) => {
    const r = await claude.ask(
      { ...req, dir: "wren", also: [], commands: [] },
      clients.rpc.opts({ idempotencyKey: key, timeout: o.timeoutMs ?? JUDGE_CALL_MS }),
    );
    return { answer: r.answer, model: r.model, sessionId: r.sessionId };
  };
}
