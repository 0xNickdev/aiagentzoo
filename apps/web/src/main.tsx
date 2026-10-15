import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import App from "./App";
import { LangRoot } from "./i18n";
import { interceptLinks } from "./router";
import "./index.css";

interceptLinks();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LangRoot>{(l) => <App key={l} />}</LangRoot>
    <Analytics />
  </StrictMode>,
);
