import "@fontsource/cinzel/600.css";
import "@fontsource/cinzel/700.css";
import "@fontsource-variable/inter";
import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/App";
import { AppProvider } from "@/lib/app";

// (until Go's first answer: the night alone, no flash of an empty window)
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider fallback={<div className="h-full bg-night" />}>
      <App />
    </AppProvider>
  </StrictMode>,
);
