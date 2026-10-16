import "./app.css";
import { DictationProvider, HintLayer, ReadingProvider } from "@wren/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { openLocalCopy } from "./api.js";
import { dictation } from "./dictation/index.js";
import { reading } from "./reading/index.js";
import { PortalRouter } from "./router.js";
import { reloadOnce } from "./stale.js";

// A lazy file the live build no longer has: this tab predates a deploy, so load it fresh once.
// The error still reaches the page, which says so if the reload was spent (contained.tsx).
window.addEventListener("vite:preloadError", () => reloadOnce());

// The last load's copy paints first if it's back quickly; the reads go behind it either way.
void Promise.race([openLocalCopy(), new Promise((r) => setTimeout(r, 250))]).then(() => {
  const root = document.getElementById("root");
  if (root)
    createRoot(root).render(
      <StrictMode>
        <DictationProvider engine={dictation}>
          <ReadingProvider engine={reading}>
            <PortalRouter />
            <HintLayer />
          </ReadingProvider>
        </DictationProvider>
      </StrictMode>,
    );
});
