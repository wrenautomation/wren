/**
 * A Wren service's handler through the console (`console/call`), as Studio's boxes call it. An
 * action's `requestId` goes beside the call, never inside its input: the Worker makes it the
 * call's idempotency key, so a double press or a retry runs once.
 */
import { call } from "../../api.js";

export function deskCall<T>(
  service: string,
  handler: string,
  input: Record<string, unknown>,
  key?: string,
): Promise<T> {
  const { requestId, ...rest } = input;
  return call<T>("console/call", {
    service,
    handler,
    ...(key ? { key } : {}),
    input: rest,
    ...(typeof requestId === "string" ? { requestId } : {}),
  });
}

/** ContentDesk, the one object Studio's posts go through. */
export const contentDesk = <T>(handler: string, input: Record<string, unknown>) =>
  deskCall<T>("ContentDesk", handler, input, "default");
