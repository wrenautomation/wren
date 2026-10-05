/** Loading a portal call into a component. */
import { useLoad } from "@wren/ui";
import { ApiError } from "./api.js";

export type Load<T> = {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  retry: () => void;
};

/** Every portal call's last answers; each key names its client. */
const PORTAL = {};

/**
 * Run `fn` whenever `key` changes, or on `retry`; the last answer stays on screen while the
 * next loads, and one seen before in this tab shows at once while it refreshes.
 */
export function useCall<T>(key: string, fn: () => Promise<T>): Load<T> {
  return useLoad(
    key,
    () =>
      fn().catch((err: unknown) => {
        throw err instanceof ApiError ? err : new ApiError(String(err), 0);
      }),
    PORTAL,
  ) as Load<T>;
}
