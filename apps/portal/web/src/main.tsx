import "./app.css";
import { DictationProvider, HintLayer, ReadingProvider } from "@wren/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { dictation } from "./dictation/index.js";
import { reading } from "./reading/index.js";
import { reloadOnce } from "./stale.js";

// A lazy file the live build no longer has: this tab predates a deploy, so load it fresh once.
// The error still reaches the page, which says so if the reload was spent (contained.tsx).
window.addEventListener("vite:preloadError", () => reloadOnce());

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <DictationProvider engine={dictation}>
        <ReadingProvider engine={reading}>
          <App />
          <HintLayer />
        </ReadingProvider>
      </DictationProvider>
    </StrictMode>,
  );
