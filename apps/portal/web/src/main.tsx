import "./app.css";
import { DictationProvider, ReadingProvider } from "@wren/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { dictation } from "./dictation/index.js";
import { reading } from "./reading/index.js";

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <DictationProvider engine={dictation}>
        <ReadingProvider engine={reading}>
          <App />
        </ReadingProvider>
      </DictationProvider>
    </StrictMode>,
  );
