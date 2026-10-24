/**
 * Components on a client: install, configure and uninstall a part, a template's plan, install,
 * publish, approve and uninstall, an account connected, and a client's own ask for a part.
 */
import { createDb, serializable, setAuditActor } from "@wren/db";
import { eq } from "drizzle-orm";
import { WREN } from "../../access.js";
import {
  type Client,
  clientUrl,
  settingsFor,
  setWrenSettings,
  updateClient,
} from "../../clients/index.js";
import { ACCOUNT_SITES, type AccountSite, type Component, type LoopKey } from "../../components.js";
import { accountsLacking, blockOf, has, installCheck, withConnected } from "../../installs.js";
import {
  isDemo,
  PortalRefusal,
  type PortalRequest,
  pickClient,
  pickForWrite,
  type SignedViewer,
  seesInternal,
  teamCan,
} from "../../portal.js";
import { finishRun, openRun } from "../../runs.js";
import { workflowInstalls } from "../../schema.js";
import { installDefaults } from "../../template-defaults.js";
import {
  approveInstall,
  askTemplate,
  declineInstall,
  installsOf,
  installTemplate,
  type Plan,
  parseInstallApprovalId,
  readPlan,
  templateNamed,
  uninstallTemplate,
} from "../../template-install.js";
import type { ComponentRequest, InstallRequest } from "../components.js";
import type { ConsoleContext } from "./context.js";
import type { ConnectRequest, IdsRequest, TemplateRequest } from "./requests.js";

export function componentsHandlers(ctx: ConsoleContext) {
  const { main, mainUrl, components, workflows, asked, bound, setups, soldNow, onClientDb, team } =
    ctx;
  const componentOf = (req: ComponentRequest): Component => {
    const c = components.find((x) => x.id === req.component);
    if (!c) throw new PortalRefusal("no such component", 404);
    return c;
  };
  /**
   * One change to a client's components, by an operator, checked first and then a runs row:
   * the block written, or null to remove it.
   */
  const change = async (
    req: ComponentRequest,
    verb: "install" | "configure" | "uninstall",
    check: (c: Component, client: Client) => Record<string, unknown> | null,
  ) => {
    team(req);
    const c = componentOf(req);
    // An operator may pick any client, the demo too: its apps come from its components. A social
    // account it connected by signing in (a TikTok) counts toward what a part needs.
    const client = await withConnected(main, await pickClient(main, req));
    const block = check(c, client);
    const by = (req.viewer as SignedViewer).email;
    const run = await openRun(main, {
      command: `console ${verb} ${c.id}`.slice(0, 64),
      argv: { by, client: client.id, ...(block ? { settings: block } : {}) },
    });
    try {
      await serializable(main, async (tx) => {
        await setAuditActor(tx, by);
        await updateClient(tx, client.id, { products: { [c.id]: block } });
      });
      // The default templates it reads go into the client's database, following the default.
      if (verb === "install" && c.provides.templates.length && mainUrl) {
        const handle = createDb(clientUrl(mainUrl, client), { max: 1, app: "wren-console" });
        try {
          await installDefaults(handle.db, c.provides.templates, { by });
        } finally {
          await handle.close();
        }
      }
    } catch (err) {
      await finishRun(main, run.id, { error: String(err).slice(0, 5000) });
      throw err;
    }
    await finishRun(main, run.id, { ok: true });
    // Every loop the new block lists starts (a running one ignores it); the ones it dropped stop.
    const loopsOf = (b: unknown): LoopKey[] => {
      // A hand-edited old block that no longer parses names no loops.
      const parsed = b === undefined || b === null ? null : c.settings.safeParse(b);
      return parsed?.success
        ? c.clientLoops(client.id, parsed.data as Record<string, unknown>)
        : [];
    };
    const id = (l: LoopKey) => `${l.service} ${l.key}`;
    const start = loopsOf(block).filter((l) => bound(l.service));
    // A loop two parts share (ReachWatch for comments and invites) stops with the last of them.
    const others = components
      .filter((x) => x.id !== c.id && x.id in client.products)
      .flatMap((x) => {
        const parsed = x.settings.safeParse(client.products[x.id]);
        return parsed.success
          ? x.clientLoops(client.id, parsed.data as Record<string, unknown>)
          : [];
      });
    const kept = new Set([...start, ...others].map(id));
    const stop = loopsOf(client.products[c.id]).filter((l) => bound(l.service) && !kept.has(id(l)));
    return { client: client.id, component: c.id, installed: block !== null, start, stop };
  };
  /** New settings over the old: a field left out keeps its value. */
  const merged = (c: Component, old: unknown, settings: unknown) =>
    blockOf(c, { ...(old && typeof old === "object" ? old : {}), ...blockOf(c, settings) });
  /** `configure` for Wren's own run: the team's `wren:manage`, kept in `wren_settings`, a runs row. */
  const configureWren = async (req: InstallRequest, c: Component) => {
    team(req);
    if (!teamCan(req, "manage", WREN)) throw new PortalRefusal("your role can't do that", 403);
    const by = (req.viewer as SignedViewer).email;
    const block = merged(c, (await settingsFor(main, null))[c.id], req.settings);
    const run = await openRun(main, {
      command: `console configure ${c.id}`.slice(0, 64),
      argv: { by, client: WREN, settings: block },
    });
    try {
      await serializable(main, async (tx) => {
        await setAuditActor(tx, by);
        await setWrenSettings(tx, c.id, block, by);
      });
    } catch (err) {
      await finishRun(main, run.id, { error: String(err).slice(0, 5000) });
      throw err;
    }
    await finishRun(main, run.id, { ok: true });
    return { client: WREN, component: c.id, installed: false, start: [], stop: [] };
  };
  return {
    /**
     * A component onto a client: ready, for clients, what it needs already there, settings that
     * parse, and its id typed in when it has effects. The block is stored as given.
     */
    install: (req: InstallRequest) =>
      change(req, "install", (c, client) =>
        installCheck(c, client, { settings: req.settings, confirm: req.confirm }),
      ),
    /** New settings over the old: a field left out keeps its value (a price is never sent). */
    configure: (req: InstallRequest) =>
      // Wren's own run has no client: its block is `wren_settings`.
      componentOf(req).wrenSettings && (!req.client || req.client === WREN)
        ? configureWren(req, componentOf(req))
        : change(req, "configure", (c, client) => {
            if (!has(client, c.id)) throw new PortalRefusal("not installed", 404);
            return merged(c, client.products[c.id], req.settings);
          }),
    /** Off the client; its data stays in the client's database. Refused while another needs it. */
    uninstall: (req: ComponentRequest) =>
      change(req, "uninstall", (c, client) => {
        if (!has(client, c.id)) throw new PortalRefusal("not installed", 404);
        const users = components.filter(
          (o) => has(client, o.id) && o.requires.components.includes(c.id),
        );
        if (users.length)
          throw new PortalRefusal(
            `${users.map((o) => o.name).join(", ")} need${users.length === 1 ? "s" : ""} it: uninstall that first`,
            409,
          );
        return null;
      }),
    /** What installing a template on the client would do, read before anything is written. */
    async templatePlan(req: TemplateRequest): Promise<Plan> {
      team(req);
      const t = templateNamed(await soldNow(), req.template);
      const client = await pickClient(main, req);
      return onClientDb(client, (db) => readPlan(main, db, t, client.id, undefined, setups));
    },
    /**
     * A template onto a client in one go: parts, copy, the draft and its shut door. Installing
     * again changes nothing; after the template moved, `update` applies the plan's changes.
     * Starts nothing: loops start once a person approves it.
     */
    async templateInstall(req: TemplateRequest) {
      team(req);
      const t = templateNamed(await soldNow(), req.template);
      const client = await pickClient(main, req);
      const by = (req.viewer as SignedViewer).email;
      const run = await openRun(main, {
        command: `console template ${t.id}`.slice(0, 64),
        argv: { by, client: client.id, update: req.update === true },
      });
      try {
        const out = await onClientDb(client, (db) =>
          installTemplate(main, db, t, {
            client: client.id,
            by,
            confirm: req.confirm,
            update: req.update === true,
            setups,
          }),
        );
        await finishRun(main, run.id, { ok: true });
        return out;
      } catch (err) {
        await finishRun(main, run.id, { error: String(err).slice(0, 5000) });
        throw err;
      }
    },
    /** Publish: the client's workflow goes to To approve; a person's yes makes it live. */
    async templatePublish(req: TemplateRequest) {
      team(req);
      if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
      const t = templateNamed(await soldNow(), req.template);
      const client = await pickClient(main, req);
      return askTemplate(main, t, { client: client.id, by: (req.viewer as SignedViewer).email });
    },
    /** Off the client: its loops stop, the door shuts; data, copy and saves stay. */
    async templateUninstall(req: TemplateRequest) {
      team(req);
      const sold = await soldNow();
      const t = templateNamed(sold, req.template);
      const client = await pickClient(main, req);
      const out = await uninstallTemplate(
        main,
        t,
        { client: client.id, by: (req.viewer as SignedViewer).email },
        { workflows, components, templates: sold },
      );
      return { ...out, start: [], stop: out.stop.filter((l) => bound(l.service)) };
    },
    /**
     * A person's yes on To approve (`workflow:<id>`): the draft goes live, the door opens, the
     * parts' loops start. Sending needs `effect`, spending `money`, at Wren.
     */
    async templateApprove(req: IdsRequest) {
      team(req);
      if (isDemo(req.viewer)) throw new PortalRefusal("only a person approves", 403);
      const by = (req.viewer as SignedViewer).email;
      const ids = Array.isArray(req.ids) ? req.ids : [];
      if (!ids.length || ids.some((x) => parseInstallApprovalId(x) === null))
        throw new PortalRefusal("nothing picked", 404);
      const done: string[] = [];
      const start: LoopKey[] = [];
      const sold = await soldNow();
      for (const id of ids) {
        const [row] = await main
          .select()
          .from(workflowInstalls)
          .where(eq(workflowInstalls.id, parseInstallApprovalId(id) as number));
        if (!row) throw new PortalRefusal("no such item", 404);
        const t = templateNamed(sold, row.template);
        if (t.effects.some((e) => e !== "spends") && !teamCan(req, "effect", WREN))
          throw new PortalRefusal("it sends: only an admin can make it live", 403);
        if (t.effects.includes("spends") && !teamCan(req, "money", WREN))
          throw new PortalRefusal("it spends: only an admin can make it live", 403);
        const out = await approveInstall(main, id, {
          by,
          workflows,
          components,
          templates: sold,
        });
        done.push(out.id);
        start.push(...out.start.filter((l) => bound(l.service)));
      }
      return { done, start, stop: [] as LoopKey[] };
    },
    /** A person's no: back to a draft, nothing ran. */
    async templateDecline(req: IdsRequest) {
      team(req);
      if (isDemo(req.viewer)) throw new PortalRefusal("only a person declines", 403);
      const ids = Array.isArray(req.ids) ? req.ids : [];
      if (!ids.length) throw new PortalRefusal("nothing picked", 404);
      const done: string[] = [];
      for (const id of ids)
        done.push((await declineInstall(main, id, (req.viewer as SignedViewer).email)).id);
      return { done };
    },
    /** A client's templates and where each stands: the client's page reads it. */
    async templateInstalls(req: PortalRequest) {
      const client = await pickClient(main, req);
      const sold = await soldNow();
      return (await installsOf(main, client.id)).map((r) => {
        const t = sold.find((x) => x.id === r.template);
        return {
          template: r.template,
          name: t?.name ?? r.template,
          state: r.state,
          current: t ? r.version === t.version : false,
          parts: r.applied.added.length,
          at: r.at.toISOString(),
          by: r.by,
        };
      });
    },
    /**
     * One account onto a client, from the Shop: the team's, with `manage` there, audited and a runs
     * row. Empty takes it off, refused while an installed part needs it. Nothing signs in.
     */
    async connect(req: ConnectRequest): Promise<{ client: string; site: string; set: boolean }> {
      team(req);
      const site = ACCOUNT_SITES.find((s) => s === req.site) as AccountSite | undefined;
      if (!site) throw new PortalRefusal("no such account", 404);
      if (typeof req.account !== "string") throw new PortalRefusal("account: text", 400);
      const account = req.account.trim();
      if (account.length > 200) throw new PortalRefusal("account: 200 characters at most", 400);
      const client = await pickClient(main, req);
      if (!account) {
        const rest = { ...client.accounts, [site]: "" };
        const users = components.filter(
          (c) => has(client, c.id) && accountsLacking(c, { accounts: rest }).length > 0,
        );
        if (users.length)
          throw new PortalRefusal(
            `${users.map((c) => c.name).join(", ")} need${users.length === 1 ? "s" : ""} it: uninstall that first`,
            409,
          );
      }
      const by = (req.viewer as SignedViewer).email;
      const run = await openRun(main, {
        command: `console connect ${site}`.slice(0, 64),
        argv: { by, client: client.id, set: !!account },
      });
      try {
        await serializable(main, async (tx) => {
          await setAuditActor(tx, by);
          await updateClient(tx, client.id, { accounts: { [site]: account } }, by);
        });
      } catch (err) {
        await finishRun(main, run.id, { error: String(err).slice(0, 5000) });
        throw err;
      }
      await finishRun(main, run.id, { ok: true });
      return { client: client.id, site, set: !!account };
    },

    /** A client's person asks for a component; installing it stays Wren's call. */
    async ask(req: ComponentRequest): Promise<{ component: string }> {
      if (seesInternal(req)) throw new PortalRefusal("the team installs it instead", 403);
      const { client, viewer } = await pickForWrite(main, req);
      const c = componentOf(req);
      if (c.for !== "client") throw new PortalRefusal("no such component", 404);
      if (has(client, c.id)) throw new PortalRefusal("you have it already", 409);
      if (!asked) throw new PortalRefusal("asking isn't set up here", 503);
      await asked(client, viewer.email, c);
      return { component: c.id };
    },
  };
}
