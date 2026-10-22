/**
 * Workflows made here (designs/2026-10-09-workflow-builder.md): each one, live or a draft, and
 * the builder. He says what should happen; Claude draws a draft the canvas opens on. Nothing
 * runs until Publish.
 */
import type { MadeWorkflow } from "@wren/core/spine";
import {
  Button,
  FormKept,
  LoadFailed,
  Loading,
  Pill,
  Section,
  say,
  TextField,
  useEditForm,
} from "@wren/ui";
import { useRef, useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import { navigate } from "../../route.js";
import { dayLabel, QUIET } from "../work/bits.js";
import { RowsPanel } from "../work/rows-panel.js";

const MOST = 1000;

/** The canvas on a workflow, the editor open; with `ask`, Claude's first draft on its way. */
export const madeAt = (id: string, client: string | null, ask?: string | null) =>
  `/workflows/canvas?path=${encodeURIComponent(id)}${
    client ? `&client=${encodeURIComponent(client)}` : ""
  }&edit=1${ask ? `&ask=${encodeURIComponent(ask)}` : ""}`;

/** A made workflow as rows: its name opens the canvas; live or draft, its steps and when it was made. */
function MadeRows({ rows, client }: { rows: MadeWorkflow[]; client: string | null }) {
  const state = (m: MadeWorkflow) => (m.live ? (m.draft ? "Live, draft open" : "Live") : "Draft");
  return (
    <RowsPanel<MadeWorkflow>
      rows={rows}
      rowKey={(m) => m.id}
      label="made workflows"
      noun="workflow"
      name={{
        label: "Workflow",
        icon: "text",
        min: 220,
        title: (m) => m.made.name,
        href: (m) => madeAt(m.id, client),
      }}
      columns={[
        {
          key: "state",
          label: "State",
          icon: "selected",
          width: 170,
          phone: true,
          cell: (m) => (
            <Pill color={m.live ? "var(--ui-good)" : "var(--ui-ink-3)"}>{state(m)}</Pill>
          ),
        },
        { key: "steps", label: "Steps", icon: "hash", width: 90, cell: (m) => m.nodes },
        {
          key: "at",
          label: "Made",
          icon: "clock",
          width: 120,
          quiet: true,
          cell: (m) => dayLabel(m.at),
        },
      ]}
    />
  );
}

export function MadeHere({ client }: { client: string | null }) {
  const got = useCall(`workflows-made:${client ?? ""}`, () =>
    call<MadeWorkflow[]>("console/workflowsMade", client ? { client } : {}),
  );
  const form = useEditForm({
    key: `workflow:new:${client ?? "own"}:message`,
    defaults: { message: "" },
  });
  const message = form.watch("message");
  const [busy, setBusy] = useState<"build" | "blank" | null>(null);
  const starting = useRef(false);
  /** One build at a time: Enter twice makes one workflow. False when none was made. */
  const build = async (how: "build" | "blank", words = "") => {
    if (starting.current) return false;
    starting.current = true;
    setBusy(how);
    try {
      const made = await call<{ workflow: string; ask: string | null }>("console/workflowBuild", {
        ...(client ? { client } : {}),
        ...(how === "build" ? { message: words.trim() } : {}),
      });
      navigate(madeAt(made.workflow, client, made.ask));
      return true;
    } catch (err) {
      say.failed(err);
      setBusy(null);
      starting.current = false;
      return false;
    }
  };
  const send = form.onSend((v) => (v.message.trim() ? build("build", v.message) : false));
  const rows = got.data ?? [];
  return (
    <Section title="Made here" className="mt-8">
      <form onSubmit={(e) => void send(e)} className="mb-4 grid gap-2">
        <TextField
          form={form}
          name="message"
          label="New workflow"
          maxLength={MOST}
          placeholder="When a form comes in, text them in 5 minutes; if no reply in a day, email."
          className="gap-1 font-medium"
        />
        <FormKept form={form} />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            tone="primary"
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
            onClick={() => void build("blank")}
          >
            Start blank
          </Button>
          <span className={QUIET}>Claude draws a draft. Nothing runs until you publish it.</span>
        </div>
      </form>
      {got.error && !got.data ? <LoadFailed error={got.error} onRetry={got.retry} /> : null}
      {rows.length ? (
        <MadeRows rows={rows} client={client} />
      ) : got.data ? (
        <p className={`m-0 ${QUIET}`}>Nothing made here. Describe one above.</p>
      ) : got.error ? null : (
        <Loading shape="rows" lines={3} />
      )}
    </Section>
  );
}
