/** Loading a portal call into a component. */
import { useEffect, useState } from "react";
import { ApiError } from "./api.js";

type State<T> = { data: T | null; error: ApiError | null; loading: boolean };
export type Load<T> = State<T> & { retry: () => void };

/**
 * Run `fn` whenever `key` changes, or on `retry`; the last answer stays on
 * screen while the next loads.
 */
export function useCall<T>(key: string, fn: () => Promise<T>): Load<T> {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: true });
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` names everything `fn` reads; `attempt` asks again.
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, error: null, loading: true }));
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
  }, [key, attempt]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}
