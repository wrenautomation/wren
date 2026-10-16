/**
 * A PDF the server draws, saved by the browser: a signed document, an invoice. One button for
 * every page that offers one; the handler answers `{ name, base64 }`.
 */
import { Button } from "@wren/ui";
import { useState } from "react";
import { ApiError, call } from "./api.js";
import { ERROR } from "./modules/work/bits.js";

export function PdfButton({
  handler,
  body,
  label = "Download PDF",
}: {
  handler: string;
  body: Record<string, unknown>;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const get = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await call<{ name: string; base64: string }>(handler, body);
      const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = r.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button size="dense" tone="quiet" busy={busy} onClick={() => void get()}>
        {label}
      </Button>
      {error ? <span className={ERROR}>{error}</span> : null}
    </span>
  );
}
