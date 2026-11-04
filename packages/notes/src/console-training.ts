/** Notes handlers: training marks for the drafting model, and words to draft from. */
import { PortalRefusal } from "@wren/core/portal";
import { type NotesApiContext, type Req, str } from "./console-context.js";
import { setTrain, setWorkspaceTrain } from "./store.js";

export function trainingHandlers(notes: NotesApiContext) {
  const { placeOf, byOf, locate } = notes;
  return {
    /** In training exports or not (`wren train export --notes`); off by default. */
    async train(req: Req<{ id?: unknown; on?: unknown }>) {
      const { db, note } = await locate(req, req.id, "owner");
      byOf(req);
      await setTrain(db, note.id, req.on === true);
      return { train: req.on === true };
    },
    /**
     * Words to draft from: the selection, else the whole note. Drafts go to the viewer's own
     * workspace, never the note's home: a Wren note shared to a client drafts for that client.
     */
    async drafting(req: Req<{ id?: unknown; text?: unknown }>) {
      const { note, place } = await locate(req, req.id, "view");
      const by = byOf(req);
      const text = (str(req.text ?? "", 20_000, "the words").trim() || note.text.trim()).slice(
        0,
        20_000,
      );
      if (!text) throw new PortalRefusal("the note is empty", 400);
      return { client: place.client?.id ?? null, text, by };
    },
    /** Every note in this workspace in training exports, or only those opted in. */
    async workspaceTrain(req: Req<{ on?: unknown }>) {
      const by = byOf(req);
      const place = await placeOf(req);
      await setWorkspaceTrain(place.db, req.on === true, by);
      return { train: req.on === true };
    },
  };
}
