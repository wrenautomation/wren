/**
 * The map canvas: sigma 4 on WebGL, positions as given (no layout runs here). Dots grow as the
 * camera nears and labels show by size; links draw only around the dot in hand. Hover, a pick or a
 * search lifts those dots over a veil that dims the rest. Its own chunk, loaded when a map shows.
 */
import Graph from "graphology";
import type { Attributes } from "graphology-types";
import { type Ref, useEffect, useImperativeHandle, useRef } from "react";
import Sigma from "sigma";
import type { MapDot, MapLink } from "./map-model.js";

/** What a page drives: fly to a dot, or show the whole map. */
export interface MapHandle {
  flyTo(id: string, ratio?: number): Promise<void>;
  whole(): Promise<void>;
  /** The camera's ratio: 1 is the whole map. */
  ratio(): number;
}

export interface MapCanvasProps {
  dots: readonly MapDot[];
  links: readonly MapLink[];
  /** The map's name for a screen reader. */
  label: string;
  selected?: string | null | undefined;
  /** Dots a search found: lit like a pick. */
  match?: ReadonlySet<string> | null | undefined;
  onSelect?: ((id: string | null) => void) | undefined;
  /** A double click: open the dot's page or source. */
  onOpen?: ((id: string) => void) | undefined;
  handle?: Ref<MapHandle> | undefined;
  className?: string | undefined;
}

type NS = { lit: boolean; focus: boolean };
type ES = { lit: boolean };
type MapSigma = Sigma<Attributes, Attributes, Attributes, NS, ES>;

/** Lit dots, links and labels draw above the veil; the rest below it. */
const DEPTHS = ["edges", "nodes", "veil", "topEdges", "topNodes"] as const;

/** sigma's conditional style: a node state by name, or data by value. */
const when = (on: string | Record<string, unknown>, yes: unknown, no: unknown) => {
  const key = typeof on === "string" ? "whenState" : "whenData";
  // biome-ignore lint/suspicious/noThenProperty: sigma's key, not a promise
  return { [key]: on, then: yes, else: no };
};

/** A CSS color or a token as rgb, from one painted pixel: hex, oklch and color-mix all read. */
function resolver(host: HTMLElement) {
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const style = getComputedStyle(host);
  const seen = new Map<string, [number, number, number]>();
  return (c: string): [number, number, number] => {
    let out = seen.get(c);
    if (out) return out;
    out = [136, 136, 136];
    if (ctx) {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = c.startsWith("--") ? style.getPropertyValue(c).trim() || "#888" : c;
      ctx.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
      out = [r, g, b];
    }
    seen.set(c, out);
    return out;
  };
}

const css = ([r, g, b]: [number, number, number]) => `rgb(${r}, ${g}, ${b})`;

/** One quad over the whole view in the ground's color: dims every dot below it in one draw. */
function veil(gl: WebGL2RenderingContext, rgb: [number, number, number], on: () => boolean) {
  const shader = (type: number, src: string) => {
    const sh = gl.createShader(type) as WebGLShader;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return sh;
  };
  const program = gl.createProgram();
  const vs = shader(
    gl.VERTEX_SHADER,
    "#version 300 es\nin vec2 p;void main(){gl_Position=vec4(p,0.,1.);}",
  );
  const fs = shader(
    gl.FRAGMENT_SHADER,
    "#version 300 es\nprecision mediump float;uniform vec4 c;out vec4 o;void main(){o=c;}",
  );
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const at = gl.getAttribLocation(program, "p");
  gl.enableVertexAttribArray(at);
  gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  const color = gl.getUniformLocation(program, "c");
  const alpha = 0.72;
  return {
    render() {
      if (!on()) return;
      // biome-ignore lint/correctness/useHookAtTopLevel: WebGL call, not a hook
      gl.useProgram(program);
      // premultiplied, as sigma blends
      gl.uniform4f(
        color,
        (rgb[0] / 255) * alpha,
        (rgb[1] / 255) * alpha,
        (rgb[2] / 255) * alpha,
        alpha,
      );
      // sigma leaves blending off between programs: without it the quad overwrites
      const blended = gl.isEnabled(gl.BLEND);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);
      if (!blended) gl.disable(gl.BLEND);
    },
    kill() {
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    },
  };
}

export default function MapCanvas(p: MapCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const sigma = useRef<MapSigma | null>(null);
  const lights = useRef<ReturnType<typeof lightsOf> | null>(null);
  const on = useRef(p);
  on.current = p;

  // one renderer per data set; hover, picks and searches only change a few states
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const color = resolver(el);
    const g = new Graph({ multi: false, type: "undirected" });
    for (const d of p.dots)
      g.addNode(d.id, {
        x: d.x,
        y: -d.y,
        size: d.size,
        label: d.label,
        color: css(color(d.color)),
        faint: d.faint === true,
      });
    for (const l of p.links)
      if (g.hasNode(l.source) && g.hasNode(l.target) && !g.hasEdge(l.source, l.target))
        g.addEdge(l.source, l.target);
    const ink = css(color("--ui-ink"));
    const font = getComputedStyle(el).getPropertyValue("--ui-font").trim() || "sans-serif";
    // every style declarative: a function style runs per dot per frame (100k dots: 42 FPS, not 60)
    const s: MapSigma = new Sigma<Attributes, Attributes, Attributes, NS, ES>(g, el, {
      primitives: { depthLayers: DEPTHS },
      customNodeState: { lit: false, focus: false },
      customEdgeState: { lit: false },
      settings: {
        hideEdgesOnMove: true,
        itemSizesReference: "screen",
        labelRenderedSizeThreshold: 6,
        labelDensity: 0.6,
        minCameraRatio: 0.002,
        maxCameraRatio: 2,
      },
      styles: {
        nodes: {
          x: { attribute: "x" },
          y: { attribute: "y" },
          size: { attribute: "size" },
          color: { attribute: "color" },
          label: { attribute: "label" },
          labelColor: ink,
          labelFont: font,
          labelSize: 12,
          depth: when("lit", "topNodes", "nodes"),
          labelDepth: when("lit", "topNodes", "nodes"),
          // neighbours keep auto: forced labels of a whole island pile up far out
          labelVisibility: when("focus", "visible", "auto"),
          opacity: when({ faint: true }, 0.45, 1),
        },
        edges: {
          color: ink,
          size: 0.6,
          opacity: 0.35,
          depth: "topEdges",
          visibility: when("lit", "visible", "hidden"),
        },
      },
    } as never);
    sigma.current = s;
    const l = lightsOf(s);
    lights.current = l;
    s.addCustomLayerProgram("veil", "veil" as never, (gl) =>
      veil(gl, color("--ui-canvas"), () => l.any()),
    );
    s.on("clickNode", (e) => on.current.onSelect?.(e.node));
    s.on("clickStage", () => on.current.onSelect?.(null));
    s.on("doubleClickNode", (e) => {
      e.preventSigmaDefault();
      on.current.onOpen?.(e.node);
    });
    s.on("enterNode", (e) => l.light(new Set([e.node]), true));
    s.on("leaveNode", () => l.light(litOf(on.current), false));
    el.style.cursor = "grab";
    return () => {
      s.kill();
      sigma.current = null;
      lights.current = null;
    };
  }, [p.dots, p.links]);

  // a pick or a search lights its dots
  const { selected, match } = p;
  useEffect(() => {
    lights.current?.light(litOf({ selected, match }), false);
  }, [selected, match]);

  useImperativeHandle(
    p.handle,
    () => ({
      async flyTo(id, ratio = 0.03) {
        const s = sigma.current;
        const at = s?.getNodeDisplayData(id);
        if (!s || !at) return;
        await s.getCamera().animate({ x: at.x, y: at.y, ratio }, { duration: 700 });
      },
      async whole() {
        await sigma.current
          ?.getCamera()
          .animate({ x: 0.5, y: 0.5, ratio: 1, angle: 0 }, { duration: 700 });
      },
      ratio: () => sigma.current?.getCamera().ratio ?? 1,
    }),
    [],
  );

  return (
    <div
      ref={host}
      role="img"
      aria-label={p.label}
      className={p.className ?? "h-full min-h-80 w-full bg-(--ui-canvas)"}
    />
  );
}

const litOf = (p: Pick<MapCanvasProps, "selected" | "match">): Set<string> => {
  const out = new Set(p.match ?? []);
  if (p.selected) out.add(p.selected);
  return out;
};

/** The lit dots and links, changed by difference: a hover touches a few states, never all. */
function lightsOf(s: MapSigma) {
  const g = s.getGraph();
  let litNodes: string[] = [];
  let litEdges: string[] = [];
  return {
    any: () => litNodes.length > 0,
    /** The dots given and, for a hover or a pick of a few, their neighbours and links. */
    light(ids: ReadonlySet<string>, hover: boolean) {
      const nodes = new Set<string>();
      const edges: string[] = [];
      for (const id of ids) {
        if (!g.hasNode(id)) continue;
        nodes.add(id);
        if (hover || ids.size <= 3)
          g.forEachEdge(id, (e, _a, x, y) => {
            edges.push(e);
            nodes.add(x);
            nodes.add(y);
          });
      }
      s.setNodesState(litNodes, { lit: false, focus: false });
      s.setEdgesState(litEdges, { lit: false });
      litNodes = [...nodes];
      litEdges = edges;
      s.setNodesState(litNodes, { lit: true });
      // focus within lit, so the reset above clears it
      s.setNodesState(
        [...ids].filter((id) => g.hasNode(id)),
        { focus: true },
      );
      s.setEdgesState(litEdges, { lit: true });
      s.scheduleRender();
    },
  };
}
