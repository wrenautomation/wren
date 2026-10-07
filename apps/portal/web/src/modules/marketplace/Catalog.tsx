/**
 * A component's record, below its fields (what's missing is one): what it takes and gives, what
 * runs inside it, how we expect it to generalize, where it's used, what it needs and provides,
 * and what the viewer may do. What it provides (code names) is a System field. Wren's team installs, configures and uninstalls; a client asks.
 * No prices of ours: the server leaves priced settings out of the form. A part we built in place
 * of a SaaS names it, with its public price and the day we read it. A workflow shows its drawing
 * and where it's used; it installs part by part. A template has its own page (./Template.tsx).
 */
import type { Guess, Hypothesis, Port } from "@wren/core/components";
import { inHouseOfPart } from "@wren/core/in-house";
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
import { type TemplateDetail, templateExtras } from "./Template.js";

type Used = { id: string; name: string }[];

/** One account a part needs (`ACCOUNTS` in @wren/core/components), and whether it's set. */
interface Account {
  site: string;
  label: string;
  holds: string;
  how: string;
  waits: string | null;
  /** One of the part's any: a channel it can run on, not one it needs. */
  any: boolean;
  has: boolean | null;
  /** Its value: the team's, in a client's workspace. */
  account?: string | null;
  /** A fact a setup makes ("search_console.service_account_added"): set up on Accounts. */
  setup?: { id: string; name: string } | null;
  /** A fact's account site ("search_console"): that account reads "Saved" until the fact holds. */
  of?: string | null;
}

/** A fact, not an account: its site names it ("number.10dlc_registered"). */
const isFact = (a: Pick<Account, "site">) => a.site.includes(".");

interface Part {
  needs: { label: string; has: boolean | null }[];
  accounts?: Account[];
  effects: string[];
  /** The client's live flag for it, read-only; null when it has none. */
  sends?: string | null;
  /** Channels it will take once their run is built. */
  soon?: string[];
  installed: boolean;
  in: Port[];
  out: Port[];
  hypothesis?: Hypothesis;
  inside: Drawn | null;
  usedIn: Used;
  form?: FormField[] | null;
  values?: Record<string, unknown> | null;
  /** Its settings are Wren's own run's: a save goes to Wren, not this client. */
  wrenSettings?: boolean;
}

type Detail = TemplateDetail | Part | { workflow: Drawn; usedIn: Used };

const portsLine = (ps: Port[]) => ps.map((p) => p.label).join(", ");

/** What it takes and gives, a line each that has any; null when it has neither. */
const ports = (takes: Port[], gives: Port[]): [string, ReactNode] | null => {
  const items: [string, string][] = [];
  if (takes.length) items.push(["Takes", portsLine(takes)]);
  if (gives.length) items.push(["Gives", portsLine(gives)]);
  return items.length ? ["Takes and gives", <Facts key="ports" items={items} />] : null;
};

const GUESS: Record<Guess["is"], string> = {
  change: "Expect to change",
  needs: "Next use needs",
  fixed: "Stays fixed",
};

/** A guess as the server sends it: `where` says `built` in plain words, or null for code only. */
type Said = Guess & { where?: string | null };

/** The hypothesis, a line per guess: what it says, whether the code has it, and its checks. */
function Guesses({ h }: { h: Hypothesis }) {
  return (
    <div className="grid gap-3">
      <p className={QUIET}>Written after: {h.from}.</p>
      <ul className={LIST}>
        {(h.guesses as readonly Said[]).map((g) => {
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
                {g.is !== "fixed" && g.built && g.where ? ` · ${g.where}` : ""}
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

/**
 * The accounts a part needs, each with how the client connects it and what still waits on Wren.
 * In a client's workspace the team saves each one here; a client reads the steps.
 */
function Accounts({
  list,
  client,
  edit,
}: {
  list: Account[];
  client: string;
  /** The team, with `manage`, in a client's workspace. */
  edit: boolean;
}) {
  const each = list.filter((a) => !a.any);
  const any = list.filter((a) => a.any);
  // An account whose setup isn't done yet is saved, not connected: its step below says what's left.
  const pending = new Set(list.filter((a) => isFact(a) && a.has === false).map((a) => a.of));
  return (
    <div className="grid gap-4">
      {each.length ? (
        <AccountList list={each} client={client} edit={edit} pending={pending} />
      ) : null}
      {any.length ? (
        <div className="grid gap-2">
          <p className={QUIET}>Any one of these is enough.</p>
          <AccountList list={any} client={client} edit={edit} pending={pending} />
        </div>
      ) : null}
    </div>
  );
}

/** One account's tag: set up, connected, saved while its setup runs, or not yet. */
function tagOf(a: Account, pending: ReadonlySet<string | null | undefined>) {
  if (!a.has) return { label: "Not yet", tone: "neutral" as const };
  if (isFact(a)) return { label: "Set up", tone: "green" as const };
  return pending.has(a.site)
    ? { label: "Saved", tone: "neutral" as const }
    : { label: "Connected", tone: "green" as const };
}

function AccountList({
  list,
  client,
  edit,
  pending,
}: {
  list: Account[];
  client: string;
  edit: boolean;
  pending: ReadonlySet<string | null | undefined>;
}) {
  return (
    <ul className={LIST}>
      {list.map((a) => {
        const tag = tagOf(a, pending);
        return (
          <li key={a.site} className="grid gap-2">
            <span className={SPLIT}>
              <span className="font-medium">{a.label}</span>
              {a.has === null ? null : <Tag tone={tag.tone}>{tag.label}</Tag>}
            </span>
            {a.has && a.account && !edit && !isFact(a) ? (
              <span className="break-all text-[14px]">{a.account}</span>
            ) : null}
            <span className={QUIET}>{a.how}</span>
            {a.waits ? <span className={QUIET}>Waits on Wren: {a.waits}.</span> : null}
            {isFact(a) ? (
              a.has === false ? (
                <a
                  className="text-[14px] underline underline-offset-2"
                  href={`/account/accounts?client=${encodeURIComponent(client)}`}
                >
                  {a.setup ? `${a.setup.name} on Accounts` : "Set it up on Accounts"}
                </a>
              ) : null
            ) : edit ? (
              <HandlerForm
                key={`${client}/${a.site}/${a.account ?? ""}`}
                id={`connect:${client}/${a.site}`}
                name={a.site}
                verb={a.has ? "Save" : "Connect"}
                keyed={false}
                effect={null}
                fields={[
                  {
                    field: "account",
                    label: a.holds[0]?.toUpperCase() + a.holds.slice(1),
                    optional: true,
                    ...(a.has ? { hint: "Clear it to disconnect." } : {}),
                    ...(a.account ? { from: () => a.account ?? "" } : {}),
                  },
                ]}
                run={async (c) => {
                  const out = await call("console/connect", {
                    client,
                    site: a.site,
                    account: String((c.input as { account?: unknown }).account ?? ""),
                  });
                  changed();
                  return out;
                }}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function catalogExtras(
  detail: unknown,
  props: PageProps & { row: Record<string, unknown> },
): RecordExtras {
  const { row, client, team, can } = props;
  const got = detail as Detail | undefined;
  if (!got) return {};
  if ("template" in got) return templateExtras(got, props);
  const id = String(row.id);
  const name = String(row.name);
  const at = (to: string) =>
    `/marketplace/catalog/${encodeURIComponent(to)}?client=${encodeURIComponent(client)}`;
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
    const sections: [string, ReactNode][] = [["Inside", drawing(got.workflow)]];
    const io = ports(got.workflow.in, got.workflow.out);
    if (io) sections.push(io);
    if (got.usedIn.length) sections.push(usedIn(got.usedIn));
    return { sections };
  }
  const d = got;
  const installable = row.for === "client" && row.ready === "ready";
  const sections: [string, ReactNode][] = [];
  const io = ports(d.in, d.out);
  if (io) sections.push(io);
  const tool = inHouseOfPart(id);
  if (tool)
    sections.push([
      "Instead of",
      <Facts
        key="instead"
        items={tool.instead.map((i) => [
          i.vendor,
          <span key={i.vendor}>
            {i.plan}, {i.price === null ? i.unit : `$${i.price} ${i.unit}`}.{" "}
            <a href={i.url} target="_blank" rel="noreferrer">
              Their pricing
            </a>
            , as of {i.asOf}.
          </span>,
        ])}
      />,
    ]);
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
  // Installs and asks both need `manage`: an admin on the team, an owner on the client.
  const manages = can?.includes("manage") ?? true;
  const atClient = d.accounts?.some((a) => a.has !== null) ?? false;
  const accounts = d.accounts?.length ? (
    <Accounts key="accounts" list={d.accounts} client={client} edit={team && manages && atClient} />
  ) : null;
  // A ready part with one not connected yet: connecting is the next step, so it leads the page.
  // A part in development keeps them below: nothing to connect them to yet.
  const toConnect =
    (row.ready === "account" || row.ready === "ready") &&
    (d.accounts?.some((a) => a.has === false) ?? false);
  if (accounts && !toConnect) sections.push(["Accounts", accounts]);
  if (d.sends)
    sections.push([
      "Sends",
      <p key="sends" className={QUIET}>
        {d.sends}
      </p>,
    ]);
  if (d.soon?.length)
    sections.push([
      "In development",
      <p key="soon" className={QUIET}>
        {d.soon.join(", ")}
      </p>,
    ]);

  const lead = !manages ? (
    d.installed ? (
      <p className={QUIET}>Installed.</p>
    ) : null
  ) : team ? (
    !installable ? (
      d.wrenSettings && d.form?.length ? (
        // Wren's own run reads these from `wren_settings`: no client is sent, so it saves there.
        // Wren's own settings edit one at a time on Loops > Settings, with History and Undo.
        <div className="grid gap-2">
          <p className={QUIET}>Wren's own run uses these settings.</p>
          <Facts
            items={d.form.map((f) => {
              const v = f.field
                .split(".")
                .reduce<unknown>((at, k) => (at as Record<string, unknown>)?.[k], d.values ?? {});
              return [f.label, v === undefined ? "Default" : textOf(f, v) || "None"];
            })}
          />
          <p>
            <a href={`/loops/settings?q=${encodeURIComponent(name)}`}>Change them in Settings</a>
          </p>
        </div>
      ) : row.ready === "account" ? null : (
        // Needing an account says itself: the Accounts block leads the page.
        <p className={QUIET}>
          {row.for === "wren"
            ? "Runs Wren's own business: no client installs it."
            : row.ready === "planned"
              ? "In development."
              : "Not ready for a client yet."}
        </p>
      )
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

  const top =
    accounts && toConnect ? (
      <section className="grid gap-2" aria-label="Accounts">
        <h3 className="text-[13px] font-medium text-(--ui-ink-2)">Accounts</h3>
        {accounts}
      </section>
    ) : null;
  return { lead, sections, top };
}
