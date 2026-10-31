import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  runOriginHandoff,
  type HandoffOutcome,
} from "./platform/originHandoff";
import { AppShell } from "./ui/app/AppShell";
import { HandoffNotice } from "./ui/app/HandoffNotice";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing root element");
}

// Moving Projects between origins must finish before storage is opened.
void runOriginHandoff()
  .catch((): HandoffOutcome => ({ kind: "none" }))
  .then((handoff) =>
    createRoot(rootElement).render(
      <StrictMode>
        <AppShell />
        <HandoffNotice outcome={handoff} />
      </StrictMode>,
    ),
  );
