/**
 * Full screen for one part (a graph, a tree). The part becomes a fixed layer over the page; the
 * browser goes full screen too where it can (not iPhone: no element full screen there). The page
 * root goes full screen, not the part, so tips and menus portaled to <body> still show.
 * Leaves on: the button again, Esc, the browser leaving full screen, unmount.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { IconName } from "./icons.js";

export interface FullScreen {
  full: boolean;
  /** changes when the part's size settles (in, out, the browser's own switch): fit or rest on it */
  settled: number;
  toggle: () => void;
  leave: () => void;
  label: string;
  icon: IconName;
}

/** fixed layer classes: over the shell (z-40), under menus and dialogs (z-50, portaled later) */
export const FULL_LAYER = "fixed! inset-0 z-50 m-0! h-auto! max-h-none! rounded-none! border-0!";

const noop = () => {};

export function useFullScreen(): FullScreen {
  const [full, setFull] = useState(false);
  const [settled, setSettled] = useState(0);
  const bump = useCallback(() => setSettled((n) => n + 1), []);
  // the browser's full screen: "asked" while its promise runs, "yes" once it is ours
  const own = useRef<"no" | "asked" | "yes">("no");
  // in, or the browser's switch out still to come: other parts ignore this one's changes
  const mine = useRef(false);

  const enter = useCallback(() => {
    setFull(true);
    mine.current = true;
    bump();
    const root = document.documentElement;
    // inside the click: the browser wants a user gesture
    if (document.fullscreenElement || !root.requestFullscreen) return;
    own.current = "asked";
    root.requestFullscreen({ navigationUI: "hide" }).then(
      () => {
        if (own.current === "asked") own.current = "yes";
        else void document.exitFullscreen().catch(noop); // left while it opened
      },
      () => {
        own.current = "no"; // refused: the fixed layer alone
      },
    );
  }, [bump]);
  const leave = useCallback(() => {
    setFull(false);
    if (own.current === "no") mine.current = false;
    bump();
  }, [bump]);
  const toggle = useCallback(() => (full ? leave() : enter()), [full, enter, leave]);

  // always on: the window resizes after the layer has gone, too
  useEffect(() => {
    const change = () => {
      if (!mine.current) return;
      bump();
      if (document.fullscreenElement) return;
      mine.current = false;
      if (own.current === "yes") {
        own.current = "no";
        setFull(false);
      }
    };
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, [bump]);

  useEffect(() => {
    if (!full) return;
    const was = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Esc the browser does not take itself. A part that used it (a card, a pick) calls
    // preventDefault and keeps full screen.
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) leave();
    };
    window.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = was;
      window.removeEventListener("keydown", key);
      if (own.current === "yes" && document.fullscreenElement)
        void document.exitFullscreen().catch(noop);
      own.current = "no";
    };
  }, [full, leave]);

  return {
    full,
    settled,
    toggle,
    leave,
    label: full ? "Exit full screen" : "Full screen",
    icon: full ? "shrink" : "expand",
  };
}
