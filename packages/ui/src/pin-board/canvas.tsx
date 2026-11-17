/**
 * PinBoard (vireo designs/2026-11-16-board.md): a subject's moodboard on React Flow, in the kit's
 * GraphFrame. Pins drag, resize and drop into frames; a note's text and a frame's title edit in
 * place; Delete removes. Paste or drop a link or a picture: it lands where the pointer is. The page
 * draws each pin's face and owns the data; this part only says what moved.
 */
import {
  applyNodeChanges,
  type Node,
  type NodeChange,
  type NodeProps,
  NodeResizer,
  type OnNodeDrag,
  ReactFlowProvider,
  useReactFlow,
  type Viewport,
} from "@xyflow/react";
import { cn } from "cn";
import {
  type ClipboardEvent,
  createContext,
  type DragEvent,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button } from "../controls.js";
import { GraphFrame } from "../graph/frame.js";

export type PinKind = "link" | "image" | "video" | "note" | "sample" | "frame";

/** A pin as the board draws it: x and y count from its frame's corner, when it has one. */
export interface BoardPin {
  id: number;
  kind: PinKind;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  frameId: number | null;
  title: string | null;
  body: string | null;
}

/** What one drag, resize or reframe changed. */
export interface PinPlace {
  id: number;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  z?: number;
  frameId?: number | null;
}

export type PinAdd =
  | { kind: "link"; url: string }
  | { kind: "note" }
  | { kind: "frame" }
  | { kind: "files"; files: File[] };

/** Where an add lands: frame-relative when it lands in a frame. */
export interface PinAt {
  x: number;
  y: number;
  frameId: number | null;
}

export interface PinBoardProps {
  label: string;
  pins: readonly BoardPin[];
  /** a link, picture, video or sample pin's face; fills its box */
  face: (p: BoardPin) => ReactNode;
  open?: number | null | undefined;
  onOpen?: ((id: number | null) => void) | undefined;
  onPlace: (moves: PinPlace[]) => void;
  onAdd: (a: PinAdd, at: PinAt) => void;
  onRemove: (ids: number[]) => void;
  onText: (id: number, t: { title?: string; body?: string }) => void;
  height?: number | undefined;
  /** read only: no add, drag, resize, edit or delete */
  locked?: boolean | undefined;
}

const PAD = 24;
const BAR = 52;
/** an added pin's size before the page's own (vireo PIN_SIZE) */
const ADD = { w: 240, h: 280 } as const;
const LINK = /^https?:\/\/\S+$/i;

interface Ctx {
  face: (p: BoardPin) => ReactNode;
  onText: PinBoardProps["onText"];
  onPlace: PinBoardProps["onPlace"];
  open: number | null;
  locked: boolean;
}
const BoardCtx = createContext<Ctx | null>(null);
const useBoard = () => useContext(BoardCtx) as Ctx;

type PinNode = Node<{ pin: BoardPin }>;

const toNode = (p: BoardPin, selected = false): PinNode => ({
  id: String(p.id),
  type: p.kind === "frame" ? "frame" : p.kind === "note" ? "note" : "pin",
  position: { x: p.x, y: p.y },
  width: p.w,
  height: p.h,
  // frames sit under every pin; React Flow lifts a frame's own pins over it
  zIndex: p.kind === "frame" ? -1 : p.z,
  selected,
  ...(p.frameId ? { parentId: String(p.frameId) } : {}),
  data: { pin: p },
});

/** Frames first: React Flow needs a parent before its pins. */
const nodesOf = (pins: readonly BoardPin[], selected: ReadonlySet<string> = new Set()) =>
  [...pins]
    .sort((a, b) => Number(b.kind === "frame") - Number(a.kind === "frame"))
    .map((p) => toNode(p, selected.has(String(p.id))));

/** Board-space boxes: a pin in a frame adds the frame's corner. */
function boxesOf(pins: readonly BoardPin[]) {
  const frames = new Map(pins.filter((p) => p.kind === "frame").map((p) => [p.id, p]));
  return pins.map((p) => {
    const f = p.frameId ? frames.get(p.frameId) : undefined;
    return { p, x: p.x + (f?.x ?? 0), y: p.y + (f?.y ?? 0), w: p.w, h: p.h };
  });
}

/** Where it rests: all of it when that reads (zoom 0.4 and up), else its top-left corner. */
function restOf(pins: readonly BoardPin[], width: number, height: number) {
  const b = boxesOf(pins);
  if (!b.length) return { rest: { x: PAD, y: PAD + BAR, zoom: 1 }, fits: true };
  const x0 = Math.min(...b.map((q) => q.x));
  const y0 = Math.min(...b.map((q) => q.y));
  const bw = Math.max(...b.map((q) => q.x + q.w)) - x0;
  const bh = Math.max(...b.map((q) => q.y + q.h)) - y0;
  const room = { w: width - 2 * PAD, h: height - 2 * PAD - BAR };
  const whole = Math.min(1, room.w / bw, room.h / bh);
  const zoom = Math.max(0.4, whole);
  const fits = zoom === whole;
  const spare = fits ? (room.w - bw * zoom) / 2 : 0;
  return { rest: { x: PAD + spare - x0 * zoom, y: PAD + BAR - y0 * zoom, zoom }, fits };
}

const SELECTED = "outline-2 outline-offset-2 outline-(--ui-active)";
const EDGE = "outline-1 -outline-offset-1 outline-(--ui-hair)";
const RESIZE = {
  handleClassName: "size-2.5! rounded-[2px]! border-(--ui-active)! bg-(--ui-paper)!",
  lineClassName: "border-(--ui-active)!",
};

function PinFace({ id, data, selected }: NodeProps<PinNode>) {
  const b = useBoard();
  return (
    <div
      data-pin={id}
      className={cn(
        "size-full overflow-hidden rounded-[4px_10px_4px_10px] [animation:ui-fade_.15s_both]",
        // hair edge: the shadow alone is lost on the dark ground
        selected || b.open === data.pin.id ? SELECTED : EDGE,
      )}
    >
      <NodeResizer
        isVisible={!!selected && !b.locked}
        minWidth={120}
        minHeight={100}
        {...RESIZE}
        onResizeEnd={(_, r) =>
          b.onPlace([{ id: data.pin.id, x: r.x, y: r.y, w: r.width, h: r.height }])
        }
      />
      {b.face(data.pin)}
    </div>
  );
}

/** A field that saves on blur, and on Enter for one line. */
function Words({
  value,
  multi,
  label,
  onSave,
  locked,
  className,
}: {
  value: string;
  multi?: boolean;
  label: string;
  onSave: (v: string) => void;
  locked: boolean;
  className: string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const save = () => {
    const t = v.trim();
    if (!t) setV(value);
    else if (t !== value) onSave(t);
  };
  const common = {
    "aria-label": label,
    value: v,
    readOnly: locked,
    onChange: (e: { target: { value: string } }) => setV(e.target.value),
    onBlur: save,
    // nodrag: text selects instead of dragging the pin; nowheel: the wheel scrolls the text
    // the base field look (border, pad) off: words at rest; a fill marks the one being edited
    className: cn(
      "nodrag nowheel m-0 resize-none rounded-[4px] border-0 bg-transparent p-0 shadow-none outline-none focus:bg-(--ui-hover) focus-visible:ring-0",
      className,
    ),
  };
  return multi ? (
    <textarea {...common} />
  ) : (
    <input
      {...common}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function NoteFace({ data, selected }: NodeProps<PinNode>) {
  const b = useBoard();
  const p = data.pin;
  return (
    <div
      className={cn(
        "flex size-full flex-col rounded-[4px_10px_4px_10px] bg-(--ui-paper) p-3 pt-5 shadow-[0_1px_2px_rgb(0_0_0/.06),0_4px_12px_rgb(0_0_0/.05)] [animation:ui-fade_.15s_both]",
        selected ? SELECTED : EDGE,
      )}
    >
      <NodeResizer
        isVisible={!!selected && !b.locked}
        minWidth={140}
        minHeight={80}
        {...RESIZE}
        onResizeEnd={(_, r) => b.onPlace([{ id: p.id, x: r.x, y: r.y, w: r.width, h: r.height }])}
      />
      <Words
        multi
        label="Note"
        value={p.body ?? ""}
        locked={b.locked}
        onSave={(body) => b.onText(p.id, { body })}
        className="min-h-0 flex-1 text-[14px]/[1.45] text-(--ui-ink)"
      />
    </div>
  );
}

function FrameFace({ data, selected }: NodeProps<PinNode>) {
  const b = useBoard();
  const p = data.pin;
  return (
    <div
      className={cn(
        "size-full rounded-[12px] bg-(--ui-fill) outline-1 outline-(--ui-hair) [animation:ui-fade_.15s_both]",
        selected && SELECTED,
      )}
    >
      <NodeResizer
        isVisible={!!selected && !b.locked}
        minWidth={300}
        minHeight={200}
        {...RESIZE}
        onResizeEnd={(_, r) => b.onPlace([{ id: p.id, x: r.x, y: r.y, w: r.width, h: r.height }])}
      />
      <Words
        label="Frame title"
        value={p.title ?? ""}
        locked={b.locked}
        onSave={(title) => b.onText(p.id, { title })}
        className="m-3 w-[calc(100%-24px)] text-[15px] font-semibold text-(--ui-ink)"
      />
    </div>
  );
}

const NODE_TYPES = { pin: PinFace, note: NoteFace, frame: FrameFace };
const EDGE_TYPES = {};

function Toolbar({ add, locked }: { add: (a: PinAdd) => void; locked: boolean }) {
  const [link, setLink] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  if (locked) return null;
  return (
    <div className="absolute top-2 left-2 z-10 flex flex-wrap items-center gap-1 rounded-[10px] bg-(--ui-glass) p-1 shadow-[0_1px_2px_rgb(0_0_0/.06)] backdrop-blur-sm">
      {link === null ? (
        <Button size="dense" tone="quiet" icon="link" onClick={() => setLink("")}>
          Link
        </Button>
      ) : (
        // form-ok: one paste box that empties on submit; no fields to manage
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (LINK.test(link.trim())) add({ kind: "link", url: link.trim() });
            setLink(null);
          }}
        >
          {/* edit-ok: a pasted link, pinned at once; no draft worth keeping */}
          <input
            // biome-ignore lint/a11y/noAutofocus: the field opens on its own button's press
            autoFocus
            aria-label="Link to pin"
            placeholder="Paste a link"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setLink(null)}
            onBlur={() => !link.trim() && setLink(null)}
            className="h-8 w-[min(260px,50vw)] rounded-[6px] bg-(--ui-paper) px-2 text-[13px] text-(--ui-ink) outline-1 outline-(--ui-edge) focus:outline-2 focus:outline-(--ui-focus)"
          />
          <Button size="dense" type="submit" disabled={!LINK.test(link.trim())}>
            Pin
          </Button>
        </form>
      )}
      <Button size="dense" tone="quiet" icon="note" onClick={() => add({ kind: "note" })}>
        Note
      </Button>
      <Button size="dense" tone="quiet" icon="boxes" onClick={() => add({ kind: "frame" })}>
        Frame
      </Button>
      <Button size="dense" tone="quiet" icon="upload" onClick={() => file.current?.click()}>
        Upload
      </Button>
      <input
        ref={file}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length) add({ kind: "files", files });
          e.target.value = "";
        }}
      />
    </div>
  );
}

function Canvas(props: PinBoardProps) {
  const { pins, onPlace, onAdd, onRemove, onOpen, locked = false } = props;
  const height = props.height ?? 640;
  const rf = useReactFlow();
  const wrap = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const [width, setWidth] = useState(0);
  const [nodes, setNodes] = useState<PinNode[]>(() => nodesOf(pins));
  const [view, setView] = useState<{ rest: Viewport; fits: boolean; at: number } | null>(null);

  // the page's pins win; a selection survives a reload
  useEffect(
    () => setNodes((ns) => nodesOf(pins, new Set(ns.filter((n) => n.selected).map((n) => n.id)))),
    [pins],
  );
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  // rests once per width: an add or a move never jumps the view
  // biome-ignore lint/correctness/useExhaustiveDependencies: width is the cue; pins are read once
  useLayoutEffect(() => {
    if (!width) return;
    setView((v) =>
      v && Math.abs(v.at - width) < 80 ? v : { ...restOf(pins, width, height), at: width },
    );
  }, [width]);

  /** the frame under a board point, and the point in its own space */
  const landing = (pt: { x: number; y: number }): PinAt => {
    const f = boxesOf(pins)
      .filter((q) => q.p.kind === "frame")
      .find((q) => pt.x >= q.x && pt.x <= q.x + q.w && pt.y >= q.y && pt.y <= q.y + q.h);
    return f
      ? { x: pt.x - f.x, y: pt.y - f.y, frameId: f.p.id }
      : { x: pt.x, y: pt.y, frameId: null };
  };
  /** the pointer's board point, else the middle of what shows; the pin centers on it */
  const here = (screen?: { x: number; y: number }) => {
    const r = wrap.current?.getBoundingClientRect();
    const s = screen ??
      pointer.current ?? {
        x: (r?.left ?? 0) + (r?.width ?? 0) / 2,
        y: (r?.top ?? 0) + (r?.height ?? 0) / 2,
      };
    const pt = rf.screenToFlowPosition(s);
    return landing({ x: pt.x - ADD.w / 2, y: pt.y - ADD.h / 2 });
  };

  const onNodesChange = (changes: NodeChange<PinNode>[]) =>
    // removes go through onNodesDelete: the page asks the server first
    setNodes((ns) =>
      applyNodeChanges(
        changes.filter((c) => c.type !== "remove"),
        ns,
      ),
    );

  const onNodeDragStop: OnNodeDrag<PinNode> = (_, __, dragged) => {
    const top = Math.max(0, ...pins.map((p) => p.z));
    const moves = dragged.map((n, i): PinPlace => {
      const p = n.data.pin;
      const abs = rf.getInternalNode(n.id)?.internals.positionAbsolute ?? n.position;
      if (p.kind === "frame") return { id: p.id, x: abs.x, y: abs.y };
      // the frame under the pin's middle takes it; none: back onto the board
      const mid = { x: abs.x + (n.width ?? p.w) / 2, y: abs.y + (n.height ?? p.h) / 2 };
      const into = landing(mid).frameId;
      const f = into ? rf.getInternalNode(String(into))?.internals.positionAbsolute : null;
      const at = f ? { x: abs.x - f.x, y: abs.y - f.y } : abs;
      return {
        id: p.id,
        x: at.x,
        y: at.y,
        z: top + 1 + i,
        ...(into !== p.frameId ? { frameId: into } : {}),
      };
    });
    // reframe here at once: React Flow draws a pin from its parent's corner
    const by = new Map(moves.map((m) => [String(m.id), m]));
    setNodes((ns) =>
      ns.map((n) => {
        const m = by.get(n.id);
        if (!m || m.frameId === undefined) return n;
        const { parentId: _, ...rest } = n;
        return {
          ...rest,
          position: { x: m.x ?? n.position.x, y: m.y ?? n.position.y },
          ...(m.frameId ? { parentId: String(m.frameId) } : {}),
        };
      }),
    );
    onPlace(moves);
  };

  const add = (a: PinAdd, screen?: { x: number; y: number }) => onAdd(a, here(screen));
  const typing = (t: EventTarget | null) =>
    !!(t as HTMLElement | null)?.closest?.("input, textarea, [contenteditable]");
  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    if (locked || typing(e.target)) return;
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
    const text = e.clipboardData.getData("text/plain").trim();
    if (files.length) add({ kind: "files", files });
    else if (LINK.test(text)) add({ kind: "link", url: text });
    else return;
    e.preventDefault();
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (locked) return;
    e.preventDefault();
    const at = { x: e.clientX, y: e.clientY };
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
    const url = (e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain"))
      .split("\n")[0]
      ?.trim();
    if (files.length) add({ kind: "files", files }, at);
    else if (url && LINK.test(url)) add({ kind: "link", url }, at);
  };

  return (
    <BoardCtx.Provider
      value={{ face: props.face, onText: props.onText, onPlace, open: props.open ?? null, locked }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: paste and drop land on the board; the frame inside takes keys */}
      <div
        ref={wrap}
        className="relative w-full"
        style={{ minHeight: height }}
        onPaste={onPaste}
        onDragOver={(e) => !locked && e.preventDefault()}
        onDrop={onDrop}
        onPointerMove={(e) => {
          pointer.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerLeave={() => {
          pointer.current = null;
        }}
      >
        {view ? (
          <GraphFrame
            label={props.label}
            nodes={nodes}
            edges={[]}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            height={height}
            rest={view.rest}
            fits={view.fits}
            minimap={pins.length > 12}
            flow={{
              onNodesChange,
              onNodeDragStop,
              onNodesDelete: (ns) => onRemove(ns.map((n) => Number(n.id))),
              onNodeClick: (_, n) => onOpen?.(Number(n.id)),
              onPaneClick: () => onOpen?.(null),
              nodesDraggable: !locked,
              elementsSelectable: true,
              nodesFocusable: true,
              panOnDrag: true,
              selectionKeyCode: "Shift",
              multiSelectionKeyCode: ["Meta", "Control"],
              deleteKeyCode: locked ? null : ["Backspace", "Delete"],
            }}
          >
            <Toolbar add={(a) => add(a)} locked={locked} />
            {!pins.length ? (
              <p className="pointer-events-none absolute inset-x-4 top-1/2 m-0 -translate-y-1/2 text-center text-[14px] text-(--ui-ink-3)">
                {locked
                  ? "Nothing pinned yet."
                  : "Paste a link or a picture, drop a file, or add a note or a frame."}
              </p>
            ) : null}
          </GraphFrame>
        ) : null}
      </div>
    </BoardCtx.Provider>
  );
}

export default function PinBoardCanvas(props: PinBoardProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
