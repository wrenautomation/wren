/**
 * `wren video storyboard` and `wren video ask` (designs/2026-10-15-storyboard.md): the edit as
 * frames, and a change said in a sentence. The same studio calls as the page's Storyboard
 * (`VideoDesk.propose`, then `set`), so Claude Code, the CLI and the portal change a video alike.
 * `undo` is the page's Undo. The integration test registers this with a fake model.
 */
import { undoVideo } from "@wren/content";
import type { Db } from "@wren/db";
import { applyChange, type ChangeModel, type Proposal, proposeChange } from "@wren/studio/change";
import { getEdit } from "@wren/studio/edit";
import { beatText, storyboardOf, storyboardText } from "@wren/studio/storyboard";
import type { Command } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;
/** The model for `ask`, from its --llm and --fallback. */
export type MakeModel = (o: { llm: string; fallback: string }) => ChangeModel;

const idOf = (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`not a video id: ${v}`);
  return n;
};

/** A proposal as lines: what changes, what's refused, the frames it moves, the patch. */
export function proposalText(p: Proposal): string {
  const moved = [...p.changed.header.map((h) => `header ${h}`), ...p.changed.beats];
  return [
    ...p.changes.map((c) => `- ${c}`),
    ...(p.issues.length ? ["", "Can't apply as it stands:", ...p.issues.map((i) => `  ${i}`)] : []),
    ...p.snapped.map(
      (m) => `short ${m.n}: snapped to whole sentences (start ${m.from}s, end ${m.to}s)`,
    ),
    ...(moved.length ? ["", `Changes on the storyboard: ${moved.join(", ")}`] : []),
    ...(p.changed.gone.length ? [`Gone: ${p.changed.gone.join(", ")}`] : []),
    ...(p.patch ? ["", "Patch (wren video set takes it):", JSON.stringify(p.patch, null, 2)] : []),
  ].join("\n");
}

export function registerVideoAsk(video: Command, withDb: WithDb, makeModel: MakeModel): void {
  video
    .command("storyboard <id>")
    .description(
      "the edit as frames, one per chapter (or run of sentences) and per Short: time, words, on-screen text, layout, cut",
    )
    .option("--json", "the storyboard as JSON")
    .action((v: string, o: { json?: boolean }) =>
      withDb(async (db) => {
        const sb = storyboardOf(await getEdit(db, idOf(v)));
        console.log(o.json ? JSON.stringify(sb, null, 2) : storyboardText(sb));
      }),
    );

  video
    .command("ask <id> <sentence>")
    .description(
      "change the edit in one sentence: the model proposes a patch (wren video set's shape) and a line per change; --apply saves it. Nothing renders",
    )
    .option(
      "--beat <key>",
      "the frame meant, by its key in wren video storyboard (part-2, short-1)",
    )
    .option("--apply", "save the proposal when it checks out (wren video undo takes it back)")
    .option("--json", "the proposal as JSON")
    .option("--llm <spec>", "model for the proposal", "gateway")
    .option(
      "--fallback <spec>",
      'model when the gateway\'s free keys are spent or cooling (paid credits); "none" to fail instead',
      "gateway:cohere",
    )
    .action(
      (
        v: string,
        sentence: string,
        o: { beat?: string; apply?: boolean; json?: boolean; llm: string; fallback: string },
      ) =>
        withDb(async (db) => {
          const id = idOf(v);
          const p = await proposeChange(db, id, sentence, makeModel(o), {
            by: "cli",
            beat: o.beat ?? null,
          });
          if (o.json) console.log(JSON.stringify(p, null, 2));
          else console.log(`${proposalText(p)}\n\n(run ${p.run}${p.model ? `, ${p.model}` : ""})`);
          if (!o.apply) {
            if (p.patch && !p.issues.length && !o.json)
              console.log(`Apply: wren video ask ${id} "${sentence}" --apply`);
            return;
          }
          if (p.issues.length) {
            process.exitCode = 1;
            console.log("Not applied: fix what's refused, or say it another way.");
            return;
          }
          if (!p.patch) {
            console.log("Nothing to apply.");
            return;
          }
          const r = await applyChange(db, id, p, "cli");
          console.log(`video ${id}: applied (run ${r.run}); wren video undo ${id} takes it back`);
          for (const b of [...p.after.beats, ...p.after.shorts].filter((b) =>
            p.changed.beats.includes(b.key),
          ))
            console.log(beatText(b).join("\n"));
        }),
    );

  video
    .command("undo <id>")
    .description(
      "put back the newest change to the edit (a set, cut, word fix, stress or applied ask), as the page's Undo",
    )
    .action((v: string) =>
      withDb(async (db) => {
        const r = await undoVideo(db, idOf(v), "cli");
        console.log(`video ${r.edit.id}: undone (run ${r.run})`);
      }),
    );
}
