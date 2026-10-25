/**
 * The shop: every part and every workflow over them as records (`console.component`), each
 * marked installed or not for a client; and the install and configure requests.
 */
import type { Queryable } from "@wren/db";
import { type Client, sendsWords, settingsFor } from "../clients/index.js";
import { ACCOUNTS, CHANNELS, type Component, type Port, STAGES } from "../components.js";
import type { SavedWorkflow, WorkflowVersion } from "../executor.js";
import { inHouseOfPart } from "../in-house.js";
import { accountsLacking, has } from "../installs.js";
import { LOGIC, logicOf, startWith } from "../logic.js";
import type { PortalRequest } from "../portal.js";
import { cued, defineRecord, type RecordType, status, tags, text } from "../records.js";
import type { WorkflowInstall } from "../schema.js";
import { factsLacking, type Setup, setupOf } from "../setup.js";
import { pausedText } from "../setup-alerts.js";
import {
  copyLabel,
  copyRefs,
  defaultsOnce,
  INSTALL_STATE_LABELS,
  type Plan,
  type Template,
} from "../template-install.js";
import { codeLabel } from "../template-labels.js";
import { effectsIn, flowsWith, isMade, partsIn, type Workflow } from "../workflows.js";
import { builtWords, settingsForm, shownSettings } from "./settings.js";

export interface ComponentRequest extends PortalRequest {
  component: string;
}

export interface InstallRequest extends ComponentRequest {
  settings?: unknown;
  /** The component's id, typed in when it has effects. */
  confirm?: string;
}

export const COMPONENT = "console.component";

const neutral = (labels: Readonly<Record<string, string>>) =>
  Object.fromEntries(
    Object.entries(labels).map(([k, label]) => [k, { label, tone: "neutral" as const }]),
  );

const readyOf = (c: Component) => (c.planned ? "planned" : c.ready ? "ready" : "coming");

/** A workflow is as far along as its least built part. */
const flowReady = (parts: readonly Component[]) =>
  (["planned", "coming"] as const).find((s) => parts.some((c) => readyOf(c) === s)) ?? "ready";

const union = <T>(lists: readonly (readonly T[])[]) => [...new Set(lists.flat())];

/** What a part provides, by kind, in its code names: "Services SearchWatch; Loops SearchWatch". */
const providesText = (p: Component["provides"]) =>
  (["services", "loops", "records", "apps"] as const)
    .filter((k) => p[k].length)
    .map((k) => `${k[0]?.toUpperCase()}${k.slice(1)} ${p[k].join(", ")}`)
    .join("; ") || null;

/**
 * The shop: every part in `all` and every workflow over them, each marked installed or not for
 * `client` when there is one (a workflow installs part by part until templates). The detail
 * carries ports, the hypothesis, what's inside and where it's used; the team's adds its settings
 * form, filled from the client's block. What a part provides is a System field, the team's.
 */
export const componentRecord = (
  all: readonly Component[],
  client: Client | null,
  team: boolean,
  workflows: readonly Workflow[] = [],
  /**
   * The client's live saves, why one was left out, and one workflow's draft and versions: the
   * team's, for the canvas's editing.
   */
  saves: {
    saved: Record<string, SavedWorkflow>;
    broken: Record<string, string[]>;
    /** Read on the load's own connection: a second one inside its snapshot can starve the pool. */
    history?: (
      db: Queryable,
      workflow: string,
    ) => Promise<{
      draft: WorkflowVersion | null;
      versions: WorkflowVersion[];
    }>;
    /** The workflows as the code has them, before any save: what a draft is checked over. */
    code?: readonly Workflow[];
  } = {
    saved: {},
    broken: {},
  },
  /**
   * The loop services running now, read when the list is: a part that runs for Wren with every
   * loop stopped reads "Off" to the team. Null or a failed read: no one is marked off.
   */
  running?: () => Promise<ReadonlySet<string>>,
  /**
   * The templates (`templatesNow`: the code's, then the saved ones), the client's installs of them, and
   * the plan of one for the team, read on the load's own connection.
   */
  sold: {
    list: readonly Template[];
    installs: readonly WorkflowInstall[];
    plan?: ((db: Queryable, t: Template) => Promise<Plan>) | undefined;
    /** The facts the client's accounts hold: null with no client. */
    facts?: ReadonlySet<string> | null;
    setups?: readonly Setup[];
    /** The client's installed parts paused on a lost fact: part id to that fact. */
    paused?: ReadonlyMap<string, string> | null;
  } = { list: [], installs: [] },
): RecordType => {
  // A setup is an account's, run from Accounts: never a card in the Shop.
  const flows = workflows.filter((w) => w.kind !== "setup" && (team || w.for === "client"));
  /** "Paused: needs <the step that makes it>" for a part paused on a lost fact; else null. */
  const pausedOf = (id: string | null | undefined): string | null => {
    const fact = id ? sold.paused?.get(id) : undefined;
    return fact ? pausedText(setupOf(fact, sold.setups ?? [])?.step.label ?? fact) : null;
  };
  /** The facts a part needs that this client's accounts don't hold; none with no client. */
  const lacksFacts = (c: Component) => !!sold.facts && factsLacking(c, sold.facts).length > 0;
  /**
   * Each fact a part needs, said as an account ("Needs your account"), with the setup that makes
   * it true: its page links there.
   */
  const factAccounts = (c: Component) =>
    c.requires.facts.map((fact) => {
      const at = setupOf(fact, sold.setups ?? []);
      return {
        site: fact,
        label: at?.step.label ?? fact,
        holds: fact,
        how: at ? at.step.how : "Wren's team sets it up.",
        waits: at && at.step.who !== "client" ? at.step.forYou : null,
        any: false,
        has: sold.facts ? sold.facts.has(fact) : null,
        setup: at ? { id: at.setup.id, name: at.setup.name } : null,
        // The account it's on: that account's row reads "Saved", not "Connected", until it holds.
        of: at?.setup.site ?? null,
      };
    });
  /**
   * A template stands in for the part or workflow it is: one card, never two. A saved one is a
   * card of its own beside its workflow's.
   */
  const soldAs = new Set(sold.list.flatMap((t) => (t.saved ? [] : [t.id, t.workflow.id])));
  const installOf = (t: Template) => sold.installs.find((r) => r.template === t.id) ?? null;
  // A client sees one "In development" for both: built only for Wren, or not built at all.
  const shown = <R extends string>(r: R) => (!team && r === "coming" ? "planned" : r);
  /** A workflow that is a part's inside shows as that part, never twice. */
  const shownAs = (w: Workflow) => all.find((c) => c.inside === w.id) ?? w;
  const named = (id: string) =>
    all.find((x) => x.id === id)?.name ?? flows.find((w) => w.id === id)?.name ?? id;
  const usedIn = (id: string) =>
    flows
      .filter((w) => w.nodes.some((n) => n.uses === id))
      .map((w) => ({ id: shownAs(w).id, name: shownAs(w).name }));
  /**
   * Where the number on `uses`'s out port comes from: the part's own, or, for a workflow, the
   * port of the inner node whose wire feeds it. The team's only: a client's records aren't here.
   */
  const countOf = (uses: string | undefined, port: string, seen = new Set<string>()) => {
    if (!team || !uses || seen.has(uses)) return null;
    seen.add(uses);
    const c = all.find((x) => x.id === uses);
    if (c) return c.out.find((p) => p.id === port)?.count ?? null;
    const f = workflows.find((x) => x.id === uses);
    const [node = "", inner = ""] =
      f?.wires.find((x) => x.to === `out.${port}`)?.from.split(".") ?? [];
    return countOf(f?.nodes.find((n) => n.id === node)?.uses, inner, seen);
  };
  const portsOf = (uses: string | undefined): readonly Port[] =>
    all.find((x) => x.id === uses)?.out ?? workflows.find((x) => x.id === uses)?.out ?? [];
  /**
   * What the canvas's palette may add to `w`: logic nodes and triggers, then parts and workflows
   * from the catalog, a client's workflow only the client's. Each with its ports and effects.
   */
  const paletteFor = (w: Workflow) => ({
    logic: LOGIC.map((l) => ({
      id: l.id,
      name: l.name,
      blurb: l.blurb,
      icon: l.icon,
      group: l.group,
      ready: l.ready,
      effects: l.effects ?? [],
      settings: l.settings,
      start: startWith(l),
    })),
    parts: all
      .filter((c) => w.for === "wren" || c.for === "client")
      .map((c) => ({
        id: c.id,
        name: c.name,
        blurb: c.blurb,
        icon: c.icon,
        stage: c.stage,
        in: c.in,
        out: c.out,
        effects: c.effects,
        ready: readyOf(c),
      })),
    workflows: flows
      .filter(
        (x) =>
          x.id !== w.id &&
          !isMade(x.id) &&
          shownAs(x) === x &&
          (w.for === "wren" || x.for === "client"),
      )
      .map((x) => ({
        id: x.id,
        name: x.name,
        blurb: x.blurb,
        icon: x.icon,
        stage: x.stage,
        in: x.in,
        out: x.out,
        effects: effectsIn(x.id, flows, all),
        ready: flowReady(partsIn(x.id, flows, all)),
      })),
  });
  /**
   * What the canvas's editor opens on: the live save, its draft with what won't run in it, the
   * live versions for History, and the palette.
   */
  const editing = async (db: Queryable, w: Workflow) => {
    const h = saves.history ? await saves.history(db, w.id) : { draft: null, versions: [] };
    const code = saves.code ?? workflows;
    const raw = code.find((x) => x.id === w.id) ?? w;
    const draft = h.draft
      ? {
          ...h.draft,
          problems: h.draft.edits
            ? (flowsWith(code, { [w.id]: h.draft.edits }, all).broken[w.id] ?? [])
            : [],
        }
      : null;
    return {
      // The code's own routed wires: what "Back to built-in" and a version saved as it open on.
      code: { wires: raw.wires.filter((x) => x.via === "events"), steps: [] },
      saved: saves.saved[w.id] ?? null,
      broken: saves.broken[w.id] ?? [],
      draft,
      versions: h.versions,
      palette: paletteFor(w),
      // Save as template: only a workflow that runs for clients; the ones saved from it so far.
      forClients: w.for === "client",
      templates: sold.list
        .filter((t) => t.saved && t.workflow.id === w.id)
        .map((t) => ({ id: t.id, name: t.name, at: t.saved?.at ?? null })),
    };
  };
  /**
   * A workflow's nodes, each with what it uses and its main number's source (its first counted
   * port), and its wires with what moves on each and that number's source, for the drawings.
   */
  const drawn = (w: Workflow) => ({
    id: w.id,
    name: w.name,
    in: w.in,
    out: w.out,
    nodes: w.nodes.map((n) => {
      const l = logicOf(n.uses);
      if (l)
        return {
          id: n.id,
          uses: l.id,
          ...l.ports(n.with ?? {}),
          name: l.name,
          note: n.note ?? l.says(n.with ?? {}),
          ready: l.ready ? "ready" : "planned",
          opens: null,
          count: null,
          with: n.with ?? {},
        };
      const c = all.find((x) => x.id === n.uses);
      const f = workflows.find((x) => x.id === n.uses);
      const main = portsOf(n.uses)
        .map((p) => ({ label: p.label, count: countOf(n.uses, p.id) }))
        .find((p) => p.count);
      const ports = n.own ?? c ?? f;
      return {
        id: n.id,
        uses: n.uses ?? null,
        /** Its ports, for wiring on the canvas. */
        in: ports?.in ?? [],
        out: ports?.out ?? [],
        name: n.own?.name ?? named(n.uses ?? n.id),
        note: n.note ?? (n.own ? "Custom step" : null),
        ready: c ? readyOf(c) : f ? flowReady(partsIn(f.id, flows, all)) : null,
        /** "Paused: needs …": its part waits on a lost fact; the rest of the workflow runs. */
        paused: pausedOf(c?.id),
        /** The workflow it opens into: one it uses, or the part's own steps. */
        opens: f ? f.id : (c?.inside ?? null),
        count: main ? { ...main.count, label: main.label } : null,
        ...(n.with ? { with: n.with } : {}),
      };
    }),
    wires: w.wires.map((x) => {
      const [node = "", port = ""] = x.from.split(".");
      const n = w.nodes.find((y) => y.id === node);
      const uses = n?.uses;
      const outs =
        node === "in"
          ? w.in
          : (n?.own?.out ?? logicOf(uses)?.ports(n?.with ?? {}).out ?? portsOf(uses));
      const label = outs.find((p) => p.id === port)?.label ?? port;
      return { ...x, label, count: node === "in" ? null : countOf(uses, port) };
    }),
  });
  return defineRecord({
    id: COMPONENT,
    app: "marketplace",
    channel: null,
    name: { one: "component", many: "components" },
    rows: async () => {
      const on = team && running ? await running().catch(() => null) : null;
      const off = (c: Component) =>
        !!on &&
        readyOf(c) === "coming" &&
        c.provides.loops.length > 0 &&
        !c.provides.loops.some((l) => on.has(l));
      // Built for clients, but this client hasn't connected an account it needs, or a setup
      // hasn't made a fact it needs true (a lost fact moves an installed part back here too).
      const unconnected = (c: Component) =>
        !!client &&
        c.for === "client" &&
        readyOf(c) === "ready" &&
        ((!has(client, c.id) && accountsLacking(c, client).length > 0) || lacksFacts(c));
      return [
        ...sold.list.map((t) => {
          const parts = t.parts.map((p) => p.part);
          const row = installOf(t);
          const on = !!row && row.state !== "off";
          const behind = parts.filter((c) => !c.ready);
          // Built, but this client hasn't connected an account a part needs: it installs and waits.
          const waits =
            !!client &&
            flowReady(parts) === "ready" &&
            parts.some((c) => accountsLacking(c, client).length > 0 || lacksFacts(c));
          // Installed and a part of it paused on a lost fact: the rest of it keeps running.
          const paused = on ? parts.map((c) => pausedOf(c.id)).find(Boolean) : null;
          return {
            id: t.id,
            type: "template",
            name: t.name,
            blurb: t.blurb,
            icon: t.icon,
            stage: t.workflow.stage,
            channels: union(parts.map((c) => c.channels)).join(",") || null,
            for: "client",
            ready: paused ? "paused" : waits ? "account" : shown(flowReady(parts)),
            installed: client ? (on ? "yes" : "no") : null,
            state: client ? (row?.state ?? null) : null,
            effects: t.effects.join(",") || null,
            instead: null,
            provides: null,
            needs: null,
            missing: paused
              ? `${parts.find((c) => pausedOf(c.id))?.name}: ${paused}`
              : behind.length
                ? `${behind.map((c) => c.name).join(", ")} ${behind.length > 1 ? "aren't" : "isn't"} ready`
                : null,
          };
        }),
        ...all
          .filter((c) => !soldAs.has(c.id))
          .map((c) => ({
            id: c.id,
            type: "part",
            name: c.name,
            blurb: c.blurb,
            icon: c.icon,
            stage: c.stage,
            channels: c.channels.join(",") || null,
            for: c.for,
            ready: off(c)
              ? "off"
              : pausedOf(c.id)
                ? "paused"
                : unconnected(c)
                  ? "account"
                  : shown(readyOf(c)),
            // Wren's own parts are never on a client: no "not installed" for them.
            installed: client && c.for === "client" ? (has(client, c.id) ? "yes" : "no") : null,
            state: null,
            effects: c.effects.join(",") || null,
            // The SaaS it stands in for, quietly: its closest vendor's name only.
            instead: inHouseOfPart(c.id)?.instead[0]?.vendor ?? null,
            provides: team ? providesText(c.provides) : null,
            needs:
              [...c.requires.components, ...c.requires.accounts, ...c.requires.anyAccount].join(
                ", ",
              ) || null,
            missing:
              [
                ...(pausedOf(c.id) ? [pausedOf(c.id) as string] : []),
                ...(off(c)
                  ? [
                      `Off: ${c.provides.loops.map(codeLabel).join(" and ")} ${c.provides.loops.length > 1 ? "are" : "is"} stopped. Start ${c.provides.loops.length > 1 ? "them" : "it"} in Loops`,
                    ]
                  : []),
                ...c.missing,
              ].join("; ") || null,
          })),
        // A made workflow is a row only when it is read by id (its saves load for one get), so
        // the canvas opens it; lists never load saves, so the Shop never shows one.
        ...flows
          .filter((w) => shownAs(w) === w && !soldAs.has(w.id))
          .map((w) => {
            const parts = partsIn(w.id, flows, all);
            const behind = parts.filter((c) => !c.ready);
            return {
              id: w.id,
              type: isMade(w.id) ? "made" : "workflow",
              name: w.name,
              blurb: w.blurb,
              icon: w.icon,
              stage: w.stage,
              channels: union(parts.map((c) => c.channels)).join(",") || null,
              for: w.for,
              ready: shown(flowReady(parts)),
              installed: null,
              state: null,
              effects: effectsIn(w.id, flows, all).join(",") || null,
              instead: null,
              provides: null,
              needs: null,
              missing: behind.length
                ? `${behind.map((c) => c.name).join(", ")} ${behind.length > 1 ? "aren't" : "isn't"} ready`
                : null,
            };
          }),
      ];
    },
    key: "id",
    title: "name",
    subtitle: "blurb",
    fields: {
      name: text("Name"),
      blurb: text("What it does"),
      instead: text("In place of"),
      type: status(
        cued(
          neutral({ template: "Template", part: "Part", workflow: "Workflow", made: "Made here" }),
        ),
        "Type",
      ),
      stage: status(cued(neutral(STAGES)), "Stage"),
      channels: tags(cued(neutral(CHANNELS)), "Channels"),
      ready: status(
        {
          ready: { label: "Ready", tone: "good" },
          // Built and running for Wren, not yet per client: the team sees it run, a client waits.
          coming: team
            ? { label: "Runs for Wren", tone: "good" }
            : { label: "In development", tone: "neutral" },
          planned: { label: "In development", tone: "neutral" },
          // Built per client; waits on an account this client hasn't connected.
          account: { label: "Needs your account", tone: "warn" },
          // Installed, and a fact it needs was lost: it holds until the fact is back.
          paused: { label: "Paused", tone: "warn" },
          // Built, but its loop is stopped: nothing runs until the team starts it.
          ...(team ? { off: { label: "Off", tone: "neutral" as const } } : {}),
        },
        "Status",
      ),
      installed: status(
        {
          yes: { label: "Installed", tone: "good" },
          no: { label: "Not installed", tone: "neutral" },
        },
        "Installed",
      ),
      // A template on this client: installed as a draft, asked, live, or taken off.
      state: status(INSTALL_STATE_LABELS, "Template"),
      effects: tags(
        neutral({ sends: "Sends messages", spends: "Spends money", posts: "Posts publicly" }),
        "Effects",
      ),
      for: status(neutral({ client: "Clients", wren: "Wren's own" }), "For"),
      // Its code names, the team's: services and loops it runs. Folded under System.
      provides: text("Provides", { group: "System" }),
      icon: text("Icon", { group: "System" }),
      // Ids, for the Map's lines; the page says them in words under Needs and Accounts.
      needs: text("Needs", { group: "System" }),
      missing: text("Missing"),
    },
    views: [
      { id: "all", label: "All", sort: "name" },
      ...(client
        ? [{ id: "installed", label: "Installed", where: { installed: "yes" }, sort: "name" }]
        : []),
    ],
    load: async (db, id) => {
      const t = sold.list.find((x) => x.id === id);
      if (t) {
        const row = installOf(t);
        // A saved one draws its own wiring until it's on the client; then the client's.
        const mine = flows.find((x) => x.id === t.workflow.id);
        const w = (t.saved && !row ? t.workflow : mine) ?? t.workflow;
        return {
          template: {
            id: t.id,
            effects: t.effects,
            saved: t.saved ?? null,
            door: t.spec.door ?? null,
            parts: t.parts.map(({ part: c, settings }) => ({
              id: c.id,
              name: c.name,
              blurb: c.blurb,
              effects: c.effects,
              ready: shown(readyOf(c)),
              paused: pausedOf(c.id),
              settings: shownSettings(c, settings),
              labels: Object.fromEntries((settingsForm(c) ?? []).map((f) => [f.field, f.label])),
              accounts: [
                ...c.requires.accounts.map((site) => ({ site, any: false })),
                ...c.requires.anyAccount.map((site) => ({ site, any: true })),
              ]
                .map(({ site, any }) => ({
                  site: site as string,
                  ...ACCOUNTS[site],
                  any,
                  has: client ? !!client.accounts[site] : null,
                }))
                // Facts a setup leaves on an account, read as accounts: "Needs your account".
                .concat(factAccounts(c)),
            })),
            copy: copyRefs(t.copy, defaultsOnce()).map(({ ref, file }) => ({
              ref,
              label: copyLabel(ref),
              file,
            })),
          },
          workflow: drawn(w),
          usedIn: usedIn(t.id),
          // A code template shares its workflow's id: the canvas edits it, so it gets History too.
          ...(team && mine && mine.id === id ? await editing(db, mine) : {}),
          install: row
            ? {
                id: row.id,
                state: row.state,
                current: row.version === t.version,
                by: row.by,
                at: row.at.toISOString(),
                askedBy: row.askedBy,
                approvedBy: row.approvedBy,
                approvedAt: row.approvedAt?.toISOString() ?? null,
              }
            : null,
          plan: team && client && sold.plan ? await sold.plan(db, t) : null,
        };
      }
      const w = flows.find((x) => x.id === id);
      if (w)
        return {
          workflow: drawn(w),
          usedIn: usedIn(id),
          ...(team ? await editing(db, w) : {}),
        };
      const c = all.find((x) => x.id === id);
      if (!c) return null;
      const installed = !!client && has(client, c.id);
      const inside = c.inside ? workflows.find((x) => x.id === c.inside) : undefined;
      return {
        needs: [
          ...c.requires.components.map((id) => ({
            label: named(id),
            has: client ? has(client, id) : null,
          })),
        ],
        // Each account: how the client connects it, what waits on Wren, and its value: the team
        // sees every one, a client its own (a property, a handle), never a login in Wren's browser.
        accounts: [
          ...c.requires.accounts.map((site) => ({ site, any: false })),
          ...c.requires.anyAccount.map((site) => ({ site, any: true })),
        ]
          .map(({ site, any }) => ({
            site: site as string,
            ...ACCOUNTS[site],
            // One of the any is enough: the part needs a channel, not every one.
            any,
            has: client ? !!client.accounts[site] : null,
            ...(client && team ? { account: client.accounts[site] ?? null } : {}),
            ...(client && !team && client.accounts[site] && !ACCOUNTS[site].teamOnly
              ? { account: client.accounts[site] }
              : {}),
          }))
          .concat(factAccounts(c)),
        effects: c.effects,
        paused: pausedOf(c.id),
        // Read-only: only an admin turns a client's sends on, from the CLI.
        sends: client && c.liveSwitch ? sendsWords(client, c.id) : null,
        // Channels it will post on once their apps exist.
        soon: c.soon.map((site) => ACCOUNTS[site].label),
        installed,
        in: c.in,
        out: c.out,
        hypothesis: {
          ...c.hypothesis,
          guesses: c.hypothesis.guesses.map((g) =>
            g.is !== "fixed" && g.built
              ? {
                  ...g,
                  where: builtWords(c, g.built, (to) => all.find((x) => x.id === to)?.name ?? null),
                }
              : g,
          ),
        },
        inside: inside ? drawn(inside) : null,
        usedIn: usedIn(id),
        // The canvas opens a part's inside through the part, and edits it as a workflow.
        ...(team && inside ? await editing(db, inside) : {}),
        ...(team
          ? {
              // Saving goes to Wren's block (`configure` with no client): the part isn't the client's.
              wrenSettings: c.wrenSettings && !installed,
              editor: c.editor,
              form: settingsForm(c, !!client && (installed || !c.wrenSettings)),
              // The block a save writes: the client's when installed, else Wren's (`wren_settings`).
              values: shownSettings(
                c,
                (await settingsFor(db, installed || !c.wrenSettings ? (client?.id ?? null) : null))[
                  c.id
                ],
              ),
            }
          : {}),
      };
    },
  });
};
