/**
 * A template's page in the Shop (designs/2026-10-07-template-install.md): its parts with their
 * settings and status, its copy, the workflow on the canvas, and Install. Install picks the
 * client, shows the plan, then installs: parts, copy, a draft and a shut door. Nothing sends or
 * spends until a person approves it in To approve. Wren's team installs; a client reads its state.
 */
import type { Port } from "@wren/core/components";
import { Alert, Button, FlowMap, type RecordExtras, Settings, Tag } from "@wren/ui";
import { type ReactNode, useId, useState } from "react";
import { call, ME_CHANGED, type Me } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { FIELD, LIST, QUIET, SELECT, SPLIT } from "../work/bits.js";
import { type Drawn, flowBoxes } from "./boxes.js";

const DOOR = "https://phone.wrenautomation.com/hooks/";

type State = "draft" | "waiting" | "live" | "off";

interface TemplatePart {
  id: string;
  name: string;
  blurb: string;
  effects: string[];
  ready: string;
  settings: Record<string, unknown> | null;
  labels: Record<string, string>;
  accounts: { site: string; label: string; how: string; any: boolean; has: boolean | null }[];
}

/** The plan as the server reads it (`Plan` in @wren/core/templates/install). */
interface Plan {
  template: string;
  kind: "new" | "same" | "update" | "back";
  state: State | null;
  parts: {
    id: string;
    name: string;
    status: "add" | "back" | "have" | "same" | "update" | "kept" | "development";
    accounts: { site: string; label: string; how: string }[];
  }[];
  copy: { ref: string; status: "add" | "have" | "own" | "none" }[];
  draft: "add" | "have" | "edited" | "live";
  door: { status: "add" | "have"; input: string; subject: string } | null;
  effects: string[];
  confirm: string | null;
  changes: number;
}

export interface TemplateDetail {
  template: {
    id: string;
    effects: string[];
    door: { input: string; subject: string } | null;
    /** Saved from a live workflow on the canvas; null for one the code declares. */
    saved?: { by: string; at: string; from: string | null } | null;
    parts: TemplatePart[];
    copy: { ref: string; label: string; file: boolean }[];
  };
  workflow: Drawn & { in: Port[] };
  usedIn: { id: string; name: string }[];
  install: {
    id: number;
    state: State;
    current: boolean;
    by: string;
    at: string;
    approvedBy: string | null;
    approvedAt: string | null;
  } | null;
  plan: Plan | null;
}

const STATE: Record<State, { label: string; tone: "neutral" | "accent" | "green" }> = {
  draft: { label: "Not live yet", tone: "neutral" },
  waiting: { label: "Waiting on approval", tone: "accent" },
  live: { label: "Live", tone: "green" },
  off: { label: "Uninstalled", tone: "neutral" },
};

const PART: Record<Plan["parts"][number]["status"], string> = {
  add: "Installs",
  back: "Goes back on, as you had it",
  have: "Already there, left as is",
  same: "Installed",
  update: "Takes the new settings",
  kept: "Your settings, kept",
  development: "In development, skipped",
};
const COPY: Record<Plan["copy"][number]["status"], string> = {
  add: "Wren's words go in",
  have: "Wren's words",
  own: "Your words, kept",
  none: "No words yet",
};
const DRAFT: Record<Plan["draft"], string> = {
  add: "Saved as a draft",
  have: "Draft saved",
  edited: "Your draft, kept",
  live: "Live",
};
const HEAD: Record<Plan["kind"], string> = {
  new: "Installing does this",
  same: "Installed. Installing again changes nothing.",
  update: "The template changed. Updating does this",
  back: "Installing again puts it back",
};
const EFFECT: Record<string, string> = {
  sends: "sends texts and calls",
  spends: "spends money",
  posts: "posts in public",
};

const changed = () => dispatchEvent(new Event(ME_CHANGED));
const said = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * The part a template is named after is its loop, the part that ties the steps together: it
 * reads "Speed to lead loop", never as the template listing itself.
 */
const partName = (p: { id: string; name: string }, template: string) =>
  p.id === template ? `${p.name} loop` : p.name;
const LOOP = "Ties the steps together and runs them.";

/** Names that keep their capital: "a Meta ad account", never "a meta ad account". */
const NAMES = /^(Meta|Google|Search|Reddit|Instagram)\b/;

/** An account as a person says it: "Phone number" → "a phone number". */
const anAccount = (label: string) => {
  const l = /^[A-Z][a-z]+\b/.test(label) && !NAMES.test(label) ? label.toLowerCase() : label;
  return `${/^[aeiou]/i.test(l) ? "an" : "a"} ${l}`;
};

/**
 * What a part waits on, one wording everywhere: a client reads "Needs your account"; Wren's team
 * reads which ("Needs a phone number"), a setup's step as it's named.
 */
export function needsText(accounts: readonly { site: string; label: string }[], team: boolean) {
  if (!team) return "Needs your account";
  const each = accounts.map((a) =>
    a.site === "any"
      ? `${a.label.charAt(0).toLowerCase()}${a.label.slice(1)}`
      : a.site.includes(".")
        ? a.label
        : anAccount(a.label),
  );
  return `Needs ${each.join(" and ")}`;
}

/** The accounts a part waits on here: each it needs and lacks, then one of its any if none is set. */
const lacking = (p: TemplatePart) => {
  const each = p.accounts.filter((a) => !a.any && a.has === false);
  const any = p.accounts.filter((a) => a.any);
  const none = any.length > 0 && any.every((a) => a.has === false);
  return [
    ...each,
    ...(none
      ? [
          {
            site: "any",
            label: `One of ${any.map((a) => a.label).join(", ")}`,
            how: "Connect any one of them.",
          },
        ]
      : []),
  ];
};

function PartRow({
  p,
  at,
  team,
  template,
}: {
  p: TemplatePart;
  at: (id: string) => string;
  team: boolean;
  template: string;
}) {
  const needs = lacking(p);
  const ready = p.ready === "ready";
  const fields = Object.entries(p.labels).map(([field, label]) => ({ field, label }));
  return (
    <li className="grid gap-2">
      <span className={SPLIT}>
        <a href={at(p.id)} className="min-w-0 font-medium">
          {partName(p, template)}
        </a>
        <Tag tone={needs.length ? "accent" : ready ? "green" : "neutral"}>
          {needs.length ? needsText(needs, team) : ready ? "Ready" : "In development"}
        </Tag>
      </span>
      <span className={QUIET}>{p.id === template ? LOOP : p.blurb}</span>
      <Settings values={p.settings} fields={fields} />
      {needs.map((a) => (
        <span key={a.site} className="text-[13.5px] text-(--ui-ink-2)">
          <b className="font-medium text-(--ui-ink)">{a.label}:</b> {a.how}
        </span>
      ))}
    </li>
  );
}

/** Each client this login works for, to install on; picking one opens its page there. */
function ClientPick({ client, id }: { client: string; id: string }) {
  const uid = useId();
  const me = useCall("me", () => call<Me>("delivery/me"));
  const list = (me.data?.clients ?? []).filter((c) => !c.demo);
  if (list.length < 2) return null;
  return (
    <label htmlFor={uid} className={`${FIELD} max-w-[360px]`}>
      Client
      <select
        id={uid}
        className={SELECT}
        value={client}
        onChange={(e) =>
          location.assign(
            `/marketplace/catalog/${encodeURIComponent(id)}?client=${encodeURIComponent(e.target.value)}`,
          )
        }
      >
        {list.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function PlanList({ plan, copy }: { plan: Plan; copy: TemplateDetail["template"]["copy"] }) {
  const label = (ref: string) => copy.find((c) => c.ref === ref)?.label ?? ref;
  const line = (key: string, name: ReactNode, status: string, warn?: string) => (
    <li key={key} className="grid gap-1">
      <span className={SPLIT}>
        <span className="min-w-0">{name}</span>
        <span className="shrink-0 text-right text-[13.5px] text-(--ui-ink-2)">{status}</span>
      </span>
      {warn ? <span className="text-[13px] text-(--ui-ink-2)">{warn}</span> : null}
    </li>
  );
  return (
    <div className="grid gap-4">
      <ul className={LIST} aria-label="Parts">
        {plan.parts.map((p) =>
          line(
            p.id,
            partName(p, plan.template),
            PART[p.status],
            p.accounts.length && p.status !== "development"
              ? `${needsText(p.accounts, true)}. It installs and waits.`
              : p.id === plan.template
                ? LOOP
                : undefined,
          ),
        )}
        {plan.copy.map((c) => line(c.ref, label(c.ref), COPY[c.status]))}
        {line("draft", "Workflow", DRAFT[plan.draft])}
        {plan.door
          ? line(
              "door",
              "Lead door",
              plan.door.status === "add" ? "Made, shut" : "There",
              "It opens when the workflow is approved.",
            )
          : null}
      </ul>
    </div>
  );
}

/** Install, publish, update and uninstall, for Wren's team in a client's workspace. */
function InstallBox({ d, name, client }: { d: TemplateDetail; name: string; client: string }) {
  const id = d.template.id;
  const uid = useId();
  const [plan, setPlan] = useState<Plan | null>(d.plan);
  const [state, setState] = useState<State | null>(d.install?.state ?? null);
  const [token, setToken] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const again = async () =>
    setPlan(await call<Plan>("console/templatePlan", { client, template: id }));
  const run = async (what: string, fn: () => Promise<string | null>) => {
    setBusy(what);
    setError(null);
    try {
      setNote(await fn());
      await again();
      changed();
    } catch (err) {
      setError(said(err));
    }
    setBusy(null);
  };
  const install = () =>
    run("install", async () => {
      const out = await call<{ state: State; token: string | null; changed: boolean }>(
        "console/templateInstall",
        {
          client,
          template: id,
          ...(plan?.confirm ? { confirm: typed.trim() } : {}),
          ...(plan?.kind === "update" ? { update: true } : {}),
        },
      );
      setState(out.state);
      setToken(out.token);
      setTyped("");
      return out.changed ? null : "Nothing changed.";
    });

  if (!plan) return null;
  const on = state !== null && state !== "off";
  const work = plan.kind !== "same";
  // The name as shown, case aside (the server checks the same: `confirmed`).
  const seen = (v: string) => v.trim().replace(/\s+/g, " ").toLowerCase();
  const ok = !plan.confirm || seen(typed) === seen(plan.confirm);
  const verb =
    plan.kind === "update" ? "Update" : plan.kind === "back" ? "Install again" : "Install";
  return (
    <section aria-label="Install" className="grid gap-4">
      <ClientPick client={client} id={id} />
      {on && state ? (
        <p className="flex flex-wrap items-center gap-2">
          <Tag tone={STATE[state].tone}>{STATE[state].label}</Tag>
          <span className={QUIET}>
            {state === "draft"
              ? "Installed. Nothing runs until it's approved."
              : state === "waiting"
                ? "Waiting in To approve."
                : "Running for this client."}
          </span>
        </p>
      ) : null}
      {work || !on ? (
        <div className="grid gap-3">
          <h3 className="text-[14px] font-semibold">{HEAD[plan.kind]}</h3>
          <PlanList plan={plan} copy={d.template.copy} />
          <p className={QUIET}>Nothing sends or spends until someone approves it in To approve.</p>
          {plan.confirm ? (
            <label htmlFor={uid} className={FIELD}>
              <span>
                It {plan.effects.map((e) => EFFECT[e] ?? e).join(" and ")} once live. Type{" "}
                <b className="font-medium">{plan.confirm}</b> to {verb.toLowerCase()}.
              </span>
              <input
                id={uid}
                className={SELECT}
                value={typed}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setTyped(e.target.value)}
              />
            </label>
          ) : null}
          <div>
            <Button
              size="dense"
              busy={busy === "install"}
              disabled={!ok || busy !== null}
              onClick={() => void install()}
            >
              {verb}
            </Button>
          </div>
        </div>
      ) : null}
      {token ? (
        <div className="grid gap-1 bg-(--ui-wash) p-3">
          <span className="text-[13px] font-medium">Lead door</span>
          <code className="font-mono text-[12.5px] [overflow-wrap:anywhere]">
            {DOOR}
            {token}
          </code>
          <span className="text-[13px] text-(--ui-ink-2)">
            Copy it now. It's shown once. Point the lead form at it. It answers once approved.
          </span>
        </div>
      ) : null}
      {on ? (
        <div className="flex flex-wrap items-center gap-2">
          {state === "draft" ? (
            <Button
              size="dense"
              tone={work ? "secondary" : "primary"}
              busy={busy === "publish"}
              disabled={busy !== null}
              onClick={() =>
                void run("publish", async () => {
                  await call("console/templatePublish", { client, template: id });
                  setState("waiting");
                  return "Asked. It waits in To approve.";
                })
              }
            >
              Ask to go live
            </Button>
          ) : null}
          <Button
            size="dense"
            tone="quiet"
            busy={busy === "uninstall"}
            disabled={busy !== null}
            onClick={() => {
              if (!window.confirm(`Uninstall ${name}? Its loops stop. Data and copy stay.`)) return;
              void run("uninstall", async () => {
                await call("console/templateUninstall", { client, template: id });
                setState("off");
                setToken(null);
                return "Uninstalled. Data, copy and settings stay. Installing again picks them up.";
              });
            }}
          >
            Uninstall
          </Button>
        </div>
      ) : null}
      {note ? <p className={QUIET}>{note}</p> : null}
      {error ? <Alert>{error}</Alert> : null}
    </section>
  );
}

/** What a client sees: where it stands, and who sets it up. */
function ClientState({ state }: { state: State | null }) {
  return state && state !== "off" ? (
    <p className="flex flex-wrap items-center gap-2">
      <Tag tone={STATE[state].tone}>{STATE[state].label}</Tag>
    </p>
  ) : (
    <p className={QUIET}>Wren's team installs it for you.</p>
  );
}

export function templateExtras(
  d: TemplateDetail,
  { row, client, team, can }: PageProps & { row: Record<string, unknown> },
): RecordExtras {
  const name = String(row.name);
  const at = (to: string) =>
    `/marketplace/catalog/${encodeURIComponent(to)}?client=${encodeURIComponent(client)}`;
  const manages = can?.includes("manage") ?? true;
  const saved = d.template.saved;
  const sections: [string, ReactNode][] = [
    [
      "Parts",
      d.template.parts.length ? (
        <ul key="parts" className={LIST}>
          {d.template.parts.map((p) => (
            <PartRow key={p.id} p={p} at={at} team={!!team} template={d.template.id} />
          ))}
        </ul>
      ) : (
        <p key="parts" className="text-(--ui-ink-2)">
          None to install. It runs on the parts the client has.
        </p>
      ),
    ],
  ];
  if (saved)
    sections.unshift([
      "Saved",
      <p key="saved" className="text-(--ui-ink-2)">
        Saved from a live workflow by {saved.by} on {new Date(saved.at).toLocaleDateString()}.
        Installing starts the client's draft from this wiring. A client's own wiring stays.
      </p>,
    ]);
  if (d.template.copy.length)
    sections.push([
      "Copy",
      <ul key="copy" className={LIST}>
        {d.template.copy.map((c) => (
          <li key={c.ref} className={SPLIT}>
            <span className="min-w-0">{c.label}</span>
            <span className="shrink-0 text-[13.5px] text-(--ui-ink-2)">
              {c.file ? "Wren's words" : "No words yet"}
            </span>
          </li>
        ))}
      </ul>,
    ]);
  sections.push([
    "Workflow",
    <FlowMap
      key="workflow"
      boxes={flowBoxes(d.workflow, (n) => (n.uses ? at(n.uses) : undefined))}
      label={`How ${name} runs`}
      fit
    />,
  ]);
  if (d.usedIn.length)
    sections.push([
      "Used in",
      <p key="used">
        {d.usedIn.map((w, i) => (
          <span key={w.id}>
            {i ? ", " : ""}
            <a href={at(w.id)}>{w.name}</a>
          </span>
        ))}
      </p>,
    ]);
  const lead =
    team && manages && d.plan ? (
      <InstallBox d={d} name={name} client={client} />
    ) : (
      <ClientState state={d.install?.state ?? null} />
    );
  return { lead, sections };
}
