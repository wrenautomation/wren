/**
 * A component's record, below its fields (what's missing is one): what it takes and gives, what
 * runs inside it, how we expect it to generalize, where it's used, what it needs and provides,
 * and what the viewer may do. Wren's team installs, configures and uninstalls; a client asks.
 * No prices: the server leaves priced settings out of the form. A workflow shows its drawing
 * and where it's used; it installs part by part until templates.
 */
import type { Guess, Hypothesis, Port } from "@wren/core/components";
import {
  Alert,
  Button,
  Facts,
  FlowMap,
  type FormField,
  HandlerForm,
  type RecordExtras,
  Tag,
} from "@wren/ui";
import { type ReactNode, useState } from "react";
import { call, ME_CHANGED } from "../../api.js";
import type { PageProps } from "../../module.js";
import { LIST, QUIET, SPLIT } from "../work/bits.js";
import { type Drawn, flowBoxes } from "./boxes.js";

type Used = { id: string; name: string }[];

interface Part {
  needs: { label: string; has: boolean | null }[];
  effects: string[];
  installed: boolean;
  in: Port[];
  out: Port[];
  hypothesis?: Hypothesis;
  inside: Drawn | null;
  usedIn: Used;
  provides?: Record<"services" | "loops" | "records" | "apps", string[]>;
  form?: FormField[] | null;
  values?: Record<string, unknown> | null;
}

type Detail = Part | { workflow: Drawn; usedIn: Used };

const portsLine = (ps: Port[]) => ps.map((p) => p.label).join(", ") || "Nothing";

const GUESS: Record<Guess["is"], string> = {
  change: "Expect to change",
  needs: "Next use needs",
  fixed: "Stays fixed",
};

/** The hypothesis, a line per guess: what it says, whether the code has it, and its checks. */
function Guesses({ h }: { h: Hypothesis }) {
  return (
    <div className="grid gap-3">
      <p className={QUIET}>Written after: {h.from}.</p>
      <ul className={LIST}>
        {h.guesses.map((g) => {
          const held = g.checked?.filter((c) => c.held).length ?? 0;
          const failed = (g.checked?.length ?? 0) - held;
          return (
            <li key={g.says} className="grid gap-1">
              <span className={SPLIT}>
                <span>{g.says}</span>
                {g.is === "fixed" ? null : (
                  <Tag tone={g.built ? "green" : "neutral"}>{g.built ? "Built" : "Not yet"}</Tag>
                )}
              </span>
              <span className={QUIET}>
                {GUESS[g.is]}
                {g.is !== "fixed" && g.built ? ` · ${g.built}` : ""}
                {held ? ` · held ${held}` : ""}
                {failed ? ` · broke ${failed}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A stored value as its box's text: what `typedOf` reads back as the same value. */
function textOf(f: FormField, v: unknown): string {
  if (v === undefined || v === null) return "";
  if (f.type === "lines" || f.type === "numbers") return Array.isArray(v) ? v.join("\n") : "";
  if (f.type === "json" || typeof v === "object") return JSON.stringify(v, null, 2);
  return String(v);
}

/** The form's boxes, each filled from the stored block (`a.b` read nested). */
const filled = (form: FormField[], values: Record<string, unknown>): FormField[] =>
  form.map((f) => {
    const v = f.field
      .split(".")
      .reduce<unknown>((at, k) => (at as Record<string, unknown>)?.[k], values);
    return v === undefined ? f : { ...f, from: () => textOf(f, v) };
  });

/** One button and what its press answered. */
function Press({ label, run, ask }: { label: string; run: () => Promise<string>; ask?: string }) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const go = async () => {
    if (ask && !window.confirm(ask)) return;
    setBusy(true);
    try {
      setSaid({ ok: true, text: await run() });
    } catch (err) {
      setSaid({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
    setBusy(false);
  };
  return (
    <div className="grid gap-2">
      <div>
        <Button size="dense" tone="secondary" busy={busy} onClick={() => void go()}>
          {label}
        </Button>
      </div>
      {said ? said.ok ? <p className={QUIET}>{said.text}</p> : <Alert>{said.text}</Alert> : null}
    </div>
  );
}

const changed = () => dispatchEvent(new Event(ME_CHANGED));

export function catalogExtras(
  detail: unknown,
  { row, client, team, can }: PageProps & { row: Record<string, unknown> },
): RecordExtras {
  const got = detail as Detail | undefined;
  if (!got) return {};
  const id = String(row.id);
  const name = String(row.name);
  const at = (to: string) =>
    `/marketplace/catalog?client=${encodeURIComponent(client)}&component=${encodeURIComponent(to)}`;
  const usedIn = (u: Used): [string, ReactNode] => [
    "Used in",
    <p key="used">
      {u.map((w, i) => (
        <span key={w.id}>
          {i ? ", " : ""}
          <a href={at(w.id)}>{w.name}</a>
        </span>
      ))}
    </p>,
  ];
  const drawing = (w: Drawn): ReactNode => (
    <FlowMap
      key="inside"
      boxes={flowBoxes(w, (n) => (n.uses ? at(n.uses) : undefined))}
      label={`What runs inside ${w.name}`}
    />
  );
  if ("workflow" in got) {
    const sections: [string, ReactNode][] = [
      ["Inside", drawing(got.workflow)],
      [
        "Takes and gives",
        <Facts
          key="ports"
          items={[
            ["Takes", portsLine(got.workflow.in)],
            ["Gives", portsLine(got.workflow.out)],
          ]}
        />,
      ],
    ];
    if (got.usedIn.length) sections.push(usedIn(got.usedIn));
    return { sections };
  }
  const d = got;
  const installable = row.for === "client" && row.ready === "ready";
  const sections: [string, ReactNode][] = [
    [
      "Takes and gives",
      <Facts
        key="ports"
        items={[
          ["Takes", portsLine(d.in)],
          ["Gives", portsLine(d.out)],
        ]}
      />,
    ],
  ];
  if (d.inside) sections.push(["Inside", drawing(d.inside)]);
  if (d.hypothesis) sections.push(["How it generalizes", <Guesses key="h" h={d.hypothesis} />]);
  if (d.usedIn.length) sections.push(usedIn(d.usedIn));
  if (d.needs.length)
    sections.push([
      "Needs",
      <ul key="needs" className={LIST}>
        {d.needs.map((n) => (
          <li key={n.label} className={SPLIT}>
            <span>{n.label}</span>
            {n.has === null ? null : (
              <Tag tone={n.has ? "green" : "neutral"}>{n.has ? "Set" : "Not yet"}</Tag>
            )}
          </li>
        ))}
      </ul>,
    ]);
  if (d.provides)
    sections.push([
      "Provides",
      <Facts
        key="provides"
        items={Object.entries(d.provides)
          .filter(([, v]) => v.length)
          .map(([k, v]) => [k[0]?.toUpperCase() + k.slice(1), v.join(", ")])}
      />,
    ]);

  // Installs and asks both need `manage`: an admin on the team, an owner on the client.
  const manages = can?.includes("manage") ?? true;
  const lead = !manages ? (
    d.installed ? (
      <p className={QUIET}>Installed.</p>
    ) : null
  ) : team ? (
    !installable ? (
      <p className={QUIET}>
        {row.for === "wren"
          ? "Runs Wren's own business: no client installs it."
          : "Not ready for a client yet."}
      </p>
    ) : (
      <div className="grid gap-6">
        {d.installed && !d.form?.length ? null : (
          <HandlerForm
            key={`${client}/${id}/${d.installed}`}
            id={`component:${client}/${id}`}
            name={id}
            verb={d.installed ? "Save" : "Install"}
            fields={filled(d.form ?? [], d.values ?? {})}
            keyed={false}
            // Saving settings asks no confirm; installing one that acts outside Wren does.
            effect={!d.installed && d.effects.length ? d.effects.join(" and ") : null}
            run={async (c) => {
              const to = d.installed ? "console/configure" : "console/install";
              const out = await call(to, {
                client,
                component: id,
                settings: c.input,
                ...(c.confirm ? { confirm: c.confirm } : {}),
              });
              changed();
              return out;
            }}
          />
        )}
        {d.installed ? (
          <Press
            label="Uninstall"
            ask={`Uninstall ${name}? Its data stays.`}
            run={async () => {
              await call("console/uninstall", { client, component: id });
              changed();
              return "Uninstalled. Its data stays; installing it again picks it back up.";
            }}
          />
        ) : null}
      </div>
    )
  ) : d.installed ? (
    <p className={QUIET}>You have it.</p>
  ) : row.for === "client" ? (
    <Press
      label="Ask for this"
      run={async () => {
        await call("console/ask", { client, component: id });
        return "Asked. Wren will get back to you.";
      }}
    />
  ) : null;

  return { lead, sections };
}
