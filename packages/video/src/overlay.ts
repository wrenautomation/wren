/**
 * What the recorder draws inside the page: a cursor that follows the real
 * mouse, a ripple on each press, and a full-screen card. It lives in a shadow
 * root on <html>, outside the app, so the app's styles and renders never touch
 * it. Plain JavaScript in a string: a compiled function can carry bundler
 * helpers the page does not have.
 */

export interface Look {
  /** CSS colors and a font stack. */
  background: string;
  foreground: string;
  muted: string;
  accent: string;
  font: string;
}

/** Wren's: the portal's canvas, ink and lavender. */
export const DEFAULT_LOOK: Look = {
  background: "#f3f1ec",
  foreground: "#0e0e0e",
  muted: "#56564f",
  accent: "#7969a3",
  font: '"General Sans", ui-sans-serif, system-ui, sans-serif',
};

/** A full-screen title: a small line over a big one, and an optional line under. */
export interface Card {
  eyebrow?: string;
  title: string;
  sub?: string;
}

export const OVERLAY_SCRIPT = String.raw`
((look) => {
  if (window.__wrenOverlay) return;
  const host = document.createElement("wren-overlay");
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = '<style>' +
    ':host{all:initial}' +
    '.cursor{position:fixed;left:0;top:0;width:26px;height:26px;opacity:0;transition:opacity .2s;will-change:transform;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))}' +
    '.ripple{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:2px solid ' + look.accent + ';opacity:.9;transform:scale(.2);animation:rip .5s cubic-bezier(.2,.7,.2,1) forwards}' +
    '@keyframes rip{to{transform:scale(1);opacity:0}}' +
    '.card{position:fixed;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 9vw;background:' + look.background + ';color:' + look.foreground + ';font-family:' + look.font + ';opacity:0;transition:opacity .6s cubic-bezier(.3,.7,.2,1)}' +
    '.card.on{opacity:1}' +
    '.eyebrow{font-size:20px;letter-spacing:.14em;text-transform:uppercase;color:' + look.accent + ';margin:0 0 22px;font-weight:600}' +
    '.title{font-size:64px;line-height:1.05;letter-spacing:-.02em;font-weight:650;margin:0;max-width:16ch}' +
    '.sub{font-size:24px;line-height:1.4;color:' + look.muted + ';margin:28px 0 0;max-width:40ch}' +
    '</style>' +
    '<svg class="cursor" viewBox="0 0 26 26"><path d="M5 3l15 9.2-6.6 1.3 3.9 7.7-2.9 1.4-3.8-7.7L5 19.6z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>' +
    '<div class="card"><p class="eyebrow"></p><h1 class="title"></h1><p class="sub"></p></div>';
  const cursor = root.querySelector(".cursor");
  const card = root.querySelector(".card");
  const attach = () => (document.body || document.documentElement).appendChild(host);
  if (document.body) attach();
  else document.addEventListener("DOMContentLoaded", attach, { once: true });
  addEventListener("mousemove", (e) => {
    cursor.style.transform = "translate(" + (e.clientX - 5) + "px," + (e.clientY - 3) + "px)";
    cursor.style.opacity = "1";
  }, true);
  addEventListener("mousedown", (e) => {
    const r = document.createElement("div");
    r.className = "ripple";
    r.style.left = e.clientX + "px";
    r.style.top = e.clientY + "px";
    root.appendChild(r);
    setTimeout(() => r.remove(), 600);
  }, true);
  const set = (sel, text) => {
    const el = card.querySelector(sel);
    el.textContent = text || "";
    el.style.display = text ? "" : "none";
  };
  window.__wrenOverlay = {
    card(c, instant) {
      set(".eyebrow", c.eyebrow);
      set(".title", c.title);
      set(".sub", c.sub);
      card.style.transition = instant ? "none" : "";
      card.classList.add("on");
      if (instant) {
        void card.offsetWidth;
        card.style.transition = "";
      }
    },
    uncard() { card.classList.remove("on"); },
  };
})`;
