/**
 * Detail windows (research-web.md, 11-09 "panes"): each keeps its own pick history. The dock shows
 * them all as tabs; the overlay panel shows the active one. Windows persist per run.
 */
import type { DockviewApi } from "dockview-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { PaneBar } from "./bars.js";
import { addDetail, addLists, defaultLayout, groupsOf } from "./dock.js";
import type { Indexed } from "./model.js";
import type { Pick } from "./panel.js";
import { same, titleOf } from "./picks.js";

export interface Win {
  id: string;
  hist: Pick[];
  at: number;
}
const HIST = 60;
const WINS = 12;

export const curOf = (w: Win | undefined) => w?.hist[w.at] ?? null;
/** a pick moves the window on; a step back then a new pick drops what was ahead, as a browser does */
function pushed(w: Win, p: Pick): Win {
  if (same(curOf(w), p)) return w;
  const hist = [...w.hist.slice(0, w.at + 1), p].slice(-HIST);
  return { ...w, hist, at: hist.length - 1 };
}
function stepped(w: Win, d: -1 | 1): Win {
  const at = Math.max(0, Math.min(w.hist.length - 1, w.at + d));
  return at === w.at ? w : { ...w, at };
}
let seq = 0;
const newWin = (p: Pick): Win => ({
  id: `w${Date.now().toString(36)}${(seq++).toString(36)}`,
  hist: [p],
  at: 0,
});

const winsKey = (rid: string) => `weaver-wins:${rid}`;
function loadWins(rid: string): Win[] {
  try {
    const v = JSON.parse(localStorage.getItem(winsKey(rid)) || "[]") as unknown;
    if (!Array.isArray(v)) return [];
    return (v as Win[])
      .filter((w) => typeof w?.id === "string" && Array.isArray(w.hist) && w.hist.length)
      .map((w) => ({ ...w, at: Math.max(0, Math.min(w.hist.length - 1, w.at | 0)) }))
      .slice(-WINS);
  } catch {
    return [];
  }
}
function saveWins(rid: string, ws: readonly Win[]) {
  try {
    localStorage.setItem(winsKey(rid), JSON.stringify(ws.slice(-WINS)));
  } catch {
    /* private mode */
  }
}

/**
 * The windows and the dock's handle. `show` puts a window's current pick on the web
 * (center: pan to it); Graph owns the pick itself.
 */
export function useWins(
  L: Indexed,
  dock: boolean,
  show: (p: Pick | null, center: boolean) => void,
) {
  const [wins, setWins] = useState<Win[]>(() => loadWins(L.run.rid));
  const [aid, setAid] = useState<string | null>(null);
  const dockRef = useRef<DockviewApi | null>(null);
  // ⌘ or Ctrl at the click: the pick opens in a new window
  const fresh = useRef(false);
  // a dock change re-renders the toolbar's toggles
  const [, setLay] = useState(0);
  const bump = () => setLay((n) => n + 1);

  useEffect(() => saveWins(L.run.rid, wins), [L.run.rid, wins]);
  useEffect(() => {
    if (!dock) dockRef.current = null;
  }, [dock]);

  /** A pick goes into a window: `into`, else the active one; ⌘ or a run's first pick opens one. */
  const openIn = (p: Pick, into: string | null) => {
    const api = dockRef.current;
    const isNew = fresh.current && !!api;
    fresh.current = false;
    const cur = isNew ? undefined : wins.find((w) => w.id === (into ?? aid ?? wins.at(-1)?.id));
    if (cur) {
      setWins((ws) => ws.map((w) => (w.id === cur.id ? pushed(w, p) : w)));
      setAid(cur.id);
      api?.getPanel(cur.id)?.api.setActive();
      return;
    }
    const w = newWin(p);
    setWins((ws) => [...ws, w]);
    setAid(w.id);
    if (api) addDetail(api, w.id, titleOf(L, p), into ?? aid);
  };
  const step = (id: string, d: -1 | 1) => {
    const w = wins.find((x) => x.id === id);
    const n = w && stepped(w, d);
    if (!n || n === w) return;
    setWins((ws) => ws.map((x) => (x.id === id ? n : x)));
    setAid(id);
    show(curOf(n), true);
  };
  const focus = (id: string) => {
    if (id === aid) return;
    const w = wins.find((x) => x.id === id);
    setAid(id);
    if (w) show(curOf(w), false);
  };
  const gone = (id: string) => {
    setWins((ws) => ws.filter((w) => w.id !== id));
    if (id === aid) setAid(null);
  };
  const navKey = (e: React.KeyboardEvent) => {
    if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    if ((e.target as Element).closest("input,textarea,select,[contenteditable]")) return;
    if (!aid) return;
    e.preventDefault();
    step(aid, e.key === "ArrowLeft" ? -1 : 1);
  };
  // a mouse's back and forward buttons step the active window
  const navMouse = (e: React.MouseEvent) => {
    if ((e.button !== 3 && e.button !== 4) || !aid) return;
    e.preventDefault();
    if (e.type === "mouseup") step(aid, e.button === 3 ? -1 : 1);
  };
  const ready = (a: DockviewApi) => {
    dockRef.current = a;
    for (const w of wins) if (!a.getPanel(w.id)) addDetail(a, w.id, titleOf(L, curOf(w)), null);
    const p = a.activePanel;
    setAid(p?.api.component === "detail" ? p.id : (wins.at(-1)?.id ?? null));
    bump();
  };

  // the toolbar's pane toggles
  const api = dockRef.current;
  const listsGs = api && dock ? groupsOf(api, "lists") : [];
  const detailGs = api && dock ? groupsOf(api, "detail") : [];
  const visible = (gs: typeof listsGs) => gs.some((g) => g.api.isVisible);
  const panes: PaneBar | undefined = dock
    ? {
        lists: !listsGs.length || visible(listsGs),
        detail: detailGs.length ? visible(detailGs) : null,
        onLists: () => {
          if (!api) return;
          if (!listsGs.length) return addLists(api);
          const v = !visible(listsGs);
          for (const g of listsGs) g.api.setVisible(v);
        },
        onDetail: () => {
          const v = !visible(detailGs);
          for (const g of detailGs) g.api.setVisible(v);
        },
        onLayout: () => {
          if (!api) return;
          defaultLayout(api);
          for (const w of wins) addDetail(api, w.id, titleOf(L, curOf(w)), aid);
        },
      }
    : undefined;

  const active = wins.find((w) => w.id === aid) ?? (dock ? undefined : wins.at(-1));
  return {
    wins,
    aid,
    active,
    dockRef,
    fresh,
    openIn,
    step,
    focus,
    gone,
    navKey,
    navMouse,
    ready,
    bump,
    panes,
  };
}
