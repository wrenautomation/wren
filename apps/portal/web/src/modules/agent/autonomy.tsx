/**
 * One client's dial for the agent (designs/2026-11-11-agent-panel.md, D2), on its record page.
 * Each move saves at once; a refusal puts the old level back and says why.
 */
import { type RiskyAct as Act, type Autonomy, AutonomyDial, LoadFailed, Loading } from "@wren/ui";
import { useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import { ERROR, QUIET } from "../work/bits.js";

/** `agentAutonomy`: as set, and what your own agent runs at. */
interface AutonomyView {
  set: Partial<Record<Act, Autonomy>>;
  yours: Record<Act, Autonomy>;
}

const NAMES: Record<Act, string> = {
  send: "Send",
  spend: "Spend",
  delete: "Delete",
  publish: "Publish",
};

export function ClientAutonomy({ client }: { client: string }) {
  const load = useCall(`autonomy:${client}`, () =>
    call<AutonomyView>("console/agentAutonomy", { client }),
  );
  const [moved, setMoved] = useState<Partial<Record<Act, Autonomy>>>({});
  const [error, setError] = useState<string | null>(null);
  if (load.error && !load.data) return <LoadFailed error={load.error} onRetry={load.retry} />;
  if (!load.data) return <Loading lines={4} />;
  const { set, yours } = load.data;
  const value = { ...yours, ...moved };
  const unset = (Object.keys(yours) as Act[]).filter((a) => !(a in set) && !(a in moved));
  const move = async (act: Act, to: Autonomy) => {
    setError(null);
    setMoved((m) => ({ ...m, [act]: to }));
    try {
      await call("console/agentAutonomySet", { client, change: { [act]: to } });
      load.retry();
    } catch (e) {
      setMoved(({ [act]: _, ...rest }) => rest);
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="grid gap-3">
      <AutonomyDial value={value} onChange={(act, to) => void move(act, to)} />
      {unset.length ? (
        <p className={QUIET}>
          Not set here: {unset.map((a) => NAMES[a]).join(", ")}. Each follows who asks: an admin's
          agent runs Auto, anyone else's asks first.
        </p>
      ) : null}
      {error ? (
        <p className={ERROR} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
