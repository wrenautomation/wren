/**
 * Delete a saved template (designs/2026-10-06-workflow-editor.md, step 5): Wren's team takes one
 * off the Marketplace and the Library. The server refuses while any client runs it live and says
 * how many; clients that installed it keep their wiring.
 */
import { Alert, Button } from "@wren/ui";
import { useState } from "react";
import { call, ME_CHANGED } from "../../api.js";

export function DeleteSaved({ id, name, after }: { id: string; name: string; after: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    if (!window.confirm(`Delete ${name}? It leaves the Marketplace. Clients keep their wiring.`))
      return;
    setBusy(true);
    setError(null);
    try {
      await call("console/workflowTemplateDelete", { template: id });
      dispatchEvent(new Event(ME_CHANGED));
      location.assign(after);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  return (
    <div className="grid justify-items-start gap-2">
      <Button size="dense" tone="quiet" busy={busy} disabled={busy} onClick={() => void go()}>
        Delete template
      </Button>
      {error ? <Alert>{error}</Alert> : null}
    </div>
  );
}
