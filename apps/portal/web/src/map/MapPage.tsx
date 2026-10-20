/**
 * The Map (designs/2026-10-19-business-map.md, "Map page"): the shape of the workspace drawn down
 * the page, each wire a ribbon as wide as the people who crossed it in the window. It is the whole
 * page, edge to edge, in the app's own theme. Hover a node for its numbers, click for its details,
 * double click to open the app that manages it. Details, History and the edit panels are cards over
 * the canvas; none of them takes room from it.
 *
 * Edit mode (`?edit=1`, for a login that may act on the shape): drag a part from the palette, join
 * nodes by their handles, edit a node or a line in a card, and save the draft as the next version.
 * The draft lives on this device until it saves (`Edit.tsx`).
 */

import {
  Alert,
  Button,
  canAt,
  Graph,
  type GraphEdit,
  Icon,
  LoadFailed,
  Loading,
  PaletteDrawer,
  type PaletteGroup,
  SELECT_CLASS,
  Segmented,
} from "@wren/ui";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { call } from "../api.js";
import { type PageProps, WREN } from "../module.js";
import { atOf } from "../modules/deals/board.js";
import { go, href, navigate } from "../route.js";
import { DraftBar, DraftConflict, SaveDialog, useAltKey, useShapeDraft } from "./Draft.js";
import { diffGraph } from "./diff.js";
import { EdgeEdit, NodeEdit } from "./EditPanel.js";
import type { Kind } from "./edit.js";
import { addNode, connect, edgeBetween, KINDS, reasonFor, renameNode } from "./edit.js";
import { fileNameOf, saveText } from "./file.js";
import { History, useDiff } from "./History.js";
import { ImportDialog } from "./Import.js";
import { graphOf, LOOK, type MapData, WINDOWS, type Window, windowOf } from "./model.js";
import { NodePanel } from "./NodePanel.js";
import { AT_LEFT } from "./overlay.js";
import { useMap } from "./read.js";
import { opensOf } from "./routes.js";

/** The palette: the four parts a shape is made of. */
const PARTS: readonly PaletteGroup[] = [
  {
    title: "Parts of a shape",
    entries: KINDS.map((k) => ({
      id: k.kind,
      name: k.title,
      blurb: k.blurb,
      ready: true,
      effects: [],
      tint: LOOK[k.kind].tint,
      glyph: k.glyph,
    })),
  },
];

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** A workspace with no shape: the parts a shape has, and the start from Wren's own. */
function NoShape({
  mayStart,
  at,
  onStarted,
}: {
  mayStart: boolean;
  at: Record<string, string>;
  onStarted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    setRefused(null);
    try {
      await call("pipeline/shapeStart", at);
      onStarted();
    } catch (err) {
      setRefused(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex max-w-xl flex-col items-start gap-4 p-8 text-[14.5px] text-(--ui-ink-2)">
      <p>No shape yet. A shape is the road from first contact to money.</p>
      <ul aria-label="Parts of a shape" className="flex list-none flex-wrap gap-2">
        {KINDS.map((k) => (
          <li
            key={k.kind}
            aria-disabled="true"
            className="rounded-md border border-dashed border-(--ui-hair) px-3 py-1.5 text-(--ui-ink-3)"
          >
            {k.title}
          </li>
        ))}
      </ul>
      <Button
        tone="primary"
        size="sm"
        disabled={!mayStart}
        busy={busy}
        onClick={() => void start()}
      >
        Start from Wren's shape
      </Button>
      {mayStart ? null : (
        <p className="text-[13px] text-(--ui-ink-3)">You need edit access to start a shape.</p>
      )}
      {refused ? <Alert className="mb-0">{refused}</Alert> : null}
    </div>
  );
}

export function MapPage({
  props,
  clients,
  trailing,
}: {
  props: PageProps;
  /** The workspaces the viewer may switch between, besides Wren's. */
  clients: readonly { id: string; name: string }[];
  /** More controls at the header's end (the Today sheet's button). */
  trailing?: ReactNode;
}) {
  const window = windowOf(props.params.get("window"));
  const wren = props.client === WREN.id;
  const client = wren ? null : props.client;
  const at = atOf(props.client);
  const read = useMap(props.client, window);
  const data: MapData | null = read.data?.map ?? null;
  // The same check the server's guard makes for a shape write: it works the Journeys app.
  const mayEdit =
    props.team &&
    !props.demo &&
    canAt(
      {
        team: props.team,
        demo: props.demo,
        ...(props.can ? { can: props.can } : {}),
        ...(props.who ? { who: props.who } : {}),
      },
      "act",
      { client: props.client, app: "deals" },
    );
  const editing = mayEdit && !!data && props.params.get("edit") === "1";

  const [selected, setSelected] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [palette, setPalette] = useState(true);
  const [loop, setLoop] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState<{ name: string; text: string; stamp: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const alt = useAltKey();
  const shape = useShapeDraft(props.client, data, mayEdit);
  const diff = useDiff(at, history ? picked : []);
  const draft = editing ? shape.draft : null;

  const drawn = useMemo(() => {
    if (!data) return null;
    if (history && picked.length === 2 && diff.data)
      return { ...diffGraph(diff.data.bodies[0], diff.data.bodies[1], diff.data.diff), diff: true };
    return { ...graphOf(draft ? { ...data, body: draft.body } : data), diff: false };
  }, [data, draft, history, picked.length, diff.data]);

  const pick = (n: number) =>
    setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p.slice(-1), n]));
  const enter = (id: string) => {
    const node = data?.body.nodes.find((n) => n.id === id);
    const to = node ? opensOf(node, wren ? "wren" : "client", client)[0] : undefined;
    if (to) navigate(to.href);
  };
  const select = (id: string | null) => {
    setSelected(id);
    setLine(null);
  };
  const setEdit = (on: boolean) => go("/", { edit: on ? "1" : null }, props.params);

  const add = (id: string) => {
    if (!draft || !KINDS.some((k) => k.kind === id)) return;
    const next = addNode(draft.body, id as Kind);
    shape.set({ ...draft, body: next.body });
    setHistory(false);
    select(next.id);
  };

  const edit: GraphEdit | undefined = draft
    ? {
        ends: (id) => ({
          from: true,
          to: draft.body.nodes.find((n) => n.id === id)?.kind !== "source",
        }),
        fits: (from, to) =>
          reasonFor(draft.body, from, to, alt.current || loop ? "loop" : "flow") === null,
        why: (from, to) => reasonFor(draft.body, from, to, alt.current || loop ? "loop" : "flow"),
        connect: (from, to) =>
          shape.set({
            ...draft,
            body: connect(draft.body, from, to, alt.current || loop ? "loop" : "flow"),
          }),
        pick: (from, to) => {
          const e = edgeBetween(draft.body, from, to);
          if (!e) return;
          setSelected(null);
          setLine(e.id);
          setHistory(false);
        },
        renaming,
        begin: setRenaming,
        rename: (id, name) => {
          setRenaming(null);
          if (name?.trim()) shape.set({ ...draft, body: renameNode(draft.body, id, name.trim()) });
        },
      }
    : undefined;

  const exportShape = async () => {
    if (!data) return;
    setNotice(null);
    try {
      const body = draft ? draft.body : data.body;
      const sent = await call<{ text: string }>("pipeline/shapeExport", { ...at, body });
      saveText(fileNameOf(body.name), "text/yaml", sent.text);
    } catch (err) {
      setNotice(messageOf(err));
    }
  };
  const importFile = async (f: File | undefined) => {
    if (!f) return;
    setNotice(null);
    try {
      setFile({ name: f.name, text: await f.text(), stamp: Date.now() });
    } catch (err) {
      setNotice(messageOf(err));
    }
  };
  const picker = useRef<HTMLInputElement>(null);

  const panelOn = history || !!selected || !!line;
  // A node the draft holds gets its edit card; a ghost, or a view of the saved shape, its details.
  const editable = !!draft && !!selected && draft.body.nodes.some((n) => n.id === selected);

  return (
    <section
      aria-label="Map"
      className="flex min-h-0 min-w-0 flex-1 flex-col text-(--ui-ink) max-[900px]:flex-none"
    >
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-(--ui-hair) px-5 py-3 max-[900px]:px-4">
        <h1 className="mr-auto text-[22px]/8 font-semibold">Map</h1>
        <Segmented
          label="Window"
          className="max-w-full"
          items={WINDOWS.map((w) => ({
            id: w.id,
            label: w.label,
            href: href("/", { window: w.id === "30" ? null : w.id }, props.params),
            on: w.id === window,
          }))}
        />
        <select
          aria-label="Client"
          className={`${SELECT_CLASS} !w-auto`}
          value={props.client}
          onChange={(e) =>
            go("/", { client: e.target.value === WREN.id ? null : e.target.value }, props.params)
          }
        >
          <option value={WREN.id}>Wren</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {data ? (
          <Button
            tone="quiet"
            size="dense"
            aria-pressed={history}
            onClick={() => {
              setHistory((h) => !h);
              setPicked([]);
            }}
          >
            <Icon name="clock" size={15} /> History
          </Button>
        ) : null}
        {data ? (
          <Button tone="quiet" size="dense" onClick={() => void exportShape()}>
            <Icon name="download" size={15} /> Export
          </Button>
        ) : null}
        {mayEdit ? (
          <>
            <Button tone="quiet" size="dense" onClick={() => picker.current?.click()}>
              <Icon name="upload" size={15} /> Import
            </Button>
            <input
              ref={picker}
              type="file"
              accept=".yaml,.yml,text/yaml"
              aria-label="Shape file"
              className="hidden"
              onChange={(e) => {
                void importFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </>
        ) : null}
        {mayEdit && data ? (
          <Button
            tone={editing ? "primary" : "secondary"}
            size="dense"
            aria-pressed={editing}
            onClick={() => setEdit(!editing)}
          >
            <Icon name="edit" size={15} /> {shape.dirty && !editing ? "Edit draft" : "Edit"}
          </Button>
        ) : null}
        {trailing}
      </header>
      {notice ? <Alert className="mx-5 mt-3 mb-0 max-[900px]:mx-4">{notice}</Alert> : null}
      <div className="relative min-h-0 flex-1 max-[900px]:h-[68dvh] max-[900px]:min-h-[380px] max-[900px]:flex-none">
        {read.error && !read.data ? (
          <div className="p-5">
            <LoadFailed error={read.error} onRetry={read.retry} what="map" />
          </div>
        ) : !read.data ? (
          <div className="p-5">
            <Loading lines={8} />
          </div>
        ) : !data || !drawn ? (
          <NoShape mayStart={mayEdit} at={at} onStarted={read.retry} />
        ) : (
          <>
            <div className="absolute inset-0">
              <Graph
                key={drawn.diff ? "diff" : "map"}
                nodes={drawn.nodes}
                edges={drawn.edges}
                label={drawn.diff ? "Shape differences" : "Map of the shape"}
                direction="down"
                ribbons
                bare
                stretch
                tools={false}
                selected={history ? null : selected}
                edit={drawn.diff ? undefined : edit}
                onOpen={(id) => {
                  setHistory(false);
                  select(id);
                }}
                onPane={() => select(null)}
                onEnter={enter}
                onDrop={drawn.diff ? undefined : add}
                name="map"
              />
            </div>
            {draft && palette ? (
              <div className={panelOn ? "max-[900px]:hidden" : undefined}>
                <PaletteDrawer
                  groups={PARTS}
                  onAdd={add}
                  onClose={() => setPalette(false)}
                  label="Parts of a shape"
                  className={AT_LEFT}
                />
              </div>
            ) : null}
            {history ? (
              <History
                versions={data.versions}
                picked={picked}
                onPick={pick}
                diff={diff}
                at={at}
                canEdit={mayEdit}
                onSaved={read.retry}
                onClose={() => {
                  setHistory(false);
                  setPicked([]);
                }}
              />
            ) : draft && line ? (
              <EdgeEdit
                id={line}
                draft={draft}
                onChange={shape.set}
                onClose={() => setLine(null)}
              />
            ) : draft && editable && selected ? (
              <NodeEdit
                id={selected}
                draft={draft}
                people={data.people}
                at={at}
                onChange={shape.set}
                onClose={() => select(null)}
              />
            ) : selected ? (
              <NodePanel
                data={data}
                id={selected}
                window={window as Window}
                place={wren ? "wren" : "client"}
                client={client}
                at={at}
                onClose={() => select(null)}
              />
            ) : null}
            {draft ? (
              <DraftBar
                changes={shape.changes}
                problems={shape.problems}
                palette={palette}
                onPalette={() => setPalette((p) => !p)}
                loop={loop}
                onLoop={() => setLoop((l) => !l)}
                onSave={() => setSaving(true)}
                onDiscard={() => {
                  shape.discard();
                  select(null);
                }}
              />
            ) : null}
            {editing && shape.conflict ? (
              <DraftConflict onKeep={shape.keepMine} onTake={shape.takeTheirs} />
            ) : null}
          </>
        )}
      </div>
      {draft ? (
        <SaveDialog
          client={props.client}
          at={at}
          draft={draft}
          changes={shape.changes}
          open={saving}
          onOpenChange={setSaving}
          onSaved={(sent) => {
            shape.saved(sent);
            setSaving(false);
            select(null);
            read.retry();
          }}
        />
      ) : null}
      {file ? (
        <ImportDialog
          at={at}
          name={file.name}
          text={file.text}
          stamp={file.stamp}
          onClose={() => setFile(null)}
          onSaved={() => {
            setFile(null);
            read.retry();
          }}
        />
      ) : null}
    </section>
  );
}
