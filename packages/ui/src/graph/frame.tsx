/**
 * The kit's React Flow shell, the same for every graph: pan, zoom, fit, a minimap and controls.
 * Drag pans once the drawing is bigger than its box or zoomed; the wheel zooms once the graph is
 * clicked, so the page still scrolls past it. Keys while it has focus: arrows pan, + and - zoom,
 * F fits, 0 goes back to where it started. Phone: one finger pans, two pinch.
 */
import {
  Background,
  BackgroundVariant,
  type Edge,
  type EdgeTypes,
  MiniMap,
  type Node,
  type NodeTypes,
  Panel,
  ReactFlow,
  type ReactFlowInstance,
  type ReactFlowProps,
  useReactFlow,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { cn } from "cn";
import { Maximize, Minus, Plus } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

const PAN_STEP = 80;
const ZOOM = { min: 0.15, max: 2 };
const EASE = { duration: 180 };

export interface FrameProps {
  label: string;
  nodes: Node[];
  edges: Edge[];
  nodeTypes: NodeTypes;
  edgeTypes: EdgeTypes;
  height: number;
  /** Where it sits at rest, and whether all of it shows there. */
  rest: Viewport;
  fits: boolean;
  /** No border or dotted ground: a run's steps sit on the page. */
  bare?: boolean | undefined;
  minimap?: boolean | undefined;
  /** React Flow's events and switches this graph needs (clicks, connecting, sizes). */
  flow?: Partial<ReactFlowProps> | undefined;
  /** Drawn over the graph in its box: a hover card. */
  children?: ReactNode;
  className?: string | undefined;
}

const TOOL =
  "inline-flex size-8 items-center justify-center border-0 bg-(--ui-paper) text-(--ui-ink-2) shadow-[inset_0_0_0_1px_var(--ui-hair)] hover:bg-(--ui-hover) hover:text-(--ui-ink) cursor-pointer";

function Controls({ rest, moved, quiet }: { rest: Viewport; moved: () => void; quiet: boolean }) {
  const rf = useReactFlow();
  return (
    <Panel
      position="bottom-left"
      className={cn(
        "m-2! flex gap-px",
        // On a bare graph they show on hover or focus, so they never sit on a step.
        quiet &&
          "opacity-0 transition-opacity duration-200 group-focus-within/frame:opacity-100 group-hover/frame:opacity-100",
      )}
    >
      <button
        type="button"
        className={TOOL}
        title="Zoom in (+)"
        aria-label="Zoom in"
        onClick={() => {
          moved();
          void rf.zoomIn(EASE);
        }}
      >
        <Plus className="size-3.5" />
      </button>
      <button
        type="button"
        className={TOOL}
        title="Zoom out (−)"
        aria-label="Zoom out"
        onClick={() => {
          moved();
          void rf.zoomOut(EASE);
        }}
      >
        <Minus className="size-3.5" />
      </button>
      <button
        type="button"
        className={TOOL}
        title="Fit (F)"
        aria-label="Fit"
        onClick={() => {
          moved();
          void rf.fitView({ padding: 0.08, ...EASE });
        }}
        onDoubleClick={() => void rf.setViewport(rest, EASE)}
      >
        <Maximize className="size-3.5" />
      </button>
    </Panel>
  );
}

export function GraphFrame({
  label,
  nodes,
  edges,
  nodeTypes,
  edgeTypes,
  height,
  rest,
  fits,
  bare,
  minimap,
  flow,
  children,
  className,
}: FrameProps) {
  const box = useRef<HTMLElement>(null);
  const rf = useRef<ReactFlowInstance | null>(null);
  // Clicked into: the wheel zooms. Clicking anywhere else gives the wheel back to the page.
  const [active, setActive] = useState(false);
  // Moved by hand: drag pans from here on, even when it all fit.
  const [moved, setMoved] = useState(false);
  const touched = useCallback(() => setMoved(true), []);
  useEffect(() => {
    if (!active) return;
    const off = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as globalThis.Node)) setActive(false);
    };
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, [active]);
  // A new resting place (another width, another graph) starts it over.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the rest is the cue.
  useEffect(() => {
    setMoved(false);
    void rf.current?.setViewport(rest);
  }, [rest.x, rest.y, rest.zoom]);

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    const r = rf.current;
    if (!r || e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return;
    const v = r.getViewport();
    const pan = (dx: number, dy: number) =>
      void r.setViewport({ ...v, x: v.x + dx, y: v.y + dy }, EASE);
    const keys: Record<string, () => void> = {
      ArrowLeft: () => pan(PAN_STEP, 0),
      ArrowRight: () => pan(-PAN_STEP, 0),
      ArrowUp: () => pan(0, PAN_STEP),
      ArrowDown: () => pan(0, -PAN_STEP),
      "+": () => void r.zoomIn(EASE),
      "=": () => void r.zoomIn(EASE),
      "-": () => void r.zoomOut(EASE),
      f: () => void r.fitView({ padding: 0.08, ...EASE }),
      F: () => void r.fitView({ padding: 0.08, ...EASE }),
      "0": () => void r.setViewport(rest, EASE),
    };
    const run = keys[e.key];
    if (!run) return;
    e.preventDefault();
    setMoved(true);
    run();
  };

  return (
    <section
      ref={box}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the graph takes keys to pan and zoom.
      tabIndex={0}
      aria-label={`${label}. Arrows pan, plus and minus zoom, F fits.`}
      className={cn(
        "group/frame relative w-full max-w-full overflow-hidden outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ui-accent)",
        !bare && "border border-(--ui-hair) bg-(--ui-graph)",
        className,
      )}
      style={{ height }}
      onPointerDown={() => setActive(true)}
      onKeyDown={onKey}
    >
      <ReactFlow
        aria-label={label}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultViewport={rest}
        minZoom={ZOOM.min}
        maxZoom={ZOOM.max}
        onInit={(r) => {
          rf.current = r;
        }}
        onMoveEnd={(e) => {
          if (e) setMoved(true);
        }}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        panOnDrag={!fits || moved}
        panOnScroll={false}
        zoomOnScroll={active}
        zoomOnPinch
        zoomOnDoubleClick={false}
        preventScrolling={active}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        zoomActivationKeyCode={null}
        panActivationKeyCode={null}
        disableKeyboardA11y
        proOptions={{ hideAttribution: true }}
        {...flow}
      >
        {bare ? null : (
          <Background
            variant={BackgroundVariant.Dots}
            gap={18}
            size={1.6}
            color="color-mix(in oklch, var(--ui-ink-3) 45%, transparent)"
          />
        )}
        <Controls rest={rest} moved={touched} quiet={!!bare} />
        {minimap ? (
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            className="m-2! border border-(--ui-hair) max-sm:hidden"
            style={{ width: 168, height: 104, background: "var(--ui-paper)" }}
            nodeColor="var(--ui-fill)"
            nodeStrokeColor="var(--ui-ink-3)"
            nodeBorderRadius={0}
            maskColor="color-mix(in srgb, var(--ui-tile) 70%, transparent)"
            maskStrokeColor="var(--ui-ink-3)"
            ariaLabel="Where you are in the graph"
          />
        ) : null}
      </ReactFlow>
      {children}
    </section>
  );
}
