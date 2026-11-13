/**
 * The portal's services (`@wren/portal-routes`), with what the Worker asks of them: a route's
 * permission, whether it writes, whether it sends.
 */

import { needOf, type Permission } from "@wren/core/access";
import { SERVICES } from "@wren/portal-routes";

export { bodyLimit, SERVICES, type Service } from "@wren/portal-routes";

/**
 * The permission a call to `<service>/<route>` needs, which the web hides a button behind
 * (a `wren:` need is the same permission, read in Wren's own workspace). Unknown: undefined.
 */
export function permissionOf(path: string): Permission | undefined {
  const [svc = "", route = ""] = path.split("/");
  const need = SERVICES[svc]?.needs[route];
  return need && needOf(need).permission;
}

/** Where a tab asks how a write went, by its request id (./writes.ts). */
export const WRITE_STATUS_PATH = "/api/writes/status";

/**
 * Whether `<service>/<route>` changes something: the web sends it through `WRITES` (one request
 * id per press, kept until answered), and the Worker runs it once per id.
 */
export function isWrite(path: string): boolean {
  const [svc = "", route = "", ...rest] = path.split("/");
  return !rest.length && Object.hasOwn(SERVICES, svc) && !!SERVICES[svc]?.writes.has(route);
}

/**
 * Sends: writes that reach a person on another platform (a reply, a DM, an answer under a
 * comment). They are accept-then-track: the Worker gives them to Restate and answers at once
 * that it has them; the tab reads the outcome from `writes/status`, never from a held request.
 * A route, or a public handler the console calls by name (`console/call`). Every handler the
 * portal calls whose form says `effect: "sends"` is here (scripts/sends-guard.mjs).
 */
export const SENDS: ReadonlySet<string> = new Set([
  "marketing/inboxReply",
  "sms/reply",
  // A client's Mark posted or Send again on its send that may have gone out.
  "marketing/sendSettle",
]);
export const SEND_HANDLERS: ReadonlySet<string> = new Set([
  "InboxDesk/reply",
  "ReachDesk/reply",
  "ReachDesk/answerComment",
  "ReachDesk/replyInThread",
  "ReachDesk/dmComment",
  // Mark posted or Send again on a send that may have gone out.
  "ReachDesk/settleSend",
  // A yes on an asked reply sends it.
  "InboxDesk/approve",
  // Comments, DMs, invites, likes and follows from Wren's own accounts.
  "ReachDesk/commentThread",
  "ReachDesk/commentPost",
  "ReachDesk/actOnPost",
  "ReachDesk/messagePerson",
  "ReachDesk/messageFrom",
  "ReachDesk/followPerson",
  "ReachDesk/invitePerson",
  "ReachDesk/approveInvites",
  "ReachDesk/withdrawInvite",
]);

/** Whether this call is a send: by its route, or for `console/call` by the handler it names. */
export function isSend(path: string, body?: unknown): boolean {
  if (!isWrite(path)) return false;
  if (SENDS.has(path)) return true;
  if (path !== "console/call" || !body || typeof body !== "object") return false;
  const b = body as { service?: unknown; handler?: unknown; send?: unknown };
  return b.send !== true && SEND_HANDLERS.has(`${String(b.service)}/${String(b.handler)}`);
}
