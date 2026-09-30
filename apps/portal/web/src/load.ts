/** Loading a portal call into a component. */
import { useEffect, useState } from "react";
import { ApiError } from "./api.js";

export type Load<T> = { data: T | null; error: ApiError | null; loading: boolean };

/** Run `fn` whenever `key` changes; the last answer stays on screen while the next loads. */
export function useCall<T>(key: string, fn: () => Promise<T>): Load<T> {
  const [state, setState] = useState<Load<T>>({ data: null, error: null, loading: true });
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` names everything `fn` reads.
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    fn().then(
      (data) => live && setState({ data, error: null, loading: false }),
      (err: unknown) =>
        live &&
        setState((s) => ({
          data: s.data,
          error: err instanceof ApiError ? err : new ApiError(String(err), 0),
          loading: false,
        })),
    );
    return () => {
      live = false;
    };
  }, [key]);
  return state;
}
