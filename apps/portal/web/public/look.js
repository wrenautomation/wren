// The last look this browser showed, put on the page before the app loads, so a saved look
// doesn't paint the default first (App.tsx keeps it; usePageTheme in @wren/ui drops it).
// A file, not inline: the CSP allows no inline scripts.
try {
  const vars = JSON.parse(localStorage.getItem("wren.portal.look") || "{}");
  const root = document.documentElement;
  const keys = Object.keys(vars).filter(
    (k) => /^--ui-[\w-]+$/.test(k) && typeof vars[k] === "string",
  );
  for (const k of keys) root.style.setProperty(k, vars[k]);
  if (keys.length) root.dataset.lookPreload = keys.join(" ");
  const bar = document.querySelector('meta[name="theme-color"]');
  if (bar && vars["--ui-canvas"]) bar.content = vars["--ui-canvas"];
} catch {}
