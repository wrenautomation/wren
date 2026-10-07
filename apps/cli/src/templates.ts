/**
 * `wren [--client <id>] templates …`: every channel's copy and every prompt in one store
 * (designs/2026-10-07-templates-live-copy.md). Wren's built-in copy is the defaults tree
 * (`packages/templates/defaults`): `sync` writes each changed file into every database, `install`
 * gives a client the templates its parts need.
 */
import { readFileSync } from "node:fs";
import { getClient } from "@wren/core/clients";
import { lineDiff, unified } from "@wren/core/line-diff";
import { TEMPLATE_KINDS, type TemplateKind } from "@wren/core/slots";
import {
  askPublish,
  listTemplates,
  openedOf,
  parseRef,
  refText,
  reset,
  restore,
  saveDraft,
  TemplateConflict,
  type TemplateRef,
  type TemplateState,
  type TemplateStatus,
  templateState,
  type VersionHead,
  versionsOf,
} from "@wren/core/templates";
import { installDefaults, loadDefaults, syncDefaults } from "@wren/core/templates/defaults";
import { LIBRARY_EDITS } from "@wren/core/templates/edits";
import { clientDatabases, type Db } from "@wren/db";
import { COMPONENTS } from "@wren/worker/components";
import type { Command } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

export interface TemplateDbs {
  /** The command's database: `--client`'s, else main. */
  withDb: WithDb;
  withMainDb: WithDb;
  /** A client database by name, as main's login (sync runs on deploy). */
  onDatabase: <T>(database: string, fn: (db: Db) => Promise<T>) => Promise<T>;
  /** `--client`, when given. */
  client: () => string | undefined;
}

export function registerTemplates(program: Command, dbs: TemplateDbs) {
  const { withDb, withMainDb, onDatabase } = dbs;
  const cmd = program
    .command("templates")
    .description("every channel's copy and every prompt: versions, live and draft");

  cmd
    .command("sync")
    .description(
      "Each changed default file as a default version: main takes every file, each client the templates it has. Runs on deploy; again changes nothing",
    )
    .action(async () => {
      const files = loadDefaults();
      const out: Record<string, unknown> = {
        main: await withMainDb((db) => syncDefaults(db, { only: "all", files })),
      };
      for (const database of await withMainDb(clientDatabases))
        out[database] = await onDatabase(database, (db) =>
          syncDefaults(db, { only: "present", files }),
        );
      console.log(JSON.stringify(out, null, 2));
    });

  cmd
    .command("install")
    .description("Give --client the templates its parts need, following the defaults")
    .action(async () => {
      const id = dbs.client();
      if (!id) throw new Error("install needs --client <id>");
      const client = await withMainDb((db) => getClient(db, id));
      const patterns = COMPONENTS.filter((c) => c.id in client.products).flatMap(
        (c) => c.provides.templates,
      );
      const out = await withDb((db) => installDefaults(db, patterns, { by: "cli" }));
      console.log(JSON.stringify(out, null, 2));
    });

  cmd
    .command("ls [folder]")
    .description("Templates by folder, each with its status and live, draft and waiting versions")
    .option("--kind <kind>", `one kind (${TEMPLATE_KINDS.join(", ")})`)
    .option("--status <status>", `one status (${Object.keys(STATUS_LABEL).join(", ")})`)
    .option("--json", "as JSON")
    .action(
      async (folder: string | undefined, o: { kind?: string; status?: string; json?: boolean }) => {
        if (o.kind && !(TEMPLATE_KINDS as readonly string[]).includes(o.kind))
          throw new Error(`no template kind ${o.kind}`);
        if (o.status && !(o.status in STATUS_LABEL)) throw new Error(`no status ${o.status}`);
        const rows = await withDb((db) =>
          listTemplates(db, {
            ...(folder ? { folder } : {}),
            ...(o.kind ? { kind: o.kind as TemplateKind } : {}),
            ...(o.status ? { status: o.status as TemplateStatus } : {}),
          }),
        );
        // Words come with `get`; the listing stays short.
        if (o.json)
          return console.log(
            JSON.stringify(
              rows.map(({ words: _, ...r }) => r),
              null,
              2,
            ),
          );
        if (!rows.length) return console.log("no templates");
        let at: string | null = null;
        for (const r of rows) {
          if (r.folder !== at) {
            at = r.folder;
            console.log(`${at || "(no folder)"}/`);
          }
          const versions = [
            r.live !== null ? `live ${r.live}` : null,
            r.draft !== null ? `draft ${r.draft}` : null,
            r.waiting !== null ? `waiting ${r.waiting}` : null,
          ].filter(Boolean);
          console.log(
            `  ${refText(r)}  ${STATUS_LABEL[r.status]}${versions.length ? `, ${versions.join(", ")}` : ""}` +
              (r.at ? `  (${r.by ?? "?"}, ${day(r.at)})` : ""),
          );
        }
      },
    );

  cmd
    .command("get <ref>")
    .description(
      "The words (the draft, else live) on stdout; on stderr the number to pass to set --expect",
    )
    .option("--version <n>", "this version's words instead")
    .option("--default", "the newest default's words instead")
    .action(async (text: string, o: { version?: string; default?: boolean }) => {
      const ref = parseRef(text);
      const [state, versions] = await withDb(async (db) => [
        await templateState(db, ref),
        await versionsOf(db, ref),
      ]);
      if (!state) throw new Error(`no template ${text}`);
      const shown = o.default
        ? state.newestDefault
        : o.version !== undefined
          ? (versions.find((v) => v.number === numberOf(o.version as string)) ?? null)
          : openedOf(state);
      if (!shown)
        throw new Error(
          o.default
            ? `${text} has no default`
            : o.version
              ? `${text} has no version ${o.version}`
              : `${text} is empty`,
        );
      process.stdout.write(`${shown.source}\n`);
      const opened = openedOf(state);
      console.error(
        `version ${shown.number}; ${STATUS_LABEL[state.status]}; set --expect ${opened?.number ?? "none"}`,
      );
    });

  cmd
    .command("set <ref> <file>")
    .description(
      "Save a file's words (- for stdin) as a new draft version. --publish makes it live: at once for a prompt, after a person's yes in To approve for copy that sends",
    )
    .requiredOption("--why <text>", "one line: why")
    .requiredOption("--expect <n>", "the version get printed, or none for an empty template")
    .option("--publish", "ask for it to go live")
    .action(
      async (text: string, file: string, o: { why: string; expect: string; publish?: boolean }) => {
        const ref = writable(parseRef(text));
        const words = readFileSync(file === "-" ? 0 : file, "utf8").replace(/\n$/, "");
        const expect = o.expect === "none" ? null : numberOf(o.expect);
        const state = await withDb(async (db) => {
          try {
            await saveDraft(db, ref, words, { by: BY, why: o.why, expect });
          } catch (err) {
            if (!(err instanceof TemplateConflict)) throw err;
            const now = err.current;
            const diff = unified(lineDiff(now?.source ?? "", words), [
              `version ${now?.number ?? "none"} (now)`,
              "yours",
            ]);
            throw new Error(
              `Changed since you opened it: version ${now?.number ?? "none"} is newest now` +
                `${now ? ` (${now.by ?? "?"}, ${day(now.at)})` : ""}.\n${diff || "Its words are yours."}\n` +
                `Save on top with --expect ${now?.number ?? "none"}, or get it again.`,
            );
          }
          return o.publish ? askPublish(db, ref, { by: BY, why: o.why }) : templateState(db, ref);
        });
        console.log(said(state as TemplateState));
      },
    );

  cmd
    .command("diff <ref> [a] [b]")
    .description(
      "Two versions line by line: default against live, else a against what's open, else a against b. A version is its number, live, draft, waiting or default",
    )
    .action(async (text: string, a?: string, b?: string) => {
      const ref = parseRef(text);
      const [state, versions] = await withDb(async (db) => [
        await templateState(db, ref),
        await versionsOf(db, ref),
      ]);
      if (!state) throw new Error(`no template ${text}`);
      const pick = (name: string): VersionHead => {
        const v =
          name === "live"
            ? state.live
            : name === "draft"
              ? state.draft
              : name === "waiting"
                ? state.waiting
                : name === "default"
                  ? state.newestDefault
                  : (versions.find((x) => x.number === numberOf(name)) ?? null);
        if (!v) throw new Error(`${text} has no ${/^\d+$/.test(name) ? `version ${name}` : name}`);
        return v;
      };
      const [x, y] =
        a === undefined
          ? [pick("default"), pick("live")]
          : [pick(a), b === undefined ? (openedOf(state) ?? pick("live")) : pick(b)];
      const out = unified(lineDiff(x.source, y.source), [
        `version ${x.number}`,
        `version ${y.number}`,
      ]);
      console.log(out || `versions ${x.number} and ${y.number} have the same words`);
    });

  cmd
    .command("history <ref>")
    .description(
      "Every version, newest first: number, origin, who, when, why; live, draft and waiting marked",
    )
    .option("--json", "as JSON, words included")
    .action(async (text: string, o: { json?: boolean }) => {
      const ref = parseRef(text);
      const [state, versions] = await withDb(async (db) => [
        await templateState(db, ref),
        await versionsOf(db, ref),
      ]);
      if (!state) throw new Error(`no template ${text}`);
      if (o.json) return console.log(JSON.stringify({ state, versions }, null, 2));
      for (const v of versions) {
        const mark = [
          state.live?.id === v.id ? "live" : null,
          state.draft?.id === v.id ? "draft" : null,
          state.waiting?.id === v.id ? "waiting" : null,
        ].filter(Boolean);
        console.log(
          `${v.number}  ${v.origin}  ${v.by ?? "?"}  ${v.at.toISOString().slice(0, 16).replace("T", " ")}` +
            `${mark.length ? `  [${mark.join(", ")}]` : ""}${v.why ? `  ${v.why}` : ""}`,
        );
      }
    });

  cmd
    .command("restore <ref> <n>")
    .description("A new draft version copying version n; nothing is overwritten")
    .requiredOption("--why <text>", "one line: why")
    .option("--publish", "ask for it to go live, as set does")
    .action(async (text: string, n: string, o: { why: string; publish?: boolean }) => {
      const ref = writable(parseRef(text));
      const state = await withDb(async (db) => {
        await restore(db, ref, numberOf(n), { by: BY, why: o.why });
        return o.publish ? askPublish(db, ref, { by: BY, why: o.why }) : templateState(db, ref);
      });
      console.log(said(state as TemplateState));
    });

  cmd
    .command("reset <ref>")
    .description("Follow the default again: the newest default goes live, later ones follow")
    .requiredOption("--why <text>", "one line: why")
    .action(async (text: string, o: { why: string }) => {
      const ref = writable(parseRef(text));
      const state = await withDb((db) => reset(db, ref, { by: BY, why: o.why }));
      console.log(said(state));
    });
}

/** Who the store records for a CLI write: an agent or a person at the terminal, never an approval. */
const BY = "cli";

const STATUS_LABEL: Record<TemplateStatus, string> = {
  default: "default",
  edited: "edited",
  updated: "default updated",
  waiting: "waiting approval",
  empty: "empty",
};

const day = (d: Date) => d.toISOString().slice(0, 10);

function numberOf(text: string): number {
  if (!/^\d+$/.test(text)) throw new Error(`a version is a number (got ${text})`);
  return Number(text);
}

/**
 * Texts and DMs save on their copy pages, which hold each slot's rules (STOP, length) and hand
 * keyword replies to the provider; the CLI reads them but writes emails, posts and prompts only.
 */
function writable(ref: TemplateRef): TemplateRef {
  if (!LIBRARY_EDITS.has(ref.kind))
    throw new Error(
      `the CLI writes ${[...LIBRARY_EDITS].join(", ")}; ${ref.kind} copy saves on its page in Marketing`,
    );
  return ref;
}

/** One line on where a template stands after a write. */
function said(s: TemplateState): string {
  const parts = [
    s.live ? `live ${s.live.number}` : "nothing live",
    s.draft ? `draft ${s.draft.number}` : null,
    s.waiting ? `waiting ${s.waiting.number} in To approve` : null,
  ].filter(Boolean);
  return `${refText(s)}: ${STATUS_LABEL[s.status]}, ${parts.join(", ")}; next --expect ${openedOf(s)?.number ?? "none"}`;
}
