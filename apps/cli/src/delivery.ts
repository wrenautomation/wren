/**
 * `wren --client <id> delivery …`: what we do for a client, as Wren's team.
 * The same domain calls as the portal's composer, on the main database (the
 * delivery schema sits beside the registry). `--by` is who the client sees it
 * from; the audit log still names who ran the command.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import * as restateClients from "@restatedev/restate-sdk-clients";
import { ingressOf, type Settings } from "@wren/config";
import { getClient, listOperators, normalEmail } from "@wren/core/clients";
import type { Db, Queryable } from "@wren/db";
import {
  addAsk,
  addComment,
  addDeliverable,
  type CommentView,
  DELIVERABLE_KINDS,
  type DeliverableKind,
  deliveryHome,
  type Engagement,
  type EngagementView,
  engagementOf,
  hideUpdate,
  markDone,
  postUpdate,
  recordResult,
  slipMilestone,
  startEngagement,
  todayUtc,
} from "@wren/delivery";
import { MAX_FILE_BYTES, newFileKey, s3Files, typeOfName } from "@wren/delivery/files";
import { type DeliveryWatch, WATCH, WATCH_KEY } from "@wren/delivery/restate";
import { seedSample } from "@wren/delivery/sample";
import type { Command } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;
type Opts = { by?: string; engagement?: string };

const idOf = (v: string) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`not an id: ${v}`);
  return n;
};

/** Who it's from: `--by` (an operator), else the only operator there is. */
async function authorOf(db: Db, by: string | undefined): Promise<string> {
  const ops = await listOperators(db);
  if (by) {
    if (!ops.includes(normalEmail(by)))
      throw new Error(`${by} isn't an operator (wren operators list)`);
    return normalEmail(by);
  }
  if (ops.length === 1) return ops[0] as string;
  throw new Error(
    ops.length
      ? `say who it's from: --by ${ops.join(" | ")}`
      : "no operators yet: wren operators add <email>",
  );
}

const thread = (cs: CommentView[]) =>
  cs.map(
    (c) => `      ${c.at.slice(0, 10)} ${c.author}${c.fromWren ? "" : " (client)"}: ${c.body}`,
  );

export function renderEngagement(clientId: string, e: EngagementView): string[] {
  const out = [
    `${clientId} · ${e.offer.name} (#${e.id}) · from ${e.startsOn} · ${e.status}`,
    "steps:",
  ];
  for (const s of e.steps) {
    const moved = s.dueOn !== s.plannedTo ? ` · due ${s.dueOn ?? "-"}: ${s.slipReason ?? ""}` : "";
    const done = s.doneOn ? ` · done ${s.doneOn}` : "";
    out.push(
      `  ${s.state.padEnd(4)}  ${s.key.padEnd(10)} ${s.plannedFrom} → ${s.plannedTo ?? "open"}${moved}${done}`,
    );
  }
  out.push("asks:");
  for (const a of e.asks) {
    const state = a.answeredAt ? `answered by ${a.answeredBy}` : a.overdue ? "OVERDUE" : "open";
    out.push(
      `  #${a.id} ${state} · due ${a.dueOn ?? "-"} · ${a.text}${a.answer ? ` → ${a.answer}` : ""}`,
    );
  }
  out.push("deliverables:");
  for (const d of e.deliverables)
    out.push(
      `  #${d.id} v${d.version} ${d.status}${d.decisionNote ? ` (${d.decisionNote})` : ""} · ${d.title} · ${d.url ?? "file"}`,
      ...thread(d.comments),
    );
  out.push(`results: ${e.results.map((r) => `${r.key} ${r.value ?? "-"}`).join(", ")}`);
  out.push("updates (latest):");
  for (const u of e.updates)
    out.push(
      `  #${u.id} ${u.at.slice(0, 10)} ${u.author}${u.internal ? " [internal]" : ""}${u.hidden ? " [hidden]" : ""}: ${u.body}`,
      ...thread(u.comments),
    );
  return out;
}

export function registerDelivery(program: Command, withMainDb: WithDb, settings: Settings): void {
  const cmd = program
    .command("delivery")
    .description(
      "what we do for a client (needs --client): plan, timeline, deliverables, asks, results",
    );

  /** One change in one transaction, for the --client named, on its engagement. */
  const change = <T>(
    opts: Opts,
    fn: (db: Queryable, e: Engagement, author: string) => Promise<T>,
  ): Promise<T> =>
    withMainDb(async (main) => {
      const id = program.opts<{ client?: string }>().client;
      if (!id) throw new Error("delivery needs --client <id>");
      const client = await getClient(main, id);
      const author = await authorOf(main, opts.by);
      return main.transaction(async (tx) => {
        const e = await engagementOf(
          tx,
          client.id,
          opts.engagement ? idOf(opts.engagement) : undefined,
        );
        return fn(tx, e, author);
      });
    });
  const clientId = () => {
    const id = program.opts<{ client?: string }>().client;
    if (!id) throw new Error("delivery needs --client <id>");
    return id;
  };
  const by = (c: Command) =>
    c.option("--by <email>", "who it's from (an operator; default: the only one)");
  const onEngagement = (c: Command) =>
    by(c).option(
      "--engagement <id>",
      "which engagement, when the client has more than one running",
    );

  by(cmd.command("start <offer>"))
    .description("Start an offer for the client: its plan becomes dated steps, its asks open")
    .requiredOption("--on <date>", "the first day, YYYY-MM-DD")
    .action(async (offerId: string, opts: Opts & { on: string }) => {
      const e = await withMainDb(async (main) => {
        const client = await getClient(main, clientId());
        const author = await authorOf(main, opts.by);
        return main.transaction((tx) =>
          startEngagement(tx, { clientId: client.id, offerId, startsOn: opts.on, by: author }),
        );
      });
      console.log(`started engagement #${e.id}: ${offerId} from ${e.startsOn}`);
    });

  onEngagement(cmd.command("post <text>"))
    .description("A line on the client's timeline")
    .option("--step <key>", "the plan step it belongs to")
    .option("--internal", "Wren's team only; the client never sees it")
    .action(async (text: string, opts: Opts & { step?: string; internal?: boolean }) => {
      const u = await change(opts, (db, e, author) =>
        postUpdate(db, e, { body: text, author, milestone: opts.step, internal: opts.internal }),
      );
      console.log(`posted #${u.id}${u.internal ? " (internal)" : ""}`);
    });

  /** A local file into the client's private folder (D11), with this machine's AWS login. */
  const upload = async (clientId: string, path: string): Promise<string> => {
    if (!settings.filesBucket) throw new Error("WREN_FILES_BUCKET is unset: no files bucket here");
    const type = typeOfName(path);
    if (!type) throw new Error(`not a file type the portal takes: ${basename(path)}`);
    const bytes = await readFile(path);
    if (bytes.length > MAX_FILE_BYTES)
      throw new Error(`files go up to ${MAX_FILE_BYTES / 1024 / 1024} MB`);
    const key = newFileKey(clientId, basename(path));
    await s3Files({ bucket: settings.filesBucket }).put(key, bytes, type);
    return key;
  };

  onEngagement(cmd.command("deliver <title>"))
    .description("Hand something over; the client approves it or asks for changes")
    .option("--link <url>", "a web page (https)")
    .option("--loom <url>", "a Loom video")
    .option("--doc <url>", "a document (https)")
    .option("--file <path>", "a file from this machine (PDF, image, sheet, doc, zip; up to 50 MB)")
    .option("--step <key>", "the plan step it belongs to")
    .option("--replaces <id>", "a new version of that deliverable")
    .action(
      async (
        title: string,
        opts: Opts & {
          link?: string;
          loom?: string;
          doc?: string;
          file?: string;
          step?: string;
          replaces?: string;
        },
      ) => {
        const given = (["link", "loom", "doc", "file"] as const).filter((k) => opts[k]);
        if (given.length !== 1) throw new Error("give one of --link, --loom, --doc, --file");
        const kind = given[0] as DeliverableKind;
        if (!DELIVERABLE_KINDS.includes(kind)) throw new Error(`not a kind: ${kind}`);
        const d = await change(opts, async (db, e, author) =>
          addDeliverable(db, e, {
            title,
            kind,
            url: kind === "file" ? undefined : opts[kind as "link" | "loom" | "doc"],
            fileKey: opts.file ? await upload(e.clientId, opts.file) : undefined,
            milestone: opts.step,
            replaces: opts.replaces ? idOf(opts.replaces) : undefined,
            by: author,
          }),
        );
        console.log(`delivered #${d.id} v${d.version}, waiting on the client`);
      },
    );

  onEngagement(cmd.command("ask <text>"))
    .description("Something we need from the client")
    .option("--due <date>", "YYYY-MM-DD")
    .option("--step <key>", "the plan step it belongs to")
    .action(async (text: string, opts: Opts & { due?: string; step?: string }) => {
      const a = await change(opts, (db, e, author) =>
        addAsk(db, e, { text, dueOn: opts.due, milestone: opts.step, by: author }),
      );
      console.log(`asked #${a.id}${a.dueOn ? `, due ${a.dueOn}` : ""}`);
    });

  onEngagement(cmd.command("done <step>"))
    .description("A plan step is done")
    .option("--on <date>", "YYYY-MM-DD (default: today)")
    .option("--undo", "it isn't done after all")
    .action(async (step: string, opts: Opts & { on?: string; undo?: boolean }) => {
      const m = await change(opts, (db, e) =>
        markDone(db, e, { milestone: step, on: opts.undo ? null : (opts.on ?? todayUtc()) }),
      );
      console.log(m.doneOn ? `${m.key} done ${m.doneOn}` : `${m.key} not done`);
    });

  onEngagement(cmd.command("slip <step>"))
    .description("A step moves: the client sees the new date and why")
    .requiredOption("--to <date>", "the new due date, YYYY-MM-DD")
    .requiredOption("--reason <text>", "why, in a sentence the client reads")
    .action(async (step: string, opts: Opts & { to: string; reason: string }) => {
      const m = await change(opts, (db, e) =>
        slipMilestone(db, e, { milestone: step, to: opts.to, reason: opts.reason }),
      );
      console.log(`${m.key} due ${m.dueOn} (planned ${m.plannedTo ?? "open"})`);
    });

  onEngagement(cmd.command("result <key> <value>"))
    .description("One of the offer's measures so far")
    .option("--note <text>")
    .action(async (key: string, value: string, opts: Opts & { note?: string }) => {
      const n = Number(value);
      await change(opts, (db, e, author) =>
        recordResult(db, e, { key, value: n, note: opts.note, by: author }),
      );
      console.log(`${key} = ${n}`);
    });

  by(cmd.command("comment <text>"))
    .description("Reply in the thread under an update or a deliverable; the client is mailed")
    .option("--update <id>", "the update it's under")
    .option("--deliverable <id>", "the deliverable it's under")
    .action(async (text: string, opts: Opts & { update?: string; deliverable?: string }) => {
      if (!opts.update === !opts.deliverable)
        throw new Error("give one of --update, --deliverable");
      const c = await withMainDb(async (main) => {
        const author = await authorOf(main, opts.by);
        return main.transaction((tx) =>
          addComment(tx, clientId(), {
            on: opts.update
              ? { updateId: idOf(opts.update) }
              : { deliverableId: idOf(opts.deliverable as string) },
            body: text,
            by: author,
            fromWren: true,
          }),
        );
      });
      console.log(`commented #${c.id}`);
    });

  cmd
    .command("hide <updateId>")
    .description("Take an update off the client's timeline (kept on record)")
    .action(async (updateId: string) => {
      await withMainDb((main) => hideUpdate(main, clientId(), idOf(updateId)));
      console.log(`hid #${updateId}`);
    });

  cmd
    .command("status")
    .description("Everything the client's Home shows, plus internal notes")
    .option("--json")
    .action(async (opts: { json?: boolean }) => {
      const id = clientId();
      const home = await withMainDb(async (main) => {
        await getClient(main, id);
        return deliveryHome(main, id, { operator: true });
      });
      if (opts.json) return console.log(JSON.stringify(home, null, 2));
      if (home.engagements.length === 0)
        return console.log(
          `${id}: nothing started (wren --client ${id} delivery start <offer> --on <date>)`,
        );
      for (const e of home.engagements) console.log(renderEngagement(id, e).join("\n"));
    });

  cmd
    .command("sample")
    .description("Reseed the demo's sample project from today (DeliveryWatch does it weekly)")
    .action(async () => {
      const id = await withMainDb((main) =>
        main.transaction((tx) => seedSample(tx, clientId(), todayUtc())),
      );
      console.log(`sample engagement #${id}`);
    });

  // Every client at once, so no --client: `wren delivery watch start`.
  const watch = () =>
    restateClients
      .connect(ingressOf(settings))
      .objectClient<DeliveryWatch>({ name: WATCH }, WATCH_KEY);
  const print = (v: unknown) => console.log(JSON.stringify(v, null, 2));
  const w = cmd
    .command("watch")
    .description("DeliveryWatch: client mail and operator pings, hourly; off until started");
  w.command("status").action(async () => print(await watch().status()));
  w.command("start").action(async () => print(await watch().start()));
  w.command("stop").action(async () => print(await watch().stop()));
  w.command("sync")
    .description("one pass now")
    .action(async () => print(await watch().sync()));
}
