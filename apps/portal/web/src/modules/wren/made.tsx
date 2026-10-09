/**
 * Workflows made here (designs/2026-10-09-workflow-builder.md): each one, live or a draft, and
 * the builder. He says what should happen; Claude draws a draft the canvas opens on. Nothing
 * runs until Publish.
 */
import type { MadeWorkflow } from "@wren/core/spine";
import { Button, Input, LoadFailed, Section, say } from "@wren/ui";
import { type FormEvent, useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import { navigate } from "../../route.js";
import { dayLabel, QUIET } from "../work/bits.js";

const MOST = 1000;

/** The canvas on a workflow, the editor open; with `ask`, Claude's first draft on its way. */
export const madeAt = (id: string, client: string | null, ask?: string | null) =>
  `/workflows/canvas?path=${encodeURIComponent(id)}${
    client ? `&client=${encodeURIComponent(client)}` : ""
  }&edit=1${ask ? `&ask=${encodeURIComponent(ask)}` : ""}`;

export function MadeHere({ client }: { client: string | null }) {
  const got = useCall(`workflows-made:${client ?? ""}`, () =>
    call<MadeWorkflow[]>("console/workflowsMade", client ? { client } : {}),
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"build" | "blank" | null>(null);
  const build = async (how: "build" | "blank", e?: FormEvent) => {
    e?.preventDefault();
    if (how === "build" && !message.trim()) return;
    setBusy(how);
    try {
      const made = await call<{ workflow: string; ask: string | null }>("console/workflowBuild", {
        ...(client ? { client } : {}),
        ...(how === "build" ? { message: message.trim() } : {}),
      });
      navigate(madeAt(made.workflow, client, made.ask));
    } catch (err) {
      say.failed(err);
      setBusy(null);
    }
  };
  const rows = got.data ?? [];
  return (
    <Section title="Made here" className="mt-8">
      <form onSubmit={(e) => build("build", e)} className="mb-4 grid gap-2">
        <label className="grid gap-1 text-[13px] font-medium text-(--ui-ink-2)">
          New workflow
          <Input
            value={message}
            maxLength={MOST}
            placeholder="When a form comes in, text them in 5 minutes; if no reply in a day, email."
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            size="sm"
            busy={busy === "build"}
            disabled={!message.trim() || !!busy}
          >
            Build it
          </Button>
          <Button
            tone="quiet"
            size="sm"
            busy={busy === "blank"}
            disabled={!!busy}
            onClick={() => build("blank")}
          >
            Start blank
          </Button>
          <span className={QUIET}>Claude draws a draft. Nothing runs until you publish it.</span>
        </div>
      </form>
      {got.error && !got.data ? <LoadFailed error={got.error} onRetry={got.retry} /> : null}
      {rows.length ? (
        <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((m) => (
            <li key={m.id}>
              <a
                href={madeAt(m.id, client)}
                className="grid gap-1 border border-(--ui-hair) bg-(--ui-paper) p-3 text-[13.5px] text-(--ui-ink) no-underline hover:border-(--ui-accent)"
              >
                <span className="font-medium">{m.made.name}</span>
                <span className="text-[12.5px] text-(--ui-ink-3)">
                  {m.live ? (m.draft ? "Live, draft open" : "Live") : "Draft"} · {m.nodes}{" "}
                  {m.nodes === 1 ? "step" : "steps"} · {dayLabel(m.at)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : got.data ? (
        <p className={`m-0 ${QUIET}`}>Nothing made here. Describe one above.</p>
      ) : null}
    </Section>
  );
}
