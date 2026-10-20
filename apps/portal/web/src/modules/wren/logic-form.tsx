/**
 * A logic node's or trigger's settings as a form, and what each trigger hears. The workflow editor's
 * node panel and the Map's advance rules share them.
 */
import { Input, Textarea } from "@wren/ui";
import { useId } from "react";
import { FIELD, SELECT } from "../work/bits.js";
import type { PaletteLogic, With } from "./wiring.js";

/** What a trigger hears, said once in its panel. */
export const TRIGGER_NOTE: Readonly<Record<string, string>> = {
  "trigger.schedule":
    "Fires at each slot once published. Clients keep no time zone yet, so it's set here.",
  "trigger.form": "Each post enters once per email. Its URL comes with Publish.",
  "trigger.reply":
    "Fires when a lead replies to an email, a text or a DM. A lead enters once. A STOP never fires it.",
  "trigger.booking":
    "Fires on each cal.com booking, move or cancel, by the booking webhook. Who booked rides along.",
  "trigger.flag":
    "Fires within the hour a client flag is raised or clears. Only in Wren's own workflows.",
  "trigger.payment":
    "Fires when Stripe says a pay link was paid, refunded or failed, as you pick. In Wren's own workflows, a Wren invoice issued, paid, refunded or past due fires it too. Each fires once per change. The amount and who paid come with it.",
  "trigger.touch":
    "Fires once for each follow, connect, comment, reply, DM, like or mention on a social platform, within a few minutes. Pick the kind, who started it and the platform. Who it was with comes along.",
  "trigger.document":
    "Fires when someone opens, signs or declines a document you sent from Payments → Documents. Who and the total come with it.",
  "logic.code":
    "Runs in a sandbox: no internet, one second, 32 MB. Test this node to run it on a sample event.",
  "trigger.app":
    "Fires within the hour of a change in a client's connected app (Account → Connectors). The person's name, email and phone come with it.",
  "trigger.journey":
    "Fires when a person's journey enters a node of the shape, skips one or is dropped there. Pick the change and, if you like, one node. A node you leave empty means any.",
};

/**
 * A logic node's settings as a form, only those its mode uses. A built-in logic node's change
 * goes in the save; a trigger's is read only when it's the code's.
 */
export function LogicForm({
  logic,
  values,
  set,
}: {
  logic: PaletteLogic;
  values: With;
  set: ((field: string, v: string | number) => void) | null;
}) {
  const base = useId();
  const now = (field: string) =>
    values[field] ?? logic.settings.find((s) => s.field === field)?.start ?? "";
  return (
    <div className="grid gap-2.5">
      {logic.settings.map((s) => {
        if (s.shows && Object.entries(s.shows).some(([f, want]) => String(now(f)) !== want)) {
          return null;
        }
        const v = s.shows ? now(s.field) : (values[s.field] ?? "");
        const at = `${base}-${s.field}`;
        return (
          <label key={s.field} htmlFor={at} className={FIELD}>
            <span>{s.label}</span>
            {s.type === "choice" ? (
              <select
                id={at}
                className={SELECT}
                value={String(v)}
                disabled={!set}
                onChange={(e) => set?.(s.field, e.target.value)}
              >
                {v === "" ? <option value="">Pick one</option> : null}
                {(s.options ?? []).map((o) => (
                  <option key={o} value={o}>
                    {s.labels?.[o] ?? o}
                  </option>
                ))}
              </select>
            ) : s.type === "long" ? (
              <Textarea
                id={at}
                rows={4}
                className="font-mono text-[12px]"
                value={String(v)}
                readOnly={!set}
                placeholder={s.hint}
                onChange={(e) => set?.(s.field, e.target.value)}
              />
            ) : (
              <Input
                id={at}
                type={s.type === "number" ? "number" : "text"}
                value={String(v)}
                readOnly={!set}
                placeholder={s.hint}
                onChange={(e) =>
                  set?.(
                    s.field,
                    s.type === "number" && e.target.value !== ""
                      ? Number(e.target.value)
                      : e.target.value,
                  )
                }
              />
            )}
          </label>
        );
      })}
    </div>
  );
}
