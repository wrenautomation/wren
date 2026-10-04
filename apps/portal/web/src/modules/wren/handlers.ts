/** Every public wren handler as a form: pick one, fill its boxes, run it, read its answer. */
import { type FormField, HandlerForm, type RecordExtras } from "@wren/ui";
import { createElement } from "react";
import { call } from "../../api.js";
import type { Module } from "../../module.js";

export const handlers: Module = {
  id: "handlers",
  name: "Handlers",
  icon: "play",
  blurb: "Run any handler from a form built from its input.",
  requires: { audience: "team" },
  pages: [
    {
      id: "all",
      label: "Handlers",
      template: "list",
      record: "console.handler",
      empty: {
        forms: "No handler has a form.",
        effects: "No handler spends, sends or posts.",
      },
      extras: (detail, { row }): RecordExtras => {
        const form = (detail as { form?: FormField[] | null } | undefined)?.form ?? null;
        const id = String(row.id);
        const service = String(row.service);
        const handler = String(row.handler);
        return {
          lead: createElement(HandlerForm, {
            key: id,
            id,
            name: handler,
            fields: form,
            keyed: row.kind !== "service",
            effect: typeof row.effect === "string" ? row.effect : null,
            run: (c) =>
              call("console/call", {
                service,
                handler,
                ...(c.key === undefined ? {} : { key: c.key }),
                ...(c.input === undefined ? {} : { input: c.input }),
                ...(c.confirm ? { confirm: c.confirm } : {}),
              }),
          }),
        };
      },
    },
  ],
};
