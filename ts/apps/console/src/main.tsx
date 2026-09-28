import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./theme.css";

// Local builds use Novig's own (licensed, local-only) fonts; the hosted demo never ships them.
if (import.meta.env.VITE_DEMO === "1") import("./fonts-demo.css");
else import("./fonts-local.css");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
