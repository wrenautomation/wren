/**
 * Setup's one add-on (`Offer.addOn`): the component that fits what this client bought, checked
 * already, with Install and Skip. No catalog here; the marketplace has that. A client asks and
 * Wren's team installs, as on the component's own page.
 */
import type { RecordAnswer } from "@wren/core/records/serve";
import { Alert, Button } from "@wren/ui";
import { useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";

// ponytail: Skip lives in this browser only; a server-side "skipped" when a client has two people.
const skipKey = (client: string, id: string) => `wren.portal.skip.${client}.${id}`;
const skipped = (client: string, id: string) => {
  try {
    return localStorage.getItem(skipKey(client, id)) === "1";
  } catch {
    return false;
  }
};

export function AddOn({
  offered,
  installed,
  props,
}: {
  /** Each bought offer's add-on, newest first. */
  offered: (string | null)[];
  installed: ReadonlySet<string>;
  props: PageProps;
}) {
  const { client } = props;
  const id = offered.find((x): x is string => !!x && !installed.has(x) && !skipped(client, x));
  const got = useCall(`addon:${client}:${id}`, () =>
    id
      ? call<RecordAnswer>("console/recordsGet", { client, record: "console.component", id })
      : Promise.resolve(null),
  );
  const [on, setOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const row = got.data?.row;
  if (!id || gone || !row || row.installed !== "no" || row.ready !== "ready") return null;
  const skip = () => {
    try {
      localStorage.setItem(skipKey(client, id), "1");
    } catch {}
    setGone(true);
  };
  const install = async () => {
    setBusy(true);
    setFailed(null);
    try {
      await call("console/ask", { client, component: id });
      setDone("Asked. Wren will set it up and tell you.");
    } catch (err) {
      setFailed(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  };
  return (
    <section
      aria-label="Recommended"
      className="mb-11 grid max-w-[640px] gap-4 rounded-(--ui-radius) bg-(--ui-paper) p-5 shadow-[inset_0_0_0_1px_var(--ui-hair)]"
    >
      <h2 className="text-[12px] font-semibold tracking-(--ui-label-tracking) text-(--ui-ink-2) [text-transform:var(--ui-label-case)]">
        Recommended
      </h2>
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={on}
          disabled={!!done}
          onChange={(e) => setOn(e.target.checked)}
          className="mt-1 size-4 accent-(--ui-accent)"
        />
        <span className="grid gap-0.5">
          <span className="text-[15px] font-medium">{String(row.name)}</span>
          <span className="text-[14px] text-(--ui-ink-2)">{String(row.blurb)}</span>
        </span>
      </label>
      {done ? (
        <p className="text-[14px] text-(--ui-ink-2)">{done}</p>
      ) : (
        <div className="flex gap-2">
          <Button size="dense" busy={busy} disabled={!on} onClick={() => void install()}>
            {on ? "Install 1 app" : "Install 0 apps"}
          </Button>
          <Button size="dense" tone="secondary" onClick={skip}>
            Skip
          </Button>
        </div>
      )}
      {failed ? <Alert>{failed}</Alert> : null}
    </section>
  );
}
