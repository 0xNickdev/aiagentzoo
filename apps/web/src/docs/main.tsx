import { LangRoot } from "../i18n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import DocsApp from "./DocsApp";
import "../index.css";
import "./docs.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LangRoot>{(l) => <DocsApp key={l} />}</LangRoot>
    <Analytics />
  </StrictMode>,
);
